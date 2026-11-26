/**
 * Reading a transcript for moments (Sprint 13, Module 05): the internal
 * route a Find Clips run with a setup calls at its `reading` stage.
 *
 * The API holds the model client and its keys, so it does the reading:
 * 1. The run's setup (kept on the run) says the stretch, the language, the
 *    request, the genre and the length.
 * 2. The video's transcript for that stretch (fixes applied) becomes
 *    numbered rows, then overlapping windows.
 * 3. The moment picker answers row numbers and five parts per pick; every
 *    row number is checked (`toCandidate`), never trusted. Each moment is
 *    fitted to the asked length on whole sentences, near-duplicates go, and
 *    the best 40 are titled.
 * 4. The answer is times, parts and titles only. The worker blends it with
 *    the signals and writes the clips.
 *
 * No words heard in the stretch: nothing was read, so the reading charge is
 * given back and the run goes on with the signals alone. Rows, the request
 * and the model's answers are never logged.
 */
import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ClipJobKind, prisma } from '@postgear/db';
import type { ClipPickedMoment, ClipPickMomentsAnswer } from '@postgear/scheduling';
import {
  CLIP_LENGTH_BOUNDS,
  type ClipSetup,
  cleanRequest,
  clipSetupSchema,
  dedupeByOverlap,
  fitToLength,
  GENRE_LABELS,
  genreTuning,
  languageName,
  type MomentCandidate,
  rowWindows,
  toCandidate,
  transcriptRows,
} from '@postgear/video-engine';
import { AI_ENGINE, type AiEngine } from '../../ai/engine/engine.types';
import { UsageService } from '../../entitlements/usage.service';
import { ClipErrorException } from '../clip-error.exception';
import { ClipTranscriptsService } from '../transcripts/clip-transcripts.service';
import { ClipVideosRepository } from '../videos/clip-videos.repository';

/** Moments titled (and answered) at most. */
export const TITLED_MOMENTS = 40;
/** The words of a moment sent to the title writer. */
const TITLE_EXCERPT_CHARS = 600;

/** What a run with a setup keeps in `ClipHighlightRun.params`. */
export interface SetupRunParams {
  setup: ClipSetup;
  /** The listening job, when the stretch was not all listened to yet. */
  listenJobId: string | null;
  /** Ledger entries of this run's own charges, by step. */
  charges: { read: string | null; signals: string | null; action: string | null };
  /** Module 06: Look For Action shows stills to the AI model on this run. */
  actionVision: boolean;
}

export function readSetupParams(params: unknown): SetupRunParams | null {
  if (!params || typeof params !== 'object') return null;
  const value = params as Record<string, unknown>;
  const setup = clipSetupSchema.safeParse(value.setup);
  if (!setup.success) return null;
  const charges = (value.charges ?? {}) as Record<string, unknown>;
  return {
    setup: setup.data,
    listenJobId: typeof value.listenJobId === 'string' ? value.listenJobId : null,
    charges: {
      read: typeof charges.read === 'string' ? charges.read : null,
      signals: typeof charges.signals === 'string' ? charges.signals : null,
      action: typeof charges.action === 'string' ? charges.action : null,
    },
    actionVision: value.actionVision === true,
  };
}

function lengthHint(setup: ClipSetup): string {
  const { minMs, maxMs } = CLIP_LENGTH_BOUNDS[setup.length];
  return `${Math.round(minMs / 1000)} to ${Math.round(maxMs / 1000)} seconds`;
}

@Injectable()
export class ClipMomentsService {
  private readonly logger = new Logger(ClipMomentsService.name);

  constructor(
    private readonly transcripts: ClipTranscriptsService,
    private readonly videos: ClipVideosRepository,
    private readonly usage: UsageService,
    @Inject(AI_ENGINE) private readonly ai: AiEngine,
  ) {}

