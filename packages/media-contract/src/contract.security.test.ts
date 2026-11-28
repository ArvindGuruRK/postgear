/**
 * Security sweep, the contract (Sprint 13, Module 16 section 1), the Node half.
 *
 * - Unknown fields are refused, at every depth, by every shape that crosses
 *   the language line (the Python half: `apps/media/tests/test_contract.py`,
 *   whose generated models all `forbid` extras, checked here from the schema
 *   they are generated from).
 * - A payload never carries a path or an address: every string an activity
 *   takes is a storage key, an id, a code from a list or a fixed value, and
 *   the few free strings an answer may carry are named here, short and ours.
 * - A different contract version is refused (the Python half answers
 *   `MEDIA_CONTRACT_MISMATCH`, "The caller speaks a different contract
 *   version": `test_activities.py::test_another_contract_version_is_refused`;
 *   the Node side marks the service off when its health says another
 *   version: `runtime-check.workflow.test.ts`, "marks it off when it speaks
 *   another contract version").
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { z } from 'zod/v4';
import {
  contractSchemaText,
  MEDIA_CONTRACT_VERSION,
  MEDIA_FILE_SHAPES,
  MEDIA_HTTP_SHAPES,
  MEDIA_PY_CONTRACT,
} from './index';

const ROOT = join(__dirname, '..');
const FIXTURES = join(ROOT, 'fixtures');
const PYTHON_BASE = join(ROOT, '..', '..', 'apps', 'media', 'src', 'postgear_media');

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

interface SchemaNode {
  type?: string | string[];
  $ref?: string;
  pattern?: string;
  enum?: unknown[];
  const?: unknown;
  format?: string;
  maxLength?: number;
  properties?: Record<string, SchemaNode>;
  additionalProperties?: boolean | SchemaNode;
  items?: SchemaNode;
  prefixItems?: SchemaNode[];
  anyOf?: SchemaNode[];
  oneOf?: SchemaNode[];
  allOf?: SchemaNode[];
}

const schema = JSON.parse(contractSchemaText()) as {
  properties: Record<string, { $ref: string }>;
  $defs: Record<string, SchemaNode>;
};

function readJson(path: string): Json {
  return JSON.parse(readFileSync(path, 'utf8')) as Json;
}

function jsonFiles(folder: string): string[] {
  return readdirSync(folder)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

function deref(node: SchemaNode): SchemaNode {
  if (!node.$ref) return node;
  const name = node.$ref.replace('#/$defs/', '');
  const found = schema.$defs[name];
  if (!found) throw new Error(`No shape called ${name}`);
  return found;
}

interface StringField {
  where: string;
  node: SchemaNode;
}

/** Every string a shape can hold, with where it sits, following references once each. */
function stringFields(root: SchemaNode, where: string, seen = new Set<string>()): StringField[] {
  const node = deref(root);
  if (root.$ref) {
    if (seen.has(root.$ref)) return [];
    seen.add(root.$ref);
  }
  const out: StringField[] = [];
  const types = Array.isArray(node.type) ? node.type : node.type ? [node.type] : [];
  if (types.includes('string')) out.push({ where, node });
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    out.push(...stringFields(child, `${where}.${key}`, new Set(seen)));
  }
  if (node.items) out.push(...stringFields(node.items, `${where}[]`, new Set(seen)));
  for (const child of node.prefixItems ?? []) {
    out.push(...stringFields(child, `${where}[]`, new Set(seen)));
  }
  for (const list of [node.anyOf, node.oneOf, node.allOf]) {
    for (const child of list ?? []) out.push(...stringFields(child, where, new Set(seen)));
  }
  if (typeof node.additionalProperties === 'object') {
    out.push(...stringFields(node.additionalProperties, `${where}.*`, new Set(seen)));
  }
  return out;
}

function isBound(node: SchemaNode): boolean {
  return Boolean(node.pattern) || Array.isArray(node.enum) || node.const !== undefined;
}

const activities = Object.keys(MEDIA_PY_CONTRACT) as Array<keyof typeof MEDIA_PY_CONTRACT>;

