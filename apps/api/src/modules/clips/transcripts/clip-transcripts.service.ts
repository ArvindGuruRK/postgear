/**
 * Transcripts (Sprint 13, Module 02): the one door every feature goes through
 * to get a video's speech as text.
 *
 * `ensure(orgId, userId, videoId, range, language)`:
 * 1. The video must be live, READY and have sound; the language must be one
 *    Clips can draw; the media service must be up (`captions_off` otherwise).
 * 2. The request is rounded outward to whole 30 second blocks, and what the
 *    video's transcript already covers is taken out. **Nothing missing answers
 *    at once: no job, no charge.** A stretch is listened to once.
 * 3. A stretch another open listening job of this video is already working on
 *    is not started twice: the caller is given that job.
 * 4. What is left is priced with `aiMinutesCost('listen', ms)` (one AI minute
 *    for each minute listened to, rounded up, two at least). The job id is
 *    made first, then the charge goes through `UsageService.consume` with the
 *    key `clips.ai:listen:<jobId>` (402 `clips_ai_minutes_used` when short).
 * 5. One serializable transaction re-checks the video, the covered stretches
 *    and the open jobs, and writes the TRANSCRIBE job. Then the workflow starts.
 *
 * Whatever happens before the row lands, the charge is given back. A failed
 * or cancelled job, and one that heard nothing, is given back by the worker.
 *
 * Reading (`read`) answers the words of a stretch with the video's word fixes
 * applied. Fixes (`fix`) are kept in the transcript row's `meta`, keyed by the
 * word's moment, so listening again keeps them.
 *
 * Speech text is never logged: log lines carry ids, counts and lengths only.
 */
import { HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ClipAssetKind,
  type ClipJob,
  ClipJobKind,
  type ClipVideo,
  type Prisma,
  prisma,
} from '@postgear/db';
import {
  aiMinutesCost,
  applyFixes,
  clipRanges,
  isLanguageChoice,
  LANGUAGE_AUTO,
  MAX_LISTEN_RANGES,
  mergeRanges,
  type MsRange,
  rangesMs,
  rangesToListen,
  readTranscriptAssetMeta,
  removeFix,
  replaceEverywhere,
  transcribeInputSchema,
  type TranscriptAssetMeta,
  type TranscriptWord,
  upsertFix,
  type WordFix,
  wordsInRange,
} from '@postgear/video-engine';
import type { MeterState } from '../../entitlements/entitlement-resolver';
import { UsageService } from '../../entitlements/usage.service';
import { ClipErrorException } from '../clip-error.exception';
import { isUuid } from '../clips.ids';
import { CLIPS_MESSAGES } from '../clips.messages';
import { type ClipsTx, serializable } from '../clips.tx';
import { type ClipJobView, toJobView } from '../jobs/clip-job-view';
import { ClipJobsRepository, OPEN_JOB_STATUSES } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { MediaServiceProbe } from '../status/media-service.probe';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import { ClipTranscriptStore } from './clip-transcript-store';
import type { FixWordsInput } from './clip-transcripts.schema';

export const AI_MINUTES_METER = 'clips.ai_minutes_per_month' as const;

/** The listening step's charge key: one charge per job, whatever is retried. */
export function listenChargeKey(jobId: string): string {
  return `clips.ai:listen:${jobId}`;
}

/** The AI minutes listening to these stretches costs; 0 for nothing to listen to. */
export function listenPrice(ranges: readonly MsRange[]): number {
  const ms = rangesMs(ranges);
  return ms <= 0 ? 0 : aiMinutesCost('listen', ms);
}

export interface TranscriptRequest {
  fromMs?: number;
  toMs?: number;
  language?: string;
  /**
   * Several stretches at once (a clip made of separate parts), instead of
   * `fromMs` and `toMs`. What lies between them is left alone: nobody pays
   * to listen to the part of the video a clip cut out.
   */
  ranges?: readonly MsRange[];
}

export interface MeterView {
  used: number;
  remaining: number | null;
  limit: number | null;
  cycleEnd: string;
}

