/**
 * `usesAiVoice` (Sprint 13, Module 09): true only when a sound item of the
 * clip plays one of the workspace's sounds made by Text To Speech
 * (`meta.madeByAi`), never for an uploaded or a library sound, and never for
 * another workspace's asset.
 */
import type { ClipAsset } from '@postgear/db';
import { addSound, type ClipDocument, createClipDocument } from '@postgear/video-engine';
import {
  assetRow,
  emptyTables,
  type FakeClipDb,
  type FakeTables,
  fakeClipDb,
} from '../testing/fake-clip-db';
import { TEST_ORG } from '../testing/rows';
import { documentUsesAiVoice } from './clip-ai-voice';

let mockDb: FakeClipDb;
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');
  return {
    ...actual,
    prisma: new Proxy(
      {},
      { get: (_target, key) => (mockDb as Record<string | symbol, unknown>)[key] },
    ),
  };
});

const VIDEO = '22222222-2222-4222-8222-222222222222';
const MADE = '88888888-8888-4888-8888-000000000001';
const UPLOADED = '88888888-8888-4888-8888-000000000002';

function sound(id: string, meta: Record<string, unknown>, organizationId = TEST_ORG) {
  return assetRow({
    id,
    organizationId,
    videoId: null,
    clipId: null,
    kind: 'AUDIO',
    meta: { status: 'ready', purpose: 'sound', name: 'A Sound', durationMs: 2_000, ...meta },
  } as Partial<ClipAsset>);
}

function playing(ref: { asset: string } | { library: 'sound'; id: string }): ClipDocument {
  const doc = createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 20_000, ratio: '9:16' });
  const added = addSound(doc, ref, 'sfx', 1_000, { durationMs: 2_000 });
  if (!added.ok) throw new Error(added.code);
  return added.doc;
}

function seed(extra: (tables: FakeTables) => void) {
  const tables = emptyTables();
  extra(tables);
  mockDb = fakeClipDb(tables);
}

describe('documentUsesAiVoice', () => {
  it('is true for a sound Text To Speech made, false for an uploaded one', async () => {
    seed((tables) => {
      tables.assets.push(sound(MADE, { madeByAi: true, voice: 'sim-river' }), sound(UPLOADED, {}));
    });
    expect(await documentUsesAiVoice(TEST_ORG, playing({ asset: MADE }))).toBe(true);
    expect(await documentUsesAiVoice(TEST_ORG, playing({ asset: UPLOADED }))).toBe(false);
  });

  it('is false with no sound, a library sound, no document, or another workspace', async () => {
    seed((tables) => {
      tables.assets.push(sound(MADE, { madeByAi: true }, 'seed-second-org'));
    });
    const plain = createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 20_000, ratio: '9:16' });
    expect(await documentUsesAiVoice(TEST_ORG, plain)).toBe(false);
    expect(await documentUsesAiVoice(TEST_ORG, playing({ library: 'sound', id: MADE }))).toBe(
      false,
    );
    expect(await documentUsesAiVoice(TEST_ORG, null)).toBe(false);
    expect(await documentUsesAiVoice(TEST_ORG, playing({ asset: MADE }))).toBe(false);
  });
});