describe('a payload never carries a path or an address', () => {
  it('takes no free text in any activity input: keys, ids, codes and fixed values only', () => {
    const free: string[] = [];
    for (const activity of activities) {
      const ref = schema.properties[`${activity}_input`];
      expect(ref).toBeDefined();
      for (const field of stringFields(ref as SchemaNode, `${activity}.input`)) {
        if (!isBound(field.node)) free.push(field.where);
      }
    }
    expect(free).toEqual([]);
  });

  it('answers free text only in the named fields, each short: names and versions of our own', () => {
    const free = new Map<string, number | undefined>();
    for (const [name, ref] of Object.entries(schema.properties)) {
      if (name.endsWith('_input')) continue;
      for (const field of stringFields(ref as SchemaNode, name)) {
        if (!isBound(field.node)) free.set(field.where, field.node.maxLength);
      }
    }
    expect([...free.keys()].sort()).toEqual(
      [
        // The listener's and the detector's own names ("simulation", "faster-whisper:small").
        'mediaPyTranscribe_output.model',
        'mediaPyDetectFaces_output.producer',
        'mediaPyMotion_output.producer',
        'mediaPySpeak_output.producer',
        'mediaPyHealth_output.pythonVersion',
        'mediaPyHealth_output.serviceVersion',
        'mediaPyHealth_output.taskQueue',
        'mediaPyHealth_output.bindings.transcriber.name',
        'mediaPyHealth_output.bindings.hostedTranscriber.name',
        'mediaPyHealth_output.bindings.faces.name',
        'mediaPyHealth_output.bindings.motion.name',
        'mediaPyHealth_output.bindings.stills.name',
        'mediaPyHealth_output.bindings.speaker.name',
        // Stored files, never a payload: the heard words and the typed line live only here.
        'file_HeardFile.model',
        'file_HeardFile.words[].text',
        'file_MotionFile.producer',
        'file_SpeechTextFile.text',
        'http_VoiceList.speaker.name',
        'http_VoiceList.voices[].name',
      ].sort(),
    );
    for (const [where, max] of free) {
      expect([where, typeof max === 'number' && max <= 500]).toEqual([where, true]);
    }
  });

  it('names no field like a path, an address, a folder or a file name, at any depth', () => {
    const banned = new Set(['path', 'url', 'uri', 'address', 'dir', 'directory', 'folder']);
    banned.add('host').add('file').add('filename').add('href').add('link');
    const named: string[] = [];
    for (const [defName, def] of Object.entries(schema.$defs)) {
      for (const key of Object.keys(def.properties ?? {})) {
        // camelCase words: `audioKey` is audio + key, `hostedAboveMinutes` is no host.
        const words = key.split(/(?=[A-Z])/).map((word) => word.toLowerCase());
        if (words.some((word) => banned.has(word))) named.push(`${defName}.${key}`);
      }
    }
    expect(named).toEqual([]);
  });

  it('carries the words of speech in no activity input or answer, only keys to their files', () => {
    for (const activity of activities) {
      for (const side of ['input', 'output'] as const) {
        const ref = schema.properties[`${activity}_${side}`] as SchemaNode;
        const wordy = stringFields(ref, `${activity}.${side}`).filter((field) =>
          /text|words|transcript|line|prompt/i.test(field.where),
        );
        // `textKey` names the stored line by its key (a pattern), never the line itself.
        expect(wordy.filter((field) => !field.node.pattern).map((field) => field.where)).toEqual(
          [],
        );
      }
    }
  });
});

/** Every path to a plain object inside `value` (the root is `[]`). */
function objectPaths(value: Json, at: Array<string | number> = []): Array<Array<string | number>> {
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value))
    return value.flatMap((item, index) => objectPaths(item, [...at, index]));
  return [at, ...Object.entries(value).flatMap(([key, child]) => objectPaths(child, [...at, key]))];
}

/** A copy of `value` with one extra key on the object at `path`. */
function withExtra(value: Json, path: Array<string | number>, key: string): Json {
  const copy = structuredClone(value) as Json;
  let target = copy as { [key: string]: Json } | Json[];
  for (const step of path) target = (target as Record<string | number, Json>)[step] as JsonObject;
  (target as JsonObject)[key] = 'unexpected';
  return copy;
}

interface Sample {
  label: string;
  shape: z.ZodType;
  payload: Json;
}

