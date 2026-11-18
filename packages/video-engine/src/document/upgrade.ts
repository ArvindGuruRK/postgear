/**
 * Reading a stored clip document: upgrade it to the current schema, then
 * validate it.
 *
 * Every read goes through `parseClipDocument` (the API on save and on load,
 * the worker before a render), so a row written by an older PostGear is moved
 * forward on the way in and the one written back is current. A document from
 * a newer PostGear, or one with no version at all, is refused: guessing at a
 * shape we do not know would render something nobody made.
 *
 * Refusals carry short readable issue strings ("segments.0.speed: is not one
 * of the allowed values"), never the raw input, so they are safe to log and
 * to answer with.
 */
import type { z } from 'zod';
import { type ClipDocument, CURRENT_SCHEMA_VERSION, clipDocumentSchema } from './schema';

/** Why a document was refused. */
export type ClipDocumentErrorReason =
  /** Not an object at all. */
  | 'not_a_document'
  /** No `schemaVersion`, or one that is not a whole number from 1. */
  | 'no_version'
  /** Written by a newer PostGear than this one. */
  | 'too_new'
  /** Older than the current version with no step to move it forward. */
  | 'no_upgrade_step'
  /** Upgraded, but the schema refuses it. */
  | 'invalid';

/** At most this many issues are kept, so one broken array cannot make a huge error. */
const MAX_ISSUES = 20;

/** Path parts longer than this are cut, because a record key is input. */
const MAX_PATH_PART = 32;

/**
 * The one error a document read throws. `issues` are short sentences with a
 * path, safe to show a developer or put in a log.
 */
export class ClipDocumentError extends Error {
  readonly reason: ClipDocumentErrorReason;
  readonly issues: readonly string[];

  constructor(reason: ClipDocumentErrorReason, issues: readonly string[]) {
    super(issues[0] ?? 'This clip could not be read.');
    this.name = 'ClipDocumentError';
    this.reason = reason;
    this.issues = issues;
  }
}

type UpgradeStep = (document: Record<string, unknown>) => Record<string, unknown>;

/**
 * One entry per version N, taking the stored shape at N and returning the
 * shape at N + 1. A step is written against the stored shape, never against
 * today's types, and once released it never changes. Empty while the schema
 * is at version 1.
 */
const UPGRADE_STEPS: Readonly<Record<number, UpgradeStep>> = Object.freeze({});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Moves a stored document up to `CURRENT_SCHEMA_VERSION`, one version at a
 * time. Returns a new object (the input is never changed). Throws a
 * `ClipDocumentError` for anything that is not a versioned document this
 * PostGear can read.
 */
export function upgrade(raw: unknown): unknown {
  if (!isRecord(raw)) {
    throw new ClipDocumentError('not_a_document', ['This is not a clip document.']);
  }

  const version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ClipDocumentError('no_version', [
      'schemaVersion: is missing or not a version number',
    ]);
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new ClipDocumentError('too_new', [
      `schemaVersion: ${version} was written by a newer PostGear (this one reads up to ${CURRENT_SCHEMA_VERSION})`,
    ]);
  }

  let document: Record<string, unknown> = { ...raw };
  let current = version;
  while (current < CURRENT_SCHEMA_VERSION) {
    const step = Object.hasOwn(UPGRADE_STEPS, current) ? UPGRADE_STEPS[current] : undefined;
    if (!step) {
      throw new ClipDocumentError('no_upgrade_step', [
        `schemaVersion: ${current} has no upgrade step to ${CURRENT_SCHEMA_VERSION}`,
      ]);
    }
    document = step(document);
    current += 1;
  }
  return document;
}

function formatPath(path: readonly (string | number)[]): string {
  if (path.length === 0) {
    return 'document';
  }
  return path
    .map((part) => {
      const text = String(part);
      return text.length > MAX_PATH_PART ? `${text.slice(0, MAX_PATH_PART)}...` : text;
    })
    .join('.');
}

/**
 * One issue as a short sentence. Zod's own text is used only for issue kinds
 * whose text never repeats the input (sizes, our own refine messages); the
 * kinds that would echo a value or a key get our own words.
 */
function describeIssue(issue: z.ZodIssue): string {
  const where = formatPath(issue.path);
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined'
        ? `${where}: is required`
        : `${where}: expected ${issue.expected}, got ${issue.received}`;
    case 'invalid_enum_value':
      return `${where}: is not one of the allowed values`;
    case 'invalid_literal':
      return `${where}: is not the expected value`;
    case 'unrecognized_keys':
      return `${where}: has ${issue.keys.length === 1 ? 'a field' : `${issue.keys.length} fields`} the schema does not allow`;
    case 'invalid_union':
    case 'invalid_union_discriminator':
      return `${where}: does not match any allowed shape`;
    default:
      return `${where}: ${issue.message}`;
  }
}

/** Short readable sentences for a Zod error, capped at `MAX_ISSUES`. */
export function describeIssues(error: z.ZodError): string[] {
  const issues = error.issues.slice(0, MAX_ISSUES).map(describeIssue);
  if (error.issues.length > MAX_ISSUES) {
    issues.push(`and ${error.issues.length - MAX_ISSUES} more`);
  }
  return issues;
}

/**
 * Upgrades and validates a stored document. Throws a `ClipDocumentError`
 * when it cannot be read: a half-read clip must never reach a render.
 */
export function parseClipDocument(raw: unknown): ClipDocument {
  const result = clipDocumentSchema.safeParse(upgrade(raw));
  if (!result.success) {
    throw new ClipDocumentError('invalid', describeIssues(result.error));
  }
  return result.data;
}

/** The same as `parseClipDocument`, as a result instead of a throw (for routes and forms). */
export function safeParseClipDocument(
  raw: unknown,
): { ok: true; doc: ClipDocument } | { ok: false; issues: string[] } {
  try {
    return { ok: true, doc: parseClipDocument(raw) };
  } catch (error) {
    if (error instanceof ClipDocumentError) {
      return { ok: false, issues: [...error.issues] };
    }
    return { ok: false, issues: ['This clip could not be read.'] };
  }
}
