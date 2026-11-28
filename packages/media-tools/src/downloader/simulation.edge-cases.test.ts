/**
 * Sprint 13, Module 16 section 2: the sample with no speech.
 *
 * `https://www.twitch.tv/videos/900000014` imports like any sample, and its
 * title holds `[simulate:no-speech]`. Under `CLIPS_SIMULATION` the worker
 * reads that marker (`transcribe.run.ts`, `simulationHint`) and the simulated
 * listener hears nothing, so Add Captions, Listen and Find Clips meet "We
 * could not hear any speech in this video." The marker is inert with real
 * providers (`apps/worker/src/clips/clips-ai.edge-cases.test.ts` and
 * `apps/media/tests/test_edge_cases.py`), and only the fixture binding,
 * bound under simulation, knows this link.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LinkRef } from '@postgear/video-engine';
import type { RunTool } from '../run/types';
import { createFixtureDownloader } from './fixture.downloader';
import { resolveSimulationLink } from './simulation';

const NO_SPEECH: LinkRef = {
  platform: 'twitch',
  kind: 'video',
  externalId: '900000014',
  canonicalUrl: 'https://www.twitch.tv/videos/900000014',
};

describe('the sample with no speech (CLIPS_SIMULATION)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'pg-no-speech-'));
    await mkdir(path.join(dir, 'samples'));
    await writeFile(path.join(dir, 'samples', 'stream.mp4'), Buffer.alloc(2000, 8));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('is a known link that forces no fetch failure', () => {
    const answer = resolveSimulationLink(NO_SPEECH);
    expect(answer?.type).toBe('video');
    expect(answer && answer.type === 'video' && answer.fetchErrors).toBeFalsy();
  });

  it('probes like any sample, with the no-speech marker in its title', async () => {
    const runTool: RunTool = async () => ({
      exitCode: 0,
      stdout: '',
      stderrTail: '',
      durationMs: 1,
    });
    const downloader = createFixtureDownloader({
      samplesDir: path.join(dir, 'samples'),
      runTool,
      stepDelayMs: 0,
    });
    const info = await downloader.probe(NO_SPEECH, new AbortController().signal);
    expect(info).toMatchObject({ externalId: '900000014', live: false });
    expect(info.title).toBe('PostGear Sample: Nobody Speaks [simulate:no-speech]');
  });
});
