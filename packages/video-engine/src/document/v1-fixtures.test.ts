/**
 * "Add, never rename" (Sprint 13): the five version 1 clips saved in
 * `fixtures/v1-clips/` before the document moved to version 2 must open,
 * upgrade and draw exactly as they did.
 *
 * - Each one upgrades to the current version, gaining an empty `bleeps` list
 *   and nothing else, and parses.
 * - Its fingerprint is the one Sprint 12's code gave it (pinned below, taken
 *   with that code), so an export made before the upgrade still reads as
 *   Exported.
 * - Its compiled render (the filter graph, the ASS file, the output options)
 *   and what is on screen at five moments match the snapshots taken with the
 *   Sprint 12 compiler. A change to these snapshots is a change to what an
 *   old clip looks like: do not update them without knowing why.
 *
 * `npm run clips:regression` exports the same five through FFmpeg and compares
 * the pictures.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { documentFingerprint, fingerprintMatches } from '../export';
import { buildRenderPlan, compileFfmpeg, frameState } from '../render';
import { FONT_MANIFEST } from '../render/fonts-manifest';
import { outputDuration } from '../time';
import { CURRENT_SCHEMA_VERSION } from './schema';
import { parseClipDocument, upgrade } from './upgrade';

const DIR = join(__dirname, '..', '..', 'fixtures', 'v1-clips');

/** Taken with the Sprint 12 code (commit 7710e78's document module) on 2026-11-26. */
const SPRINT_12_FINGERPRINTS: Record<string, string> = {
  'blurred-zoom': 'v2-0410bce3508a69064d24a8f45018',
  'fullscreen-text': 'v2-16c3c719d409240793ea9d7ae889',
  'gameplay-stickers': 'v2-1e13a9e6a65b10101d7552d4d3c4',
  'split-speeds': 'v2-0e41f9f34d0b4210be48136276ce',
  'square-sound': 'v2-1be8f1b404817805f9e4ce88b753',
};

const STICKER = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const SOUND = '1b2c3d4e-5f60-4b7c-9d8e-0f1a2b3c4d5e';

function stored(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as Record<string, unknown>;
}

describe.each(Object.keys(SPRINT_12_FINGERPRINTS))('the version 1 clip %s', (name) => {
  it('is stored as version 1 and upgrades by gaining an empty bleeps list, nothing else', () => {
    const raw = stored(name);
    expect(raw.schemaVersion).toBe(1);
    expect(raw).not.toHaveProperty('bleeps');
    const upgraded = upgrade(raw) as Record<string, unknown>;
    expect(upgraded).toEqual({ ...raw, schemaVersion: CURRENT_SCHEMA_VERSION, bleeps: [] });
    expect(() => parseClipDocument(raw)).not.toThrow();
    // The stored object itself is never changed.
    expect(raw.schemaVersion).toBe(1);
  });

  it('keeps the fingerprint Sprint 12 gave it, so its exports still read as Exported', () => {
    const doc = parseClipDocument(stored(name));
    expect(documentFingerprint(doc)).toBe(SPRINT_12_FINGERPRINTS[name]);
    expect(fingerprintMatches(doc, SPRINT_12_FINGERPRINTS[name] as string)).toBe(true);
  });

  it('compiles to the same render and draws the same at five moments', () => {
    const doc = parseClipDocument(stored(name));
    const plan = buildRenderPlan(doc, {
      quality: '720p',
      proof: false,
      watermark: false,
      assets: {
        sources: {
          src: {
            file: 'source.mp4',
            sourceOffsetMs: 0,
            durationMs: 24_000,
            width: 1920,
            height: 1080,
            fps: 30,
            hasAudio: true,
          },
        },
        fonts: { dir: 'fonts', manifest: FONT_MANIFEST },
        stickers: {
          [`asset:${STICKER}`]: {
            file: 'sticker.png',
            animated: false,
            width: 512,
            height: 512,
            fps: null,
            frames: null,
          },
        },
        sounds: { [`asset:${SOUND}`]: { file: 'sound.m4a', durationMs: 3_000 } },
      },
    });
    const compiled = compileFfmpeg(plan);
    expect({
      inputs: compiled.inputs,
      graph: compiled.filterComplexScript,
      ass: compiled.assFiles,
      output: compiled.outputArgs,
      durationMs: compiled.durationMs,
      fonts: compiled.fonts,
    }).toMatchSnapshot('render');

    const length = outputDuration(doc);
    const moments = [0.1, 0.3, 0.5, 0.7, 0.9].map((share) => Math.round(length * share));
    expect(moments.map((ms) => frameState(doc, ms))).toMatchSnapshot('frames');
  });
});

it('a version 2 clip that uses something new is fingerprinted as version 2', () => {
  const doc = parseClipDocument(stored('fullscreen-text'));
  const bleeped = {
    ...doc,
    bleeps: [{ id: 'bl_1', source: 'src', from: 2_500, to: 2_900, mode: 'bleep' as const }],
  };
  expect(documentFingerprint(bleeped)).not.toBe(SPRINT_12_FINGERPRINTS['fullscreen-text']);
  // A recipe id is never drawn, so it never makes a clip look changed.
  expect(documentFingerprint({ ...doc, recipeId: 'captions-only' })).toBe(
    SPRINT_12_FINGERPRINTS['fullscreen-text'],
  );
});
