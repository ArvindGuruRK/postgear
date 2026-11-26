import { Logger } from '@nestjs/common';
import { createSimulatedModelClient, createSnippetWriter } from '@postgear/ai-engine';
import { defaultClipSetup, type TranscriptWord } from '@postgear/video-engine';
import type { AiEngine } from '../../ai/engine/engine.types';
import type { UsageService } from '../../entitlements/usage.service';
import type { ClipTranscriptsService } from '../transcripts/clip-transcripts.service';
import type { ClipVideosRepository } from '../videos/clip-videos.repository';
import { ClipMomentsService, readSetupParams } from './clip-moments.service';

const ORG = 'org-1';
const JOB = '11111111-1111-4111-8111-111111111111';
const VIDEO = '22222222-2222-4222-8222-222222222222';

const mockDb = {
  job: { id: JOB, videoId: VIDEO, highlightRunId: 'run-1' } as Record<string, unknown> | null,
  params: {} as unknown,
};
jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: {
    clipJob: { findFirst: jest.fn(async () => mockDb.job) },
    clipHighlightRun: { findFirst: jest.fn(async () => ({ params: mockDb.params })) },
  },
}));

const SENTENCES = [
  'Alright chat, welcome back to the stream, we are live.',
  'Tonight we are going for the speed run record again.',
  'Yesterday we lost it by two seconds, which still hurts.',
  'So let me set up the route real quick.',
  'You know the plan: skip the first bridge, take the tunnel.',
  'Okay, three, two, one, go.',
  'Clean start, we are already ahead of the ghost.',
  'Here comes the tunnel jump, that was so close.',
  'We cleared the whole gap, what a run.',
  'That is the new record, thank you all for watching.',
];

/** Each sentence 5 s long, one every 7 s from 10 s. */
function words(sentences = SENTENCES): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  sentences.forEach((sentence, s) => {
    const parts = sentence.split(' ');
    parts.forEach((text, w) => {
      const start = 10_000 + s * 7_000 + Math.round((w * 5_000) / parts.length);
      out.push({
        i: out.length,
        start,
        end: start + Math.round(4_000 / parts.length),
        text,
        sure: 0.9,
      });
    });
  });
  return out;
}

function setup(options: { words?: TranscriptWord[]; request?: string } = {}) {
  const list = options.words ?? words();
  mockDb.params = {
    setup: { ...defaultClipSetup(120_000), request: options.request ?? '' },
    listenJobId: null,
    charges: { read: 'entry-read', signals: null },
  };
  const transcripts = {
    transcriptRow: jest.fn(async () => (list.length > 0 ? { id: 't', key: 'k', meta: {} } : null)),
    viewOf: jest.fn(async () => ({
      id: 't',
      language: 'en',
      words: list,
      covered: [{ fromMs: 0, toMs: 120_000 }],
    })),
  };
  const videos = { findLive: jest.fn(async () => ({ id: VIDEO, durationMs: 120_000 })) };
  const usage = { reverse: jest.fn(async () => ({ entryId: 'rev', duplicate: false })) };
  const writer = createSnippetWriter(createSimulatedModelClient());
  const ai = { createSnippetWriter: jest.fn(() => writer) };
  const service = new ClipMomentsService(
    transcripts as unknown as ClipTranscriptsService,
    videos as unknown as ClipVideosRepository,
    usage as unknown as UsageService,
    ai as unknown as AiEngine,
  );
  return { service, usage, writer };
}

describe('reading a transcript for moments', () => {
  it('answers moments that start and end on a sentence, scored and titled', async () => {
    const { service } = setup();
    const answer = await service.pick(JOB, ORG);
    expect(answer.noSpeech).toBe(false);
    expect(answer.moments.length).toBeGreaterThan(0);
    const starts = words().filter(
      (_word, k, all) => k === 0 || /[.!?]$/.test(all[k - 1]?.text ?? ''),
    );
    for (const moment of answer.moments) {
      // 200 ms of air before a sentence's first word.
      expect(starts.some((word) => word.start - 200 === moment.fromMs || moment.fromMs === 0)).toBe(
        true,
      );
      expect(moment.score).toBe(
        moment.parts.hook +
          moment.parts.standsAlone +
          moment.parts.payoff +
          moment.parts.clarity +
          moment.parts.shareable,
      );
      expect(moment.title?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('puts what was asked for in the answer, and says a request was made', async () => {
    const { service } = setup({ request: 'the tunnel jump' });
    const answer = await service.pick(JOB, ORG);
    expect(answer.asked).toBe(true);
    expect(answer.moments.some((moment) => moment.matchesRequest)).toBe(true);
  });

  it('drops a pick with a row that does not exist', async () => {
    const sentences = ['Only one row here [simulate:pick-bad-row] said slowly and long enough.'];
    const { service } = setup({ words: words(sentences) });
    const answer = await service.pick(JOB, ORG);
    expect(answer.moments).toEqual([]);
  });

  it('gives the reading charge back when no words were heard, so the run keeps to signals', async () => {
    const { service, usage } = setup({ words: [] });
    const answer = await service.pick(JOB, ORG);
    expect(answer).toEqual({ moments: [], noSpeech: true, asked: false });
    expect(usage.reverse).toHaveBeenCalledWith(ORG, 'entry-read');
  });

  it('never writes a word of the transcript or the request to the log', async () => {
    const lines: string[] = [];
    const spies = (['log', 'warn', 'error'] as const).map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        lines.push(String(args[0]));
      }),
    );
    const { service } = setup({ request: 'secret request words' });
    await service.pick(JOB, ORG);
    for (const spy of spies) spy.mockRestore();
    const logged = lines.join('\n');
    expect(logged).toContain('clips.moments.read');
    expect(logged).not.toMatch(/tunnel|record|secret request/i);
  });

  it('reads only a setup it can trust from the run', () => {
    expect(readSetupParams({ setup: { genre: 'auto' } })).toBeNull();
    expect(readSetupParams(null)).toBeNull();
    expect(readSetupParams(mockDb.params)?.charges.read).toBe('entry-read');
  });
});