export type EnsureOutcome =
  /** Every asked moment was already listened to: nothing started, nothing charged. */
  | { covered: true; language: string | null; price: 0 }
  /** Another job of this video is already listening to this stretch. */
  | { covered: false; job: ClipJobView; price: 0; joined: true; ranges: MsRange[] }
  | {
      covered: false;
      job: ClipJobView;
      /** AI minutes charged. */
      price: number;
      joined: false;
      ranges: MsRange[];
      meter: MeterView;
    };

export interface TranscriptView {
  /** The transcript row's id: what a captions track points at. */
  id: string;
  language: string;
  model: string;
  source: TranscriptAssetMeta['source'];
  /** The words of the asked stretch, fixes applied. */
  words: TranscriptWord[];
  /** The listened parts inside the asked stretch. */
  covered: MsRange[];
  /** How many word fixes the video has. */
  fixes: number;
  /** A supplied file's name, when the words came from one. */
  fileName: string | null;
}

export interface ReadOutcome {
  transcript: TranscriptView | null;
  /** True when every moment of the asked stretch has words or was heard as silence. */
  complete: boolean;
  /** What listening to the rest would cost, in AI minutes. */
  price: number;
}

interface TranscriptRow {
  id: string;
  key: string;
  meta: TranscriptAssetMeta;
}

export function toMeterView(state: MeterState): MeterView {
  return {
    used: state.used,
    remaining: state.remaining,
    limit: state.limit,
    cycleEnd: state.cycleEnd.toISOString(),
  };
}

function overlaps(a: readonly MsRange[], b: readonly MsRange[]): boolean {
  return a.some((left) => b.some((right) => left.fromMs < right.toMs && right.fromMs < left.toMs));
}

/** At most `MAX_LISTEN_RANGES` stretches: past that, the smallest gaps are listened through. */
export function capRanges(ranges: readonly MsRange[], max = MAX_LISTEN_RANGES): MsRange[] {
  let out = mergeRanges(ranges);
  while (out.length > max) {
    let smallest = 1;
    for (let index = 2; index < out.length; index += 1) {
      const gap = (out[index] as MsRange).fromMs - (out[index - 1] as MsRange).toMs;
      const best = (out[smallest] as MsRange).fromMs - (out[smallest - 1] as MsRange).toMs;
      if (gap < best) smallest = index;
    }
    const left = out[smallest - 1] as MsRange;
    const right = out[smallest] as MsRange;
    out = [
      ...out.slice(0, smallest - 1),
      { fromMs: left.fromMs, toMs: right.toMs },
      ...out.slice(smallest + 1),
    ];
  }
  return out;
}

@Injectable()
export class ClipTranscriptsService {
  private readonly logger = new Logger(ClipTranscriptsService.name);

  constructor(
    private readonly videos: ClipVideosRepository,
    private readonly jobs: ClipJobsService,
    private readonly jobsRepository: ClipJobsRepository,
    private readonly limits: ClipLimitsGuard,
    private readonly usage: UsageService,
    private readonly store: ClipTranscriptStore,
    private readonly mediaService: MediaServiceProbe,
  ) {}

