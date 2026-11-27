/**
 * Security sweep, Module 20: "Messages". No answer a person reads carries a
 * tool's output, a file path, a storage key or a platform's raw error.
 *
 * The job and video views re-derive the sentence from the code, and since
 * this sweep the code and the step must be plain words too. Every sentence
 * file is scanned for anything that looks like a path, an address or a tool.
 * A failed workflow's shape never reaches the answer, and every notice line
 * is a title and one of our sentences.
 *
 * Existing tests this builds on (not repeated here):
 * - common/filters/http-exception.filter.spec.ts:68 and :85 (code and details
 *   are filtered at the single exit point).
 * - clip/clip-item.service.spec.ts:224 (the editor answer carries no key).
 * - clip/clip-edits.service.spec.ts:132 (a refused document answers our
 *   sentence, never the schema text).
 */
import { HttpStatus, Logger } from '@nestjs/common';
import type { ClipJob } from '@postgear/db';
import {
  CLIP_ERROR_MESSAGES,
  CLIP_JOB_STAGES,
  CHANNEL_PLATFORMS,
  CLIP_PLATFORMS,
  clipErrorMessage,
  jobLabel,
  platformPausedMessage,
  platformRestingMessage,
} from '@postgear/video-engine';

jest.mock('../../common/sentry/sentry', () => ({ reportUnexpectedError: jest.fn() }));

import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { CLIP_CHANNELS_MESSAGES, sortUnsupportedMessage } from './channels/clip-channels.messages';
import { ClipErrorException } from './clip-error.exception';
import { CLIPS_MESSAGES, mediaTooBigSentence } from './clips.messages';
import {
  exportFailedNotice,
  exportReadyNotice,
  storageOverLimitNotice,
  videoExpiredNotice,
  videoExpiringNotice,
  videoFailedNotice,
  videoRightsRemovedNotice,
} from './internal/clip-notices';
import { errorOf, toJobView } from './jobs/clip-job-view';
import { CLIP_LAYOUTS_MESSAGES } from './layouts/clip-layouts.messages';
import { CLIP_LIBRARY_MESSAGES } from './library/clip-library.messages';
import { CLIP_LINKS_MESSAGES } from './links/clip-links.messages';
import { workflowFailureCode } from './links/workflow-failure';
import { jobRow, TEST_ORG, videoRow } from './testing/rows';
import { toVideoView } from './videos/clip-video-view';

const KEY = `clips/${TEST_ORG}/videos/22222222-2222-4222-8222-222222222222/source.mp4`;

/** Text a tool, a path, a key or a platform might put in a stored error. */
const HOSTILE = [
  KEY,
  '/tmp/postgear-render/33333333/graph.txt',
  'C:\\Users\\worker\\scratch\\out.mp4',
  'ffmpeg exited with code 1: Invalid data found when processing input',
  'ERROR: [youtube] abc123: Sign in to confirm you are not a bot',
  'yt-dlp --cookies /run/secrets/cookies.txt',
  'stderr: moov atom not found',
  'https://api.twitch.tv/helix/videos?client_id=abc',
  'AKIAIOSFODNN7EXAMPLE',
  'Tool_Failed',
  'tool failed',
  '__proto__',
  'x',
  'a'.repeat(64),
] as const;

/** What must never show in an answer a person reads. */
const LEAK =
  /clips\/|\/tmp|[A-Za-z]:\\|ffmpeg|ffprobe|yt-dlp|stderr|https?:\/\/|AKIA|cookies|moov|Invalid data|Sign in|client_id|\.mp4|\.txt|\.ass/i;

