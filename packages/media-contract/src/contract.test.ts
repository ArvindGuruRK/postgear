/**
 * The Node half of the contract checks; `apps/media/tests/test_contract.py`
 * is the Python half and reads the same fixture files.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isValidClipKey } from '@postgear/storage';
import type { z } from 'zod/v4';
import {
  CLIP_KEY_PATTERN_SOURCE,
  contractSchemaText,
  MEDIA_ERROR_TYPES,
  MEDIA_FILE_SHAPES,
  MEDIA_NON_RETRYABLE_ERRORS,
  MEDIA_PY_ACTIVITY_NAMES,
  MEDIA_PY_CONTRACT,
  storageKey,
} from './index';

const ROOT = join(__dirname, '..');
const FIXTURES = join(ROOT, 'fixtures');

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function files(folder: string): string[] {
  return readdirSync(folder)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

const activities = Object.keys(MEDIA_PY_CONTRACT) as Array<keyof typeof MEDIA_PY_CONTRACT>;

describe('the exported JSON Schema', () => {
  it('is what the shapes produce today (run `npm run contract:export` after a change)', () => {
    const onDisk = readFileSync(join(ROOT, 'schema', 'contract.json'), 'utf8');
    expect(onDisk).toBe(contractSchemaText());
  });

  it('refuses unknown keys on every shape', () => {
    const schema = JSON.parse(contractSchemaText()) as {
      $defs: Record<string, { type?: string; additionalProperties?: boolean }>;
    };
    for (const [name, def] of Object.entries(schema.$defs)) {
      if (def.type === 'object') expect([name, def.additionalProperties]).toEqual([name, false]);
    }
  });
});

describe('no optional keys', () => {
  it('makes every key of every shape required (a value that may be absent is nullable)', () => {
    // Python sends `null` for an absent value and Zod's `.optional()` refuses `null`,
    // so an optional key would fail on the wire. Nullable and required is the one way.
    const schema = JSON.parse(contractSchemaText()) as {
      $defs: Record<string, { type?: string; properties?: object; required?: string[] }>;
    };
    for (const [name, def] of Object.entries(schema.$defs)) {
      if (def.type !== 'object' || !def.properties) continue;
      expect([name, [...(def.required ?? [])].sort()]).toEqual([
        name,
        Object.keys(def.properties).sort(),
      ]);
    }
  });
});

describe('the shared fixtures', () => {
  it('has a valid and an invalid folder for every activity, and nothing else', () => {
    const folders = readdirSync(FIXTURES).filter((name) => name !== 'keys' && name !== 'files');
    expect(folders.sort()).toEqual([...activities].sort());
    for (const activity of activities) {
      expect(files(join(FIXTURES, activity, 'valid')).length).toBeGreaterThan(0);
      expect(files(join(FIXTURES, activity, 'invalid')).length).toBeGreaterThan(0);
    }
  });

  for (const activity of activities) {
    const shapes = MEDIA_PY_CONTRACT[activity];
    const pick = (name: string): z.ZodType =>
      name.startsWith('input') ? shapes.input : shapes.output;

    for (const name of files(join(FIXTURES, activity, 'valid'))) {
      it(`${activity}/valid/${name} parses`, () => {
        const payload = readJson(join(FIXTURES, activity, 'valid', name));
        expect(pick(name).parse(payload)).toEqual(payload);
      });
    }

    for (const name of files(join(FIXTURES, activity, 'invalid'))) {
      it(`${activity}/invalid/${name} is refused`, () => {
        const payload = readJson(join(FIXTURES, activity, 'invalid', name));
        expect(pick(name).safeParse(payload).success).toBe(false);
      });
    }
  }
});

describe('the stored file shapes', () => {
  const names = Object.keys(MEDIA_FILE_SHAPES) as Array<keyof typeof MEDIA_FILE_SHAPES>;

  it('has a valid and an invalid folder for every file shape, and nothing else', () => {
    expect(readdirSync(join(FIXTURES, 'files')).sort()).toEqual([...names].sort());
  });

  for (const name of names) {
    for (const file of files(join(FIXTURES, 'files', name, 'valid'))) {
      it(`files/${name}/valid/${file} parses`, () => {
        const payload = readJson(join(FIXTURES, 'files', name, 'valid', file));
        expect(MEDIA_FILE_SHAPES[name].parse(payload)).toEqual(payload);
      });
    }
    for (const file of files(join(FIXTURES, 'files', name, 'invalid'))) {
      it(`files/${name}/invalid/${file} is refused`, () => {
        const payload = readJson(join(FIXTURES, 'files', name, 'invalid', file));
        expect(MEDIA_FILE_SHAPES[name].safeParse(payload).success).toBe(false);
      });
    }
  }
});

describe('the face file holds boxes and times only', () => {
  // Every key the face file may ever carry, at every level. A new field (a
  // landmark, a likeness, a crop, a name) must fail here first, and be argued
  // for in the Decision Log before this list changes.
  const schema = JSON.parse(contractSchemaText()) as {
    $defs: Record<string, { properties?: Record<string, unknown> }>;
  };
  const keysOf = (name: string) => Object.keys(schema.$defs[name]?.properties ?? {}).sort();

  it('the file: a version, the rate and the pictures', () => {
    expect(keysOf('FaceTracksFile')).toEqual(['frames', 'sampleFps', 'version']);
  });

  it('a picture: its time and its boxes', () => {
    expect(keysOf('FacePicture')).toEqual(['boxes', 't']);
  });

  it('a box: where it is and how sure the detector was', () => {
    expect(keysOf('FaceBox')).toEqual(['h', 'score', 'w', 'x', 'y']);
  });

  it('the activity answers a key and counts, never the boxes', () => {
    expect(keysOf('MediaPyDetectFacesOutput')).toEqual([
      'facesKey',
      'found',
      'producer',
      'sampled',
    ]);
  });
});

describe('storage keys', () => {
  const examples = readJson(join(FIXTURES, 'keys', 'examples.json')) as {
    valid: string[];
    invalid: string[];
  };

  it.each(examples.valid)('accepts %s like @postgear/storage does', (key) => {
    expect(isValidClipKey(key)).toBe(true);
    expect(storageKey.safeParse(key).success).toBe(true);
  });

  it.each(examples.invalid)('refuses %s like @postgear/storage does', (key) => {
    expect(isValidClipKey(key)).toBe(false);
    expect(storageKey.safeParse(key).success).toBe(false);
  });

  it('keeps the pattern anchored', () => {
    expect(CLIP_KEY_PATTERN_SOURCE.startsWith('^')).toBe(true);
    expect(CLIP_KEY_PATTERN_SOURCE.endsWith('$')).toBe(true);
  });
});

describe('names', () => {
  it('names every activity with the mediaPy prefix and no two alike', () => {
    const names = Object.values(MEDIA_PY_ACTIVITY_NAMES);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^mediaPy[A-Z][A-Za-z]+$/);
  });

  it('lists the non-retryable errors from the table', () => {
    expect(MEDIA_NON_RETRYABLE_ERRORS).toContain('MEDIA_BAD_INPUT');
    expect(MEDIA_NON_RETRYABLE_ERRORS).not.toContain('MEDIA_TOOL_FAILED');
    expect(MEDIA_NON_RETRYABLE_ERRORS.length).toBe(
      Object.values(MEDIA_ERROR_TYPES).filter((type) => !type.retryable).length,
    );
  });
});
