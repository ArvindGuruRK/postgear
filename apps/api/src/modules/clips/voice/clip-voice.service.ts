/**
 * Text To Speech (Sprint 13, Module 09), behind `CLIPS_TTS` (default off).
 *
 * `voices()` (`GET /clips/voices`): the voices on offer, and whether a voice
 * can be made right now (`CLIPS_TTS` on and the media service up).
 *
 * `make()` (`POST /clips/:clipId/voice` `{ text, voiceId, revision }`):
 * 1. Off (`CLIPS_TTS` false, or the media service down): 503 `voice_off`.
 * 2. The clip must be the workspace's (a plain 404 otherwise).
 * 3. The line's script must be one the voice reads (Latin, Devanagari,
 *    Tamil): 422 `voice_language` otherwise.
 * 4. **The same line and voice again is one charge**: a SPEECH job of this
 *    clip with the same voice and line that is still running, or finished and
 *    its sound is still in the workspace, is answered as it is (no job, no
 *    charge). Only one that failed, was cancelled, or whose sound was deleted
 *    is made again.
 * 5. Priced with `aiMinutesCost('voice', characters)` (one AI minute per
 *    1,000 characters, one at least). The job row is written first, in a
 *    serializable transaction that looks again for a repeat (so a double
 *    click makes one job), then charged through `UsageService.consume` with
 *    the key `clips.ai:voice:<clipId>:<revision>:<sha256(voiceId, text), 16
 *    hex>` (402 `clips_ai_minutes_used` when short; the row is taken back).
 *    A line made again after a failure adds `:<n>`, the how-many-th try, so a
 *    reversed charge is never answered as a duplicate. Then the workflow starts.
 *
 * The worker makes the voice the workspace's own sound (the same AUDIO asset
 * an uploaded sound is, with `meta.madeByAi`); a failure or a cancel gives
 * the AI minutes back through the internal reverse route.
 *
 * The line is never logged: log lines carry ids, counts and lengths only.
 */
import { createHash } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClipJob } from '@postgear/db';
import { aiMinutesCost, speechInputSchema, speechOutputSchema } from '@postgear/video-engine';
import type { Env } from '../../../config/env';
import { UsageService } from '../../entitlements/usage.service';
import { ClipItemService } from '../clip/clip-item.service';
import { ClipErrorException } from '../clip-error.exception';
import { type ClipsTx, serializable } from '../clips.tx';
import { type ClipJobView, toJobView } from '../jobs/clip-job-view';
import { ClipJobsRepository, OPEN_JOB_STATUSES } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { MediaServiceProbe } from '../status/media-service.probe';
import {
  AI_MINUTES_METER,
  type MeterView,
  toMeterView,
} from '../transcripts/clip-transcripts.service';
import { CLIP_VOICE_MESSAGES } from './clip-voice.messages';
import { ClipVoiceRepository } from './clip-voice.repository';
import type { MakeVoiceInput } from './clip-voice.schema';
import { voiceReads } from './text-script';
import { findVoice, type VoiceView, voiceViews } from './voices';

/**
 * Bytes a made voice may take, checked against the plan's space before it is
 * made: the editor's AAC at 48 kHz stereo is about 24 KB a second, and a
 * character is about 60 ms; a margin on top.
 */
export function voiceBytesEstimate(characters: number): number {
  return Math.ceil(characters * 0.06 * 24_000) + 64 * 1024;
}

/** The first 16 hex characters of SHA-256 over the voice and the line. */
export function voiceInputHash(voiceId: string, text: string): string {
  return createHash('sha256').update(`${voiceId}\n${text}`, 'utf8').digest('hex').slice(0, 16);
}

/** The voice step's charge key; `attempt` above 0 for a line made again after a failure. */
export function voiceChargeKey(
  clipId: string,
  revision: number,
  hash: string,
  attempt = 0,
): string {
  const key = `clips.ai:voice:${clipId}:${revision}:${hash}`;
  return attempt > 0 ? `${key}:${attempt}` : key;
}

/** What the voice of `text` costs, in AI minutes. */
export function voicePrice(text: string): number {
  return aiMinutesCost('voice', text.length);
}

export interface VoiceOutcome {
  job: ClipJobView;
  /** AI minutes charged by this request (0 when the same line and voice were answered again). */
  price: number;
  /** The same line and voice were already made or being made: that job is answered, nothing charged. */
  reused: boolean;
  /** The AI minutes after the charge; null when nothing was charged. */
  meter: MeterView | null;
}

type Repeat = { kind: 'reuse'; job: ClipJob } | { kind: 'new'; attempt: number };

@Injectable()
export class ClipVoiceService {
  private readonly logger = new Logger(ClipVoiceService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly items: ClipItemService,
    private readonly jobs: ClipJobsService,
    private readonly jobsRepository: ClipJobsRepository,
    private readonly repository: ClipVoiceRepository,
    private readonly limits: ClipLimitsGuard,
    private readonly usage: UsageService,
    private readonly mediaService: MediaServiceProbe,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('CLIPS_TTS', { infer: true }) === 'true';
  }