function samples(): Sample[] {
  const out: Sample[] = [];
  for (const activity of activities) {
    const shapes = MEDIA_PY_CONTRACT[activity];
    for (const name of jsonFiles(join(FIXTURES, activity, 'valid'))) {
      out.push({
        label: `${activity}/${name}`,
        shape: name.startsWith('input') ? shapes.input : shapes.output,
        payload: readJson(join(FIXTURES, activity, 'valid', name)),
      });
    }
  }
  for (const [name, shape] of Object.entries(MEDIA_FILE_SHAPES)) {
    for (const file of jsonFiles(join(FIXTURES, 'files', name, 'valid'))) {
      out.push({
        label: `files/${name}/${file}`,
        shape,
        payload: readJson(join(FIXTURES, 'files', name, 'valid', file)),
      });
    }
  }
  for (const file of jsonFiles(join(FIXTURES, 'voices'))) {
    out.push({
      label: `voices/${file}`,
      shape: MEDIA_HTTP_SHAPES.VoiceList,
      payload: readJson(join(FIXTURES, 'voices', file)),
    });
  }
  return out;
}

describe('unknown fields are refused on both sides', () => {
  const all = samples();

  it('has a sample of every activity side, every stored file and the voice list', () => {
    const labels = new Set(all.map((sample) => sample.label.replace(/\/[^/]+$/, '')));
    for (const activity of activities) expect(labels).toContain(activity);
    for (const name of Object.keys(MEDIA_FILE_SHAPES)) expect(labels).toContain(`files/${name}`);
  });

  it.each(all.map((sample) => [sample.label, sample] as const))(
    '%s: an extra key on any object inside it is refused',
    (_label, sample) => {
      expect(sample.shape.safeParse(sample.payload).success).toBe(true);
      const paths = objectPaths(sample.payload);
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        for (const key of ['path', 'url', 'extra']) {
          const parsed = sample.shape.safeParse(withExtra(sample.payload, path, key));
          expect([path.join('.'), key, parsed.success]).toEqual([path.join('.'), key, false]);
        }
      }
    },
  );

  it('the schema Python is generated from forbids extras on every object, and Python says so', () => {
    for (const [name, def] of Object.entries(schema.$defs)) {
      if (def.type === 'object') expect([name, def.additionalProperties]).toEqual([name, false]);
    }
    const generated = readFileSync(join(PYTHON_BASE, 'contract', 'generated.py'), 'utf8');
    const models = generated.match(/^class \w+\(BaseModel\):/gm) ?? [];
    const forbidding = generated.match(/extra="forbid"/g) ?? [];
    expect(models.length).toBeGreaterThan(20);
    expect(forbidding.length).toBe(models.length);
  });
});

describe('a version mismatch is refused with a clear error', () => {
  it.each(activities)('%s refuses another version, and a missing one', (activity) => {
    const input = MEDIA_PY_CONTRACT[activity].input;
    const valid = jsonFiles(join(FIXTURES, activity, 'valid')).find((name) =>
      name.startsWith('input'),
    );
    expect(valid).toBeDefined();
    const payload = readJson(join(FIXTURES, activity, 'valid', valid as string)) as JsonObject;
    expect(payload.version).toBe(MEDIA_CONTRACT_VERSION);
    expect(input.safeParse(payload).success).toBe(true);

    for (const version of [MEDIA_CONTRACT_VERSION + 1, 0, '1', null]) {
      const result = input.safeParse({ ...payload, version });
      expect(result.success).toBe(false);
      // The refusal names the field, so the log line says which side is out of date.
      expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('version');
    }
    const { version: _version, ...none } = payload;
    expect(input.safeParse(none).success).toBe(false);
  });

  it('the Python side answers a different version with its own non-retryable type and sentence', () => {
    const base = readFileSync(join(PYTHON_BASE, 'activities', 'base.py'), 'utf8');
    expect(base).toMatch(/CONTRACT_VERSION = 1\b/);
    expect(base).toContain('"The caller speaks a different contract version"');
    expect(base).toContain('type="MEDIA_CONTRACT_MISMATCH"');
    expect(MEDIA_CONTRACT_VERSION).toBe(1);
  });
});