  /** `POST /clips/videos/:videoId/transcript`: see the file comment. */
  async ensure(
    orgId: string,
    userId: string | null,
    videoId: string,
    request: TranscriptRequest = {},
  ): Promise<EnsureOutcome> {
    await this.limits.assertEnabled(orgId);
    const video = await this.requireReadyVideo(orgId, videoId);
    const language = this.languageOf(request);
    const wanted = this.wantedRanges(video, request);

    const existing = await this.transcriptRow(orgId, video.id, language);
    const missing = this.missingFor(existing, wanted, video.durationMs as number);
    if (missing.length === 0) {
      return { covered: true, language: existing?.meta.language ?? null, price: 0 };
    }

    if (!video.hasAudio) throw new ClipErrorException(HttpStatus.CONFLICT, 'no_speech');
    if ((await this.mediaService.state()) !== 'ok') {
      throw new ClipErrorException(HttpStatus.SERVICE_UNAVAILABLE, 'captions_off');
    }

    const running = await this.overlappingJob(orgId, video.id, missing);
    if (running) {
      return {
        covered: false,
        job: toJobView(running),
        price: 0,
        joined: true,
        ranges: missing,
      };
    }

    const price = listenPrice(missing);
    const jobId = this.jobs.newJobId();
    const jobRow = await this.jobs.build({
      id: jobId,
      orgId,
      userId,
      kind: 'TRANSCRIBE',
      videoId: video.id,
      input: transcribeInputSchema.parse({
        videoId: video.id,
        language,
        ranges: missing,
        aiMinutes: price,
      }),
    });

    let written = false;
    try {
      const charge = await this.usage.consume(orgId, AI_MINUTES_METER, price, {
        idempotencyKey: listenChargeKey(jobId),
        refId: jobId,
        meta: { step: 'listen', videoId: video.id },
      });

      const outcome = await serializable(async (tx) => {
        const live = await this.videos.findLive(orgId, video.id, tx);
        if (!live) return { kind: 'gone' as const };
        if (live.status !== 'READY') return { kind: 'not_ready' as const };
        // Someone else may have listened, or started to, since the first look.
        const now = await this.transcriptRow(orgId, video.id, language, tx);
        const stillMissing = this.missingFor(now, wanted, live.durationMs ?? 0);
        if (stillMissing.length === 0) return { kind: 'covered' as const };
        const other = await this.overlappingJob(orgId, video.id, stillMissing, tx);
        if (other) return { kind: 'running' as const, job: other };
        const job = await this.jobsRepository.create(jobRow, tx);
        return { kind: 'created' as const, job };
      });

      if (outcome.kind === 'gone') throw videoNotFound();
      if (outcome.kind === 'not_ready') throw notReady();
      if (outcome.kind === 'covered') {
        return { covered: true, language: existing?.meta.language ?? null, price: 0 };
      }
      if (outcome.kind === 'running') {
        return {
          covered: false,
          job: toJobView(outcome.job),
          price: 0,
          joined: true,
          ranges: missing,
        };
      }
      written = true;

      await this.jobs.start(outcome.job);
      const job = (await this.jobsRepository.find(orgId, outcome.job.id)) ?? outcome.job;
      this.logger.log(
        JSON.stringify({
          event: 'clips.transcribe.started',
          orgId,
          videoId: video.id,
          jobId,
          aiMinutes: price,
          ranges: missing.length,
          ms: rangesMs(missing),
        }),
      );
      return {
        covered: false,
        job: toJobView(job),
        price,
        joined: false,
        ranges: missing,
        meter: toMeterView(charge.state),
      };
    } finally {
      if (!written) {
        // Refused, lost the race, or already covered: nothing ran, so nothing is kept.
        await this.usage.reverseAllFor(orgId, jobId);
      }
    }
  }

  /**
   * What listening to a stretch would cost right now, and whether anything
   * is left to listen to. Never charges and never starts anything: the price
   * a button shows before it is pressed.
   */
  async quote(
    orgId: string,
    videoId: string,
    request: TranscriptRequest = {},
  ): Promise<{ price: number; ms: number; covered: boolean }> {
    const video = await this.requireReadyVideo(orgId, videoId);
    const language = this.languageOf(request);
    const wanted = this.wantedRanges(video, request);
    const existing = await this.transcriptRow(orgId, video.id, language);
    const missing = this.missingFor(existing, wanted, video.durationMs as number);
    return { price: listenPrice(missing), ms: rangesMs(missing), covered: missing.length === 0 };
  }

  /** `GET /clips/videos/:videoId/transcript`: the words of a stretch, fixes applied. */
  async read(
    orgId: string,
    videoId: string,
    request: TranscriptRequest = {},
  ): Promise<ReadOutcome> {
    const video = await this.requireReadyVideo(orgId, videoId);
    const language = this.languageOf(request);
    const wanted = this.wantedRanges(video, request);
    const row = await this.transcriptRow(orgId, video.id, language);
    const missing = this.missingFor(row, wanted, video.durationMs as number);
    if (!row) return { transcript: null, complete: false, price: listenPrice(missing) };

    const transcript = await this.viewOf(row, wanted);
    if (!transcript) return { transcript: null, complete: false, price: listenPrice(missing) };
    return { transcript, complete: missing.length === 0, price: listenPrice(missing) };
  }