  /** `POST /internal/clips/jobs/:jobId/pick-moments`. */
  async pick(jobId: string, orgId: string): Promise<ClipPickMomentsAnswer> {
    const job = await prisma.clipJob.findFirst({
      where: { id: jobId, organizationId: orgId, kind: ClipJobKind.HIGHLIGHTS },
      select: { id: true, videoId: true, highlightRunId: true },
    });
    if (!job?.videoId || !job.highlightRunId) throw notFound();
    const run = await prisma.clipHighlightRun.findFirst({
      where: { id: job.highlightRunId, organizationId: orgId },
      select: { params: true },
    });
    const params = run ? readSetupParams(run.params) : null;
    if (!params) throw new ClipErrorException(HttpStatus.CONFLICT, 'highlights_failed');
    const { setup } = params;
    const video = await this.videos.findLive(orgId, job.videoId);
    if (!video || video.durationMs === null) throw notFound();
    const range = {
      fromMs: setup.range.fromMs,
      toMs: Math.min(setup.range.toMs, video.durationMs),
    };
    const asked = cleanRequest(setup.request).length > 0;

    const row = await this.transcripts.transcriptRow(orgId, video.id, setup.language);
    const view = row ? await this.transcripts.viewOf(row, [range]) : null;
    const rows = view ? transcriptRows(view, range) : [];
    if (rows.length === 0) {
      // Nothing to read: the reading charge goes back, and the run keeps to the signals.
      if (params.charges.read) await this.usage.reverse(orgId, params.charges.read);
      return { moments: [], noSpeech: true, asked };
    }

    const writer = this.ai.createSnippetWriter({ orgId });
    if (!writer) throw new ClipErrorException(HttpStatus.SERVICE_UNAVAILABLE, 'captions_off');
    const language = languageName(view?.language ?? 'en');
    const tuning = genreTuning(setup.genre);

    let picked: Awaited<ReturnType<typeof writer.pickMoments>>;
    try {
      picked = await writer.pickMoments({
        windows: rowWindows(rows).map((window) => window.map((r) => ({ n: r.n, text: r.text }))),
        request: cleanRequest(setup.request),
        genre: GENRE_LABELS[setup.genre],
        genreNote: tuning.note,
        lengthHint: lengthHint(setup),
        language,
      });
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.moments.read_failed',
          jobId,
          reason: error instanceof Error ? error.name : 'unknown',
        }),
      );
      throw new ClipErrorException(HttpStatus.BAD_GATEWAY, 'highlights_failed');
    }

    const fitted: MomentCandidate[] = [];
    let dropped = 0;
    for (const pick of picked.picks) {
      const candidate = toCandidate(rows, pick);
      const fit = candidate
        ? fitToLength(candidate, rows, setup.length, { durationMs: video.durationMs, range })
        : null;
      if (fit) fitted.push(fit);
      else dropped += 1;
    }
    const best = dedupeByOverlap(fitted).slice(0, TITLED_MOMENTS);

    let titles: string[] = [];
    try {
      titles = await writer.writeTitles({
        moments: best.map((moment) =>
          rows
            .filter((r) => r.n >= moment.fromRow && r.n <= moment.toRow)
            .map((r) => r.text)
            .join(' ')
            .slice(0, TITLE_EXCERPT_CHARS),
        ),
        language,
      });
    } catch {
      // Titles are a nicety: the clips keep the video's name with a number.
      titles = [];
    }

    const moments: ClipPickedMoment[] = best.map((moment, index) => ({
      fromMs: moment.fromMs,
      toMs: moment.toMs,
      fromRow: moment.fromRow,
      toRow: moment.toRow,
      parts: moment.parts,
      score: moment.score,
      funny: moment.funny,
      matchesRequest: asked && moment.matchesRequest,
      title: titles[index] ? titles[index] : null,
    }));
    this.logger.log(
      JSON.stringify({
        event: 'clips.moments.read',
        jobId,
        rows: rows.length,
        windows: picked.windows,
        failedWindows: picked.failed,
        picks: picked.picks.length,
        dropped,
        moments: moments.length,
      }),
    );
    return { moments, noSpeech: false, asked };
  }
}

function notFound(): NotFoundException {
  return new NotFoundException({ message: 'This job was not found.', code: 'job_not_found' });
}