  /** `GET /clips/voices`. */
  async voices(): Promise<{ enabled: boolean; voices: VoiceView[] }> {
    const enabled = this.enabled && (await this.mediaService.state()) === 'ok';
    return { enabled, voices: voiceViews() };
  }

  /** `POST /clips/:clipId/voice`: see the file comment. */
  async make(
    orgId: string,
    userId: string | null,
    clipId: string,
    body: MakeVoiceInput,
  ): Promise<VoiceOutcome> {
    await this.limits.assertEnabled(orgId);
    if (!this.enabled || (await this.mediaService.state()) !== 'ok') {
      throw new ClipErrorException(HttpStatus.SERVICE_UNAVAILABLE, 'voice_off', {
        message: CLIP_VOICE_MESSAGES.OFF,
      });
    }
    const clip = await this.items.requireClip(orgId, clipId);
    const voice = findVoice(body.voiceId);
    if (!voice || !voiceReads(voice.languages, body.text)) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'voice_language', {
        message: CLIP_VOICE_MESSAGES.LANGUAGE,
      });
    }

    const first = await this.repeatOf(orgId, clip.id, body);
    if (first.kind === 'reuse') return reused(first.job);

    const price = voicePrice(body.text);
    await this.limits.assertStorage(orgId, voiceBytesEstimate(body.text.length));
    const jobId = this.jobs.newJobId();
    const jobRow = await this.jobs.build({
      id: jobId,
      orgId,
      userId,
      kind: 'SPEECH',
      clipId: clip.id,
      videoId: null,
      input: speechInputSchema.parse({
        text: body.text,
        voiceId: voice.id,
        aiMinutes: price,
      }),
    });

    // The row first, so a double click finds this job instead of making a second.
    const written = await serializable(async (tx) => {
      const repeat = await this.repeatOf(orgId, clip.id, body, tx);
      if (repeat.kind === 'reuse') return { kind: 'reuse' as const, job: repeat.job };
      const job = await this.jobsRepository.create(jobRow, tx);
      return { kind: 'created' as const, job, attempt: repeat.attempt };
    });
    if (written.kind === 'reuse') return reused(written.job);

    const hash = voiceInputHash(voice.id, body.text);
    const baseKey = voiceChargeKey(clip.id, body.revision, hash, written.attempt);
    let meter: MeterView;
    try {
      let charge = await this.usage.consume(orgId, AI_MINUTES_METER, price, {
        idempotencyKey: baseKey,
        refId: jobId,
        meta: { step: 'voice', clipId: clip.id },
      });
      if (charge.duplicate) {
        // The key belongs to an earlier job that is gone (its charge given back):
        // this job pays for itself under a key of its own.
        charge = await this.usage.consume(orgId, AI_MINUTES_METER, price, {
          idempotencyKey: `${baseKey}:${jobId}`,
          refId: jobId,
          meta: { step: 'voice', clipId: clip.id },
        });
      }
      meter = toMeterView(charge.state);
    } catch (error) {
      // Refused (402) or the ledger failed: the job never runs and nothing stays charged.
      await this.repository.removeJob(orgId, jobId);
      await this.usage.reverseAllFor(orgId, jobId);
      throw error;
    }

    await this.jobs.start(written.job);
    const job = (await this.jobsRepository.find(orgId, jobId)) ?? written.job;
    this.logger.log(
      JSON.stringify({
        event: 'clips.voice.started',
        orgId,
        clipId: clip.id,
        jobId,
        voice: voice.id,
        characters: body.text.length,
        aiMinutes: price,
        attempt: written.attempt,
      }),
    );
    return { job: toJobView(job), price, reused: false, meter };
  }

  /**
   * The clip's job for the same voice and line that can be answered again
   * (still running, or done with its sound still there), or how many such
   * jobs ended without a sound (the next try's number).
   */
  private async repeatOf(
    orgId: string,
    clipId: string,
    body: Pick<MakeVoiceInput, 'text' | 'voiceId'>,
    tx?: ClipsTx,
  ): Promise<Repeat> {
    const rows = await this.repository.speechJobs(orgId, clipId, tx);
    let spent = 0;
    for (const job of rows) {
      const input = speechInputSchema.safeParse(job.input);
      if (!input.success || input.data.voiceId !== body.voiceId || input.data.text !== body.text) {
        continue;
      }
      if (OPEN_JOB_STATUSES.includes(job.status)) return { kind: 'reuse', job };
      if (job.status === 'DONE') {
        const output = speechOutputSchema.safeParse(job.output);
        const assetId = output.success ? output.data.assetId : null;
        if (assetId && (await this.repository.soundExists(orgId, assetId, tx))) {
          return { kind: 'reuse', job };
        }
      }
      spent += 1;
    }
    return { kind: 'new', attempt: spent };
  }
}

function reused(job: ClipJob): VoiceOutcome {
  return { job: toJobView(job), price: 0, reused: true, meter: null };
}