  /**
   * One transcript row's words inside `wanted`, fixes applied; null when its
   * file is gone or does not read. `wanted` is already inside the video.
   */
  async viewOf(row: TranscriptRow, wanted: readonly MsRange[]): Promise<TranscriptView | null> {
    const stored = await this.store.read(row.key);
    if (!stored) return null;
    const transcript = applyFixes(stored, row.meta.fixes);
    return {
      id: row.id,
      language: transcript.language,
      model: transcript.model,
      source: row.meta.source,
      words: wanted.flatMap((range) => wordsInRange(transcript, range.fromMs, range.toMs)),
      covered:
        row.meta.source === 'listened'
          ? wanted.flatMap((range) => clipRanges(transcript.covered, range))
          : [...wanted],
      fixes: row.meta.fixes.length,
      fileName: row.meta.fileName ?? null,
    };
  }

  /**
   * One transcript row of a video by its id, whoever it belongs to inside the
   * video (the video's own, a clip's supplied file, a clip's translation).
   * Always inside the workspace: an id from elsewhere is null.
   */
  async assetRow(orgId: string, videoId: string, assetId: string): Promise<TranscriptRow | null> {
    if (!isUuid(assetId)) return null;
    const row = await prisma.clipAsset.findFirst({
      where: { id: assetId, organizationId: orgId, videoId, kind: ClipAssetKind.TRANSCRIPT },
      select: { id: true, key: true, meta: true },
    });
    const meta = row ? readTranscriptAssetMeta(row.meta) : null;
    return row && meta ? { id: row.id, key: row.key, meta } : null;
  }

  /**
   * `PATCH /clips/videos/:videoId/transcript/words`: fixes by word index,
   * Replace Everywhere, or taking fixes away. Kept for the whole video.
   */
  async fix(
    orgId: string,
    videoId: string,
    body: FixWordsInput,
  ): Promise<{ changed: number; fixes: number }> {
    const video = await this.requireReadyVideo(orgId, videoId);
    const language = this.languageOf(body);
    const row = await this.transcriptRow(orgId, video.id, language);
    if (!row) throw new ClipErrorException(HttpStatus.CONFLICT, 'transcript_missing');
    const stored = await this.store.read(row.key);
    if (!stored) throw new ClipErrorException(HttpStatus.CONFLICT, 'transcript_missing');

    let fixes: WordFix[] = [...row.meta.fixes];
    let changed = 0;
    if ('replace' in body) {
      const result = replaceEverywhere(
        applyFixes(stored, fixes),
        fixes,
        body.replace.from,
        body.replace.to,
      );
      fixes = result.fixes;
      changed = result.changed;
    } else {
      const byIndex = new Map(stored.words.map((word) => [word.i, word]));
      if ('fixes' in body) {
        for (const fix of body.fixes) {
          const word = byIndex.get(fix.index);
          if (!word) continue;
          // Typing the heard word back is taking the fix away, not a fix.
          fixes =
            fix.text === word.text ? removeFix(fixes, word) : upsertFix(fixes, word, fix.text);
          changed += 1;
        }
      } else {
        for (const index of body.restore) {
          const word = byIndex.get(index);
          if (!word) continue;
          fixes = removeFix(fixes, word);
          changed += 1;
        }
      }
    }

    if (changed > 0) {
      await prisma.clipAsset.updateMany({
        where: { id: row.id, organizationId: orgId, kind: ClipAssetKind.TRANSCRIPT },
        data: { meta: { ...row.meta, fixes } as unknown as Prisma.InputJsonValue },
      });
      this.logger.log(
        JSON.stringify({
          event: 'clips.transcript.fixed',
          orgId,
          videoId: video.id,
          changed,
          fixes: fixes.length,
        }),
      );
    }
    return { changed, fixes: fixes.length };
  }

