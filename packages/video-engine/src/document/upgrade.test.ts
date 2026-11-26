import { createClipDocument } from './create';
import { CURRENT_SCHEMA_VERSION, clipDocumentSchema } from './schema';
import { ClipDocumentError, parseClipDocument, safeParseClipDocument, upgrade } from './upgrade';

const VIDEO = '6f1c2b1e-8d4a-4c1e-9b7a-2f3e4d5c6b7a';

function created(): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 10_000, ratio: '9:16' })),
  ) as Record<string, unknown>;
}

function reasonOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ClipDocumentError) {
      return error.reason;
    }
    throw error;
  }
  return 'no error';
}

describe('upgrade', () => {
  it('returns a copy of a current document, leaving the input alone', () => {
    const raw = created();
    const before = JSON.stringify(raw);
    const result = upgrade(raw);
    expect(result).toEqual(raw);
    expect(result).not.toBe(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it('refuses what is not a versioned document', () => {
    expect(reasonOf(() => upgrade(null))).toBe('not_a_document');
    expect(reasonOf(() => upgrade('{"schemaVersion":1}'))).toBe('not_a_document');
    expect(reasonOf(() => upgrade([created()]))).toBe('not_a_document');
    expect(reasonOf(() => upgrade({ ...created(), schemaVersion: undefined }))).toBe('no_version');
    expect(reasonOf(() => upgrade({ ...created(), schemaVersion: '1' }))).toBe('no_version');
    expect(reasonOf(() => upgrade({ ...created(), schemaVersion: 0 }))).toBe('no_version');
    expect(reasonOf(() => upgrade({ ...created(), schemaVersion: 1.5 }))).toBe('no_version');
  });

  it('refuses a document from a newer PostGear', () => {
    expect(
      reasonOf(() => upgrade({ ...created(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 })),
    ).toBe('too_new');
  });
});

describe('parseClipDocument', () => {
  it('accepts a created document', () => {
    const doc = parseClipDocument(created());
    expect(clipDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('refuses unknown keys without repeating them', () => {
    const raw = { ...created(), secretTokenValue123: 'hunter2' };
    let issues: readonly string[] = [];
    try {
      parseClipDocument(raw);
    } catch (error) {
      expect(error).toBeInstanceOf(ClipDocumentError);
      issues = (error as ClipDocumentError).issues;
    }
    expect(issues).toEqual(['document: has a field the schema does not allow']);
    expect(issues.join(' ')).not.toContain('secretTokenValue123');
    expect(issues.join(' ')).not.toContain('hunter2');
  });

  it('describes a bad value by its path, never its content', () => {
    const raw = created();
    const segments = raw.segments as Record<string, unknown>[];
    (segments[0] as Record<string, unknown>).speed = 3;
    (raw.looks as Record<string, unknown>).colour = 'evil<script>';
    const result = safeParseClipDocument(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContain('segments.0.speed: does not match any allowed shape');
      expect(result.issues).toContain('looks.colour: is not one of the allowed values');
      expect(result.issues.join(' ')).not.toContain('evil');
    }
  });

  it('caps a long list of issues', () => {
    const raw = { ...created(), segments: Array.from({ length: 40 }, () => ({})) };
    const result = safeParseClipDocument(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(21);
      expect(result.issues[20]).toMatch(/^and \d+ more$/);
    }
  });

  it('turns every refusal into a result in the safe form', () => {
    expect(safeParseClipDocument(undefined)).toEqual({
      ok: false,
      issues: ['This is not a clip document.'],
    });
    const newer = safeParseClipDocument({ ...created(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 });
    expect(newer.ok).toBe(false);
    const good = safeParseClipDocument(created());
    expect(good.ok).toBe(true);
  });
});
