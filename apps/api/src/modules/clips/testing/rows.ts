/**
 * Whole `ClipVideo` and `ClipJob` rows for the Clips specs, with every
 * column filled, so a mapper under test sees what Prisma would hand it.
 * Test-only: nothing outside a `*.spec.ts` imports this file.
 */
import type { ClipJob, ClipVideo } from '@postgear/db';

export const TEST_ORG = 'seed-demo-org';
export const TEST_USER = '11111111-1111-4111-8111-111111111111';

const EPOCH = new Date('2026-11-01T10:00:00.000Z');

export function videoRow(overrides: Partial<ClipVideo> = {}): ClipVideo {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    organizationId: TEST_ORG,
    platform: 'TWITCH',
    kind: 'PAST_STREAM',
    externalId: '900000001',
    canonicalUrl: 'https://www.twitch.tv/videos/900000001',
    title: 'A ten minute stream',
    channelName: 'Acme',
    durationMs: 10 * 60_000,
    width: null,
    height: null,
    fps: null,
    hasAudio: true,
    status: 'IMPORTING',
    error: null,
    hdAvailable: true,
    rightsConfirmedAt: EPOCH,
    rightsConfirmedById: TEST_USER,
    rightsTextVersion: 1,
    lastUsedAt: EPOCH,
    expiresAt: null,
    removedReason: null,
    createdById: TEST_USER,
    deletedAt: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

export function jobRow(overrides: Partial<ClipJob> = {}): ClipJob {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    organizationId: TEST_ORG,
    kind: 'IMPORT',
    status: 'QUEUED',
    stage: null,
    progress: 0,
    priority: 'normal',
    videoId: '22222222-2222-4222-8222-222222222222',
    clipId: null,
    highlightRunId: null,
    input: {},
    output: null,
    error: null,
    createdById: TEST_USER,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    startedAt: null,
    finishedAt: null,
    expiresAt: null,
    ...overrides,
  };
}