/** Every string reachable inside a value, for the leak scan. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

const OUR_SENTENCES = new Set<string>([
  ...Object.values(CLIP_ERROR_MESSAGES),
  ...CLIP_PLATFORMS.flatMap((platform) => [
    platformRestingMessage(platform),
    platformPausedMessage(platform),
  ]),
]);

describe('Clips security: Messages', () => {
  describe('the stored error on a job or a video', () => {
    it.each(HOSTILE)('answers a plain code and our sentence for code %#', (code) => {
      const error = errorOf({ code, message: code });
      // Too long, or empty, reads as no error; anything else as a plain word.
      if (error === null) return;
      expect(error.code).toMatch(/^[a-z][a-z0-9_]{1,63}$/);
      expect(OUR_SENTENCES.has(error.message)).toBe(true);
      expect(strings(error).some((text) => LEAK.test(text))).toBe(false);
    });

    it('turns a path, a key or a tool line in the code into tool_failed (fails without the sweep fix)', () => {
      // Under 64 characters, so the stored shape is read and only the code is wrong.
      const shortKey = `clips/${TEST_ORG}/videos/x/source.mp4`;
      for (const code of [shortKey, '/tmp/x', 'ffmpeg exited 1', 'Tool_Failed', 'tool failed']) {
        expect(errorOf({ code, message: 'whatever' })).toEqual({
          code: 'tool_failed',
          message: CLIP_ERROR_MESSAGES.tool_failed,
        });
      }
    });

    it('never repeats the stored sentence, whatever it says', () => {
      for (const message of HOSTILE) {
        expect(errorOf({ code: 'import_failed', message })).toEqual({
          code: 'import_failed',
          message: CLIP_ERROR_MESSAGES.import_failed,
        });
      }
    });

    it('keeps only the platform name from a platform sentence, and only a known one', () => {
      expect(errorOf({ code: 'platform_resting', message: `YouTube ${KEY} said no` })).toEqual({
        code: 'platform_resting',
        message: platformRestingMessage('youtube'),
      });
      expect(errorOf({ code: 'platform_paused', message: 'evil.example /tmp/x is down' })).toEqual({
        code: 'platform_paused',
        message: CLIP_ERROR_MESSAGES.tool_failed,
      });
    });

    it('reads a built-in object member as tool_failed, never a function (fails without the sweep fix)', () => {
      for (const code of ['constructor', 'hasownproperty', 'tostring', 'valueof']) {
        expect(clipErrorMessage(code)).toBe(CLIP_ERROR_MESSAGES.tool_failed);
        expect(errorOf({ code, message: '' })?.message).toBe(CLIP_ERROR_MESSAGES.tool_failed);
      }
      expect(typeof clipErrorMessage('constructor')).toBe('string');
    });

    it('answers a failed video with the same rules', () => {
      for (const code of HOSTILE) {
        const view = toVideoView(videoRow({ status: 'FAILED', error: { code, message: code } }));
        expect(strings(view.error).some((text) => LEAK.test(text))).toBe(false);
      }
    });
  });

  describe('the job view', () => {
    const OUTPUTS: Record<ClipJob['kind'], unknown> = {
      IMPORT: { durationMs: 60_000, assets: 4 },
      SEGMENT: { gone: false, assetId: '44444444-4444-4444-8444-444444444444' },
      HIGHLIGHTS: { found: 3, used: ['loudness'] },
      RENDER: {
        mediaId: '55555555-5555-4555-8555-555555555555',
        proofKey: `clips/${TEST_ORG}/clips/66666666-6666-4666-8666-666666666666/proof.mp4`,
        durationMs: 30_000,
      },
      DOWNLOAD: {
        assetId: '44444444-4444-4444-8444-444444444444',
        key: `clips/${TEST_ORG}/downloads/77777777-7777-4777-8777-777777777777/file.mp4`,
        bytes: 1024,
        ext: 'mp4',
        fileName: 'A ten minute stream',
        durationMs: 60_000,
        width: 1280,
        height: 720,
        fps: 30,
      },
      TRANSCRIBE: {
        transcriptAssetId: '44444444-4444-4444-8444-444444444444',
        language: 'en',
        wordCount: 284,
        noSpeech: false,
        secondsListened: 120,
        model: 'simulation',
      },
      FACES: { assetId: '44444444-4444-4444-8444-444444444444', found: 2, sampled: 300 },
      TRANSLATE: { transcriptAssetId: '44444444-4444-4444-8444-444444444444', wordCount: 80 },
      SPEECH: { assetId: '44444444-4444-4444-8444-444444444444', durationMs: 4_000 },
      // Module 10: the clip to open and what the recipe left out.
      AUTO_EDIT: {
        clipId: '44444444-4444-4444-8444-444444444444',
        skipped: [{ part: 'captions', reason: 'no_speech' }],
        noSpeech: true,
      },
      // Module 14: an emote's files are names, never keys.
      EMOTE: {
        platform: 'twitch',
        files: [
          {
            name: 'emote-twitch-112.gif',
            size: 112,
            format: 'gif',
            bytes: 76_000,
            maxBytes: 512_000,
            fits: true,
            rung: 1,
            frames: 60,
            fps: 20,
            extra: false,
          },
        ],
        zip: { name: 'emote-twitch.zip', bytes: 76_500 },
        sharp: false,
      },
    };

    it.each(Object.keys(OUTPUTS) as ClipJob['kind'][])(
      'answers a finished %s job with its small result and never a key',
      (kind) => {
        const view = toJobView(
          jobRow({
            kind,
            status: 'DONE',
            output: OUTPUTS[kind] as never,
            input: { document: { secret: KEY }, plan: { exportMinutes: 999 } } as never,
          }),
        );
        expect(view.result).not.toBeNull();
        expect(strings(view).some((text) => LEAK.test(text))).toBe(false);
        expect(JSON.stringify(view)).not.toContain('exportMinutes');
      },
    );

    it('answers no result for an output with keys it does not know', () => {
      const view = toJobView(
        jobRow({
          kind: 'IMPORT',
          status: 'DONE',
          output: { durationMs: 1, assets: 1, stderr: 'ffmpeg said', path: '/tmp/x' } as never,
        }),
      );
      expect(view.result).toBeNull();
    });

    it('answers a failed or cancelled job with a plain code and our sentence', () => {
      for (const status of ['FAILED', 'CANCELLED'] as const) {
        for (const code of HOSTILE) {
          const view = toJobView(jobRow({ status, error: { code, message: code } }));
          expect(strings(view).some((text) => LEAK.test(text))).toBe(false);
        }
      }
    });

    it('answers only a step from the contract (fails without the sweep fix)', () => {
      for (const stage of [...HOSTILE, 'constructor', 'rendering']) {
        const view = toJobView(jobRow({ kind: 'IMPORT', status: 'RUNNING', stage }));
        expect(view.stage).toBeNull();
        expect(view.stageLabel).toBe('Waiting for its turn');
      }
      for (const kind of Object.keys(CLIP_JOB_STAGES) as ClipJob['kind'][]) {
        for (const stage of CLIP_JOB_STAGES[kind]) {
          const view = toJobView(jobRow({ kind, status: 'RUNNING', stage }));
          expect(view.stage).toBe(stage);
          expect(view.stageLabel).toBe(jobLabel(kind, 'RUNNING', stage));
        }
      }
    });
  });

  describe('every sentence file', () => {
    const files: Record<string, Record<string, unknown>> = {
      CLIP_ERROR_MESSAGES,
      CLIPS_MESSAGES,
      CLIP_CHANNELS_MESSAGES,
      CLIP_LAYOUTS_MESSAGES,
      CLIP_LIBRARY_MESSAGES,
      CLIP_LINKS_MESSAGES,
    };
    const sentences = Object.entries(files).flatMap(([file, messages]) =>
      Object.entries(messages).flatMap(([name, value]) => {
        const texts =
          typeof value === 'function'
            ? [(value as (n: number) => string)(1), (value as (n: number) => string)(3)]
            : [value as string];
        return texts.map((text) => [`${file}.${name}`, text] as const);
      }),
    );
    const extra = [
      ...CLIP_PLATFORMS.flatMap((platform) => [
        platformRestingMessage(platform),
        platformPausedMessage(platform),
      ]),
      ...CHANNEL_PLATFORMS.map((platform) => sortUnsupportedMessage(platform)),
      mediaTooBigSentence(412 * 1024 * 1024, 250 * 1024 * 1024),
    ];

    it('has no path, address, key or tool name in any sentence', () => {
      expect(sentences.length).toBeGreaterThan(80);
      const words =
        /\/|\\|https?:|ffmpeg|ffprobe|yt-dlp|stderr|stdout|exit code|errno|ENOENT|EACCES|undefined|null|\$\{|\bjob\b|\bproxy\b|\bsegment\b/i;
      const bad = [...sentences.map(([, text]) => text), ...extra].filter((text) =>
        words.test(text),
      );
      expect(bad).toEqual([]);
    });

    it('writes every sentence as a sentence: a capital first and a full stop last', () => {
      const bad = [...sentences, ...extra.map((text) => ['extra', text] as const)].filter(
        ([, text]) => !/^[A-Z"]/.test(text) || !/[.!?]$/.test(text),
      );
      expect(bad).toEqual([]);
    });
  });

  describe('a refusal on its way out', () => {
    function answer(exception: unknown) {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const host = {
        switchToHttp: () => ({
          getResponse: () => response,
          getRequest: () => ({ method: 'POST', url: '/clips/links/check' }),
        }),
      } as never;
      new HttpExceptionFilter().catch(exception, host);
      return response.json.mock.calls[0]?.[0] as Record<string, unknown>;
    }

    it.each([...HOSTILE, 'constructor'])(
      'answers our sentence and only a plain code for code %#',
      (code) => {
        const body = answer(new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, code));
        expect(OUR_SENTENCES.has(body.error as string)).toBe(true);
        if (body.code !== undefined) expect(body.code).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
        expect(strings(body).some((text) => LEAK.test(text))).toBe(false);
      },
    );

    it('answers the generic sentence for a raw tool error, never its text', () => {
      const body = answer(new Error(`ffmpeg exited 1 reading ${KEY}`));
      expect(body).toEqual({ error: expect.any(String), statusCode: 500 });
      expect(strings(body).some((text) => LEAK.test(text))).toBe(false);
    });
  });

  describe('a failed workflow', () => {
    const cycle: { cause?: unknown; details?: unknown } = { details: [{ code: KEY }] };
    cycle.cause = cycle;
    let deep: unknown = { details: [{ code: 'link_private' }] };
    for (let i = 0; i < 10; i++) deep = { message: `wrap ${i}`, cause: deep };

    it.each([
      ['a key as the code', { details: [{ code: KEY }] }],
      ['a tool line as the code', { details: [{ code: 'ffmpeg exited 1: /tmp/x' }] }],
      ['a raw error', new Error('ERROR: [youtube] abc: Sign in to confirm')],
      ['details that are text', { details: 'yt-dlp --cookies /run/secrets/c.txt' }],
      ['a cause that points at itself', cycle],
      ['a code buried too deep', deep],
      ['nothing', null],
      ['a string', 'stderr: moov atom not found'],
    ])('reads %s as tool_failed', (_label, failure) => {
      expect(workflowFailureCode(failure)).toEqual({ code: 'tool_failed' });
    });

    it('keeps only a known platform beside a plain code', () => {
      expect(
        workflowFailureCode({ details: [{ code: 'link_private', platform: 'evil.example' }] }),
      ).toEqual({ code: 'link_private' });
      expect(
        workflowFailureCode({
          cause: { details: [{ code: 'platform_resting', platform: 'kick' }] },
        }),
      ).toEqual({ code: 'platform_resting', platform: 'kick' });
    });
  });

  describe('the notices', () => {
    const clip = { id: '66666666-6666-4666-8666-666666666666', title: 'Best Moment' };
    const video = { id: '22222222-2222-4222-8222-222222222222', title: 'A ten minute stream' };
    const notices = [
      exportReadyNotice(TEST_ORG, clip, '55555555-5555-4555-8555-555555555555'),
      exportFailedNotice(TEST_ORG, clip),
      videoFailedNotice(TEST_ORG, video),
      videoExpiringNotice(TEST_ORG, video, new Date('2026-12-01T00:00:00.000Z')),
      videoExpiredNotice(TEST_ORG, video, 30),
      videoRightsRemovedNotice(TEST_ORG, video.id),
      storageOverLimitNotice(TEST_ORG, 12.4, 10),
    ];

    it('carries only ids, plain codes, numbers and dates in meta', () => {
      for (const notice of notices) {
        for (const value of Object.values(notice.meta ?? {})) {
          if (typeof value === 'number') continue;
          expect(String(value)).toMatch(
            /^([0-9a-f-]{36}|[a-z][a-z0-9_]{1,63}|\d{4}-\d{2}-\d{2}T[\d:.]+Z)$/,
          );
        }
      }
    });

    it('links inside the workspace and says only the title and our sentence', () => {
      for (const notice of notices) {
        expect(notice.organizationId).toBe(TEST_ORG);
        expect(notice.link?.startsWith(`/${TEST_ORG}/clips`)).toBe(true);
        expect(notice.email).toBe(false);
        const text = `${notice.title} ${notice.content}`;
        expect(LEAK.test(text)).toBe(false);
      }
      expect(notices[1]?.content).toContain(CLIP_ERROR_MESSAGES.export_failed);
      expect(notices[2]?.content).toContain(CLIP_ERROR_MESSAGES.import_failed);
    });
  });
});