  /**
   * The video's transcript row in `language` (`auto`: its first spoken one,
   * never a translation), with a meta that reads; null when there is none.
   */
  async transcriptRow(
    orgId: string,
    videoId: string,
    language: string,
    tx: ClipsTx = prisma,
  ): Promise<TranscriptRow | null> {
    const rows = await tx.clipAsset.findMany({
      // `clipId: null`: a file supplied for one clip, or one clip's translation, belongs to
      // that clip and never stands in for the video's own transcript.
      where: { organizationId: orgId, videoId, clipId: null, kind: ClipAssetKind.TRANSCRIPT },
      orderBy: { createdAt: 'asc' },
      select: { id: true, key: true, meta: true },
    });
    const readable = rows
      .map((row) => ({ id: row.id, key: row.key, meta: readTranscriptAssetMeta(row.meta) }))
      .filter((row): row is TranscriptRow => row.meta !== null);
    if (language === LANGUAGE_AUTO) {
      return readable.find((row) => row.meta.source !== 'translated') ?? null;
    }
    return readable.find((row) => row.meta.language === language) ?? null;
  }

  /** A supplied file covers everything it could (it is the person's own words); else the gaps. */
  private missingFor(
    row: TranscriptRow | null,
    wanted: readonly MsRange[],
    durationMs: number,
  ): MsRange[] {
    if (row?.meta.source === 'supplied' || row?.meta.source === 'translated') return [];
    const covered = row?.meta.covered ?? [];
    return capRanges(wanted.flatMap((range) => rangesToListen(covered, range, durationMs)));
  }

  /** An open listening job of this video whose stretches overlap `ranges`. */
  private async overlappingJob(
    orgId: string,
    videoId: string,
    ranges: readonly MsRange[],
    tx: ClipsTx = prisma,
  ): Promise<ClipJob | null> {
    const open = await tx.clipJob.findMany({
      where: {
        organizationId: orgId,
        videoId,
        kind: ClipJobKind.TRANSCRIBE,
        status: { in: [...OPEN_JOB_STATUSES] },
      },
      orderBy: { createdAt: 'asc' },
    });
    for (const job of open) {
      const input = transcribeInputSchema.safeParse(job.input);
      if (input.success && overlaps(input.data.ranges, ranges)) return job;
    }
    return null;
  }

  private languageOf(request: { language?: string }): string {
    const language = request.language ?? LANGUAGE_AUTO;
    if (!isLanguageChoice(language)) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'language_unsupported');
    }
    return language;
  }

  /** The asked stretches held inside the video, merged; the whole video when none was asked. */
  private wantedRanges(video: ClipVideo, request: TranscriptRequest): MsRange[] {
    const duration = video.durationMs as number;
    const asked: readonly MsRange[] = request.ranges ?? [
      { fromMs: request.fromMs ?? 0, toMs: request.toMs ?? duration },
    ];
    const held = mergeRanges(
      asked
        .map((range) => ({
          fromMs: Math.min(Math.max(0, range.fromMs), duration),
          toMs: Math.min(Math.max(0, range.toMs), duration),
        }))
        .filter((range) => range.toMs > range.fromMs),
    );
    if (held.length === 0) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'transcript_range_invalid');
    }
    return held;
  }

  /** A live, READY video of the workspace with a known length; a plain 404 for another's. */
  private async requireReadyVideo(orgId: string, videoId: string): Promise<ClipVideo> {
    const video = isUuid(videoId) ? await this.videos.findLive(orgId, videoId) : null;
    if (!video) throw videoNotFound();
    if (video.status !== 'READY' || video.durationMs === null) throw notReady();
    return video;
  }
}

function notReady(): ClipErrorException {
  return new ClipErrorException(HttpStatus.CONFLICT, 'video_not_ready');
}

function videoNotFound(): NotFoundException {
  return new NotFoundException({
    message: CLIPS_MESSAGES.VIDEO_NOT_FOUND,
    code: 'video_not_found',
  });
}
