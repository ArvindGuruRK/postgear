/**
 * A clip's captions (Sprint 13, Module 03).
 *
 * The clip document is the editor's: it saves through `PATCH /clips/:clipId`
 * with its revision, and every change is one step of its undo history. So
 * these routes never write the document. They make sure the words exist, and
 * answer the captions `track` for the editor to put in the document itself
 * (`withCaptionsTrack`), which the next save checks at the door
 * (`ClipEditsService`: a track may only name a transcript of this clip's
 * video, in this workspace).
 *
 * - **Add** (`POST /clips/:clipId/captions`): listening is asked for the
 *   stretches the clip plays, each widened by Sprint 12's handles, so a small
 *   trim outward needs no new listening. Parts of the video the clip cut out
 *   are never listened to. Not listened to yet: 202 with the job and its
 *   price (charged by `ClipTranscriptsService.ensure`, never here); the
 *   editor asks again when the job ends, and that second call is free.
 *   Listened to: 200 with the track and the words.
 * - **From a file** (`POST /clips/:clipId/captions/from-file`): an SRT or VTT
 *   file becomes a transcript of this clip alone (`clipId` on its row), never
 *   merged into what was listened to. Free, no listening, and it works with
 *   the AI service off. The file's clock is worked out, not asked: a file
 *   longer than the clip is on the video's clock, a file that fits the clip
 *   is on the clip's (placed through the clip's parts, so cuts and speeds
 *   are right), and whichever is tried first, the other is tried when no
 *   line lands inside the clip.
 * - **Words** (`GET /clips/:clipId/words`): the words of the clip's captions
 *   (or of the video, when it has none yet) for the editor and the preview.
 * - **Translate** (`POST /clips/:clipId/captions/translate`): the clip's
 *   sentences, with the person's own word changes, are translated a line
 *   each and take their sentence's time. Priced by the clip's length and
 *   charged once per attempt; any failure gives the minutes back. The same
 *   request twice is answered from the stored translation, free.
 *
 * Nothing here logs a word of speech: events carry ids and counts.
 */
import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { type Clip, ClipAssetKind, type ClipVideo, type Prisma, prisma } from '@postgear/db';
import { clipKeys } from '@postgear/storage';
import {
  aiMinutesCost,
  applyFixes,
  type CaptionsTrack,
  captionsTrackOf,
  type ClipDocument,
  clipClockPlacer,
  clipSourceRanges,
  createCaptionsTrack,
  DEFAULT_CAPTION_STYLE,
  HANDLE_MS,
  isBuiltInCaptionStyle,
  isTranscriptLanguage,
  languageName,
  mergeRanges,
  type MsRange,
  outputDuration,
  parseSubtitleCues,
  parseSubtitleFile,
  readTranscriptAssetMeta,
  resolveStyle,
  safeParseClipDocument,
  SUBTITLE_FILE_MAX_BYTES,
  SubtitleFileError,
  type SuppliedTranscript,
  type Transcript,
  transcriptAssetMeta,
  translatedTranscript,
  type TranslationLine,
  translationLines,
} from '@postgear/video-engine';
import { stripControlChars } from '../../../common/sanitize';
import { AI_ENGINE, type AiEngine } from '../../ai/engine/engine.types';
import { UsageService } from '../../entitlements/usage.service';
import { ClipItemService } from '../clip/clip-item.service';
import { ClipErrorException } from '../clip-error.exception';
import { CLIPS_MESSAGES } from '../clips.messages';
import { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { ClipTranscriptStore, TRANSCRIPT_MIME } from '../transcripts/clip-transcript-store';
import {
  AI_MINUTES_METER,
  ClipTranscriptsService,
  type EnsureOutcome,
  type MeterView,
  type TranscriptView,
  toMeterView,
} from '../transcripts/clip-transcripts.service';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import { ClipCaptionStylesService } from './clip-caption-styles.service';
import type { AddCaptionsInput, TranslateCaptionsInput } from './clip-captions.schema';

/** Lines sent to the model in one call. A long clip is several calls, in order. */
export const TRANSLATE_BATCH_LINES = 60;
/** How long one call may take before it is given up (and the minutes given back). */
export const TRANSLATE_CALL_TIMEOUT_MS = 60_000;
/** A clip keeps this many transcripts of its own (files and translations); the oldest go first. */
export const MAX_CLIP_TRANSCRIPTS = 12;

export interface CaptionsFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

export type AddCaptionsOutcome =
  | (Extract<EnsureOutcome, { covered: false }> & { covered: false })
  | { covered: true; track: CaptionsTrack; transcript: TranscriptView; price: 0 };

export interface FromFileOutcome {
  track: CaptionsTrack;
  transcript: TranscriptView;
  /** Lines of the file left out because they fall outside the clip. */
  skipped: number;
  /** A sentence about the skipped lines, or null when none were. */
  note: string | null;
}

export interface TranslateOutcome {
  track: CaptionsTrack;
  transcript: TranscriptView;
  /** AI minutes this request charged: 0 when the translation was already stored. */
  price: number;
  reused: boolean;
  meter?: MeterView;
}

export interface WordsOutcome {
  transcript: TranscriptView | null;
  /** The stretches of the video the clip plays. */
  ranges: MsRange[];
  /** True when the clip's captions name a transcript that is no longer there. */
  missing: boolean;
  /**
   * What Add Captions would cost right now, in AI minutes: 0 when the clip's
   * part of the video was already listened to. The button shows this number,
   * and `ensure` charges by the same sum.
   */
  price: number;
}

interface ClipContext {
  clip: Clip;
  video: ClipVideo & { durationMs: number };
  document: ClipDocument;
  /** The stretches the clip plays, merged. */
  ranges: MsRange[];
  /** The same, each widened by the handles and held inside the video. */
  wide: MsRange[];
}

@Injectable()
export class ClipCaptionsService {
  private readonly logger = new Logger(ClipCaptionsService.name);
  /** Translations being made right now, so a double click is one call and one charge. */
  private readonly translating = new Map<string, Promise<TranslateOutcome>>();

  constructor(
    private readonly items: ClipItemService,
    private readonly videos: ClipVideosRepository,
    private readonly transcripts: ClipTranscriptsService,
    private readonly styles: ClipCaptionStylesService,
    private readonly store: ClipTranscriptStore,
    private readonly usage: UsageService,
    private readonly limits: ClipLimitsGuard,
    @Inject(AI_ENGINE) private readonly ai: AiEngine,
  ) {}

  /** `POST /clips/:clipId/captions`: see the file comment. */
  async add(
    orgId: string,
    userId: string,
    clipId: string,
    body: AddCaptionsInput,
  ): Promise<AddCaptionsOutcome> {
    const context = await this.context(orgId, clipId);
    const style = await this.styleFor(orgId, body.styleId ?? DEFAULT_CAPTION_STYLE);

    const outcome = await this.transcripts.ensure(orgId, userId, context.video.id, {
      ranges: context.wide,
      ...(body.language ? { language: body.language } : {}),
    });
    if (!outcome.covered) return outcome;

    const row = await this.transcripts.transcriptRow(
      orgId,
      context.video.id,
      body.language ?? 'auto',
    );
    const transcript = row ? await this.transcripts.viewOf(row, context.wide) : null;
    if (!row || !transcript) throw new ClipErrorException(HttpStatus.CONFLICT, 'captions_missing');
    if (!hasWordsIn(transcript, context.ranges)) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'no_speech');
    }

    return {
      covered: true,
      track: createCaptionsTrack({
        transcriptAssetId: row.id,
        language: row.meta.language,
        styleId: style.id,
        look: style.look,
      }),
      transcript,
      price: 0,
    };
  }

  /** `GET /clips/:clipId/words`. */
  async words(orgId: string, clipId: string): Promise<WordsOutcome> {
    const context = await this.context(orgId, clipId);
    const track = captionsTrackOf(context.document);
    const row = track
      ? await this.transcripts.assetRow(orgId, context.video.id, track.transcriptAssetId)
      : await this.transcripts.transcriptRow(orgId, context.video.id, 'auto');
    const transcript = row ? await this.transcripts.viewOf(row, context.wide) : null;
    const { price } = await this.transcripts.quote(orgId, context.video.id, {
      ranges: context.wide,
    });
    return {
      transcript,
      ranges: context.ranges,
      missing: track !== null && transcript === null,
      price,
    };
  }

  /** `POST /clips/:clipId/captions/from-file`: see the file comment. */
  async fromFile(
    orgId: string,
    clipId: string,
    file: CaptionsFile | undefined,
    fields: { language?: string; styleId?: string },
  ): Promise<FromFileOutcome> {
    const context = await this.context(orgId, clipId);
    if (!file || file.size === 0) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'captions_file_unreadable');
    }
    if (file.size > SUBTITLE_FILE_MAX_BYTES) {
      throw new ClipErrorException(HttpStatus.PAYLOAD_TOO_LARGE, 'captions_file_too_big');
    }
    const style = await this.styleFor(orgId, fields.styleId ?? DEFAULT_CAPTION_STYLE);
    const language = await this.fileLanguage(orgId, context, fields.language);

    const supplied = readSuppliedFile(decodeText(file.buffer), context, language);
    const fileName = cleanFileName(file.originalname);
    const row = await this.keep(orgId, context, supplied.transcript, { fileName });

    const transcript = await this.transcripts.viewOf(row, context.wide);
    if (!transcript) throw new ClipErrorException(HttpStatus.CONFLICT, 'captions_missing');

    this.logger.log(
      JSON.stringify({
        event: 'clips.captions.file',
        orgId,
        clipId,
        assetId: row.id,
        format: supplied.format,
        cues: supplied.cues,
        skipped: supplied.skipped,
        words: supplied.transcript.words.length,
      }),
    );
    return {
      track: createCaptionsTrack({
        transcriptAssetId: row.id,
        language,
        styleId: style.id,
        look: style.look,
      }),
      transcript,
      skipped: supplied.skipped,
      note: supplied.skipped > 0 ? CLIPS_MESSAGES.CAPTION_LINES_SKIPPED(supplied.skipped) : null,
    };
  }

  /** `POST /clips/:clipId/captions/translate`: see the file comment. */
  async translate(
    orgId: string,
    userId: string,
    clipId: string,
    body: TranslateCaptionsInput,
  ): Promise<TranslateOutcome> {
    await this.limits.assertEnabled(orgId);
    const context = await this.context(orgId, clipId);
    const track = captionsTrackOf(context.document);
    if (!track) throw new ClipErrorException(HttpStatus.CONFLICT, 'captions_first');
    if (!isTranscriptLanguage(body.language)) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'language_unsupported');
    }

    const shown = await this.transcripts.assetRow(orgId, context.video.id, track.transcriptAssetId);
    if (!shown) throw new ClipErrorException(HttpStatus.CONFLICT, 'captions_missing');
    // A translation is always made from the words that were said, never from another translation.
    const origin =
      (shown.meta.origin
        ? await this.transcripts.assetRow(orgId, context.video.id, shown.meta.origin)
        : null) ?? shown;

    if (origin.meta.language === body.language) {
      if (origin.id === shown.id) {
        throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'translate_same_language');
      }
      // Back to the language it was said in: the words are already there.
      return this.answer(context, track, origin, 0, true);
    }

    const stored = await this.store.read(origin.key);
    if (!stored) throw new ClipErrorException(HttpStatus.CONFLICT, 'captions_missing');
    const spoken = withTrackEdits(
      applyFixes(stored, origin.meta.fixes),
      origin.id === shown.id ? track : null,
    );
    const lines = translationLines(spoken, context.wide);
    if (lines.length === 0) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'no_speech');
    }

    const inputHash = hashOf(body.language, origin.id, lines);
    const existing = await this.storedTranslation(orgId, context, body.language, inputHash);
    if (existing) return this.answer(context, track, existing, 0, true);

    const key = `${context.clip.id}:${inputHash}`;
    const running = this.translating.get(key);
    if (running) return running;
    const work = this.runTranslation(orgId, userId, context, track, origin, body.language, {
      lines,
      inputHash,
    }).finally(() => this.translating.delete(key));
    this.translating.set(key, work);
    return work;
  }

  /**
   * A clip is being deleted: the transcripts of its own go with it, unless a
   * copy of the clip still shows one, which then becomes that copy's. Answers
   * the storage keys to delete once the rows are gone.
   */
  async releaseClip(orgId: string, clip: Pick<Clip, 'id' | 'videoId'>): Promise<string[]> {
    const own = await prisma.clipAsset.findMany({
      where: { organizationId: orgId, clipId: clip.id, kind: ClipAssetKind.TRANSCRIPT },
      select: { id: true, key: true },
    });
    if (own.length === 0) return [];
    const others = await prisma.clip.findMany({
      where: { organizationId: orgId, videoId: clip.videoId, id: { not: clip.id } },
      select: { id: true, document: true },
    });
    const doomed: string[] = [];
    for (const asset of own) {
      const heir = others.find((other) => shownTranscriptId(other.document) === asset.id);
      if (heir) {
        await prisma.clipAsset.updateMany({
          where: { id: asset.id, organizationId: orgId },
          data: { clipId: heir.id },
        });
        continue;
      }
      await prisma.clipAsset.deleteMany({ where: { id: asset.id, organizationId: orgId } });
      doomed.push(asset.key);
    }
    return doomed;
  }

  // -------------------------------------------------------------------------

  private async runTranslation(
    orgId: string,
    userId: string,
    context: ClipContext,
    track: CaptionsTrack,
    origin: { id: string; meta: { language: string } },
    language: string,
    input: { lines: TranslationLine[]; inputHash: string },
  ): Promise<TranslateOutcome> {
    const writer = this.ai.createSnippetWriter({ orgId });
    if (!writer) throw new ClipErrorException(HttpStatus.SERVICE_UNAVAILABLE, 'translate_off');

    const price = aiMinutesCost('translate', outputDuration(context.document));
    // A fresh id for every attempt: a failed attempt is reversed in full, and the next one is
    // charged again. The same request is answered once through the stored translation instead.
    const attemptId = randomUUID();
    const charge = await this.usage.consume(orgId, AI_MINUTES_METER, price, {
      idempotencyKey: `clips.ai:translate:${attemptId}`,
      refId: attemptId,
      meta: { step: 'translate', clipId: context.clip.id, language },
    });

    let kept = false;
    try {
      const translated: string[] = [];
      for (let at = 0; at < input.lines.length; at += TRANSLATE_BATCH_LINES) {
        const batch = input.lines.slice(at, at + TRANSLATE_BATCH_LINES);
        const result = await writer.translate(
          {
            from: languageName(origin.meta.language),
            to: languageName(language),
            toCode: language,
            lines: batch.map((line) => line.text),
          },
          { signal: AbortSignal.timeout(TRANSLATE_CALL_TIMEOUT_MS) },
        );
        translated.push(...result.lines);
      }
      const transcript = translatedTranscript({
        lines: input.lines,
        translated,
        language,
        model: `translate:${this.ai.modelName ?? 'model'}`.slice(0, 80),
        ranges: context.wide,
      });
      if (transcript.words.length === 0) throw new Error('The translation has no words.');

      const row = await this.keep(orgId, context, transcript, {
        origin: origin.id,
        inputHash: input.inputHash,
      });
      kept = true;
      this.logger.log(
        JSON.stringify({
          event: 'clips.captions.translated',
          orgId,
          userId,
          clipId: context.clip.id,
          assetId: row.id,
          language,
          lines: input.lines.length,
          aiMinutes: price,
        }),
      );
      const answer = await this.answer(context, track, row, price, false);
      return { ...answer, meter: toMeterView(charge.state) };
    } catch (error) {
      if (kept) throw error;
      await this.usage.reverseAllFor(orgId, attemptId);
      if (error instanceof ClipErrorException) throw error;
      this.logger.warn(
        JSON.stringify({
          event: 'clips.captions.translate_failed',
          orgId,
          clipId: context.clip.id,
          language,
          lines: input.lines.length,
          // The kind only: a provider's message can quote what was sent.
          reason: (error as { kind?: string })?.kind ?? (error as Error)?.name ?? 'unknown',
        }),
      );
      throw new ClipErrorException(HttpStatus.BAD_GATEWAY, 'translate_failed');
    }
  }

  private async answer(
    context: ClipContext,
    track: CaptionsTrack,
    row: { id: string; key: string; meta: NonNullable<ReturnType<typeof readTranscriptAssetMeta>> },
    price: number,
    reused: boolean,
  ): Promise<TranslateOutcome> {
    const transcript = await this.transcripts.viewOf(row, context.wide);
    if (!transcript) throw new ClipErrorException(HttpStatus.CONFLICT, 'captions_missing');
    return {
      // The place, size and style stay; the editor resets the word changes (`withCaptionsTrack`).
      track: { ...track, transcriptAssetId: row.id, language: row.meta.language, edits: {} },
      transcript,
      price,
      reused,
    };
  }

  /** This clip's stored translation of exactly these sentences into `language`, if any. */
  private async storedTranslation(
    orgId: string,
    context: ClipContext,
    language: string,
    inputHash: string,
  ) {
    const rows = await prisma.clipAsset.findMany({
      where: {
        organizationId: orgId,
        videoId: context.video.id,
        clipId: context.clip.id,
        kind: ClipAssetKind.TRANSCRIPT,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, key: true, meta: true },
    });
    for (const row of rows) {
      const meta = readTranscriptAssetMeta(row.meta);
      if (
        meta?.source === 'translated' &&
        meta.language === language &&
        meta.inputHash === inputHash
      ) {
        return { id: row.id, key: row.key, meta };
      }
    }
    return null;
  }

  /**
   * Stores a transcript of this clip's own: the file first, then its row. A
   * row that cannot be written takes its file back. The oldest of the clip's
   * own transcripts go once it keeps more than `MAX_CLIP_TRANSCRIPTS`, never
   * the one its saved document shows.
   */
  private async keep(
    orgId: string,
    context: ClipContext,
    transcript: Transcript,
    extra: { fileName?: string; origin?: string; inputHash?: string },
  ) {
    const key = clipKeys.videoFile(orgId, context.video.id, 'transcript', 'json.gz');
    const bytes = await this.store.write(key, transcript);
    const meta = { ...transcriptAssetMeta(transcript, [], extra.fileName) };
    if (extra.origin) meta.origin = extra.origin;
    if (extra.inputHash) meta.inputHash = extra.inputHash;
    let id: string;
    try {
      const row = await prisma.clipAsset.create({
        data: {
          organizationId: orgId,
          videoId: context.video.id,
          clipId: context.clip.id,
          kind: ClipAssetKind.TRANSCRIPT,
          key,
          bytes: BigInt(bytes),
          mimeType: TRANSCRIPT_MIME,
          meta: meta as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      id = row.id;
    } catch (error) {
      await this.store.delete(key).catch(() => undefined);
      throw error;
    }
    await this.prune(orgId, context, id);
    return { id, key, meta };
  }

  private async prune(orgId: string, context: ClipContext, keepId: string): Promise<void> {
    const rows = await prisma.clipAsset.findMany({
      where: {
        organizationId: orgId,
        clipId: context.clip.id,
        kind: ClipAssetKind.TRANSCRIPT,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, key: true },
    });
    const shown = captionsTrackOf(context.document)?.transcriptAssetId;
    const extra = rows
      .filter((row) => row.id !== keepId && row.id !== shown)
      .slice(Math.max(0, MAX_CLIP_TRANSCRIPTS - 2));
    for (const row of extra) {
      await prisma.clipAsset.deleteMany({ where: { id: row.id, organizationId: orgId } });
      await this.store.delete(row.key).catch(() => undefined);
    }
  }

  /** The language of a supplied file: the one named, else the video's own, else English. */
  private async fileLanguage(
    orgId: string,
    context: ClipContext,
    asked: string | undefined,
  ): Promise<string> {
    if (asked !== undefined && asked !== 'auto') {
      if (!isTranscriptLanguage(asked)) {
        throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'language_unsupported');
      }
      return asked;
    }
    const heard = await this.transcripts.transcriptRow(orgId, context.video.id, 'auto');
    return heard?.meta.language ?? 'en';
  }

  /** A built-in style or one of the workspace's own; 404 `caption_style_not_found` otherwise. */
  private async styleFor(orgId: string, styleId: string) {
    if (isBuiltInCaptionStyle(styleId)) return resolveStyle(styleId).style;
    const own = await this.styles.findOwn(orgId, styleId);
    if (!own) throw new ClipErrorException(HttpStatus.NOT_FOUND, 'caption_style_not_found');
    return own;
  }

  /** The clip, its live video and its document; 404 for another workspace's. */
  private async context(orgId: string, clipId: string): Promise<ClipContext> {
    const clip = await this.items.requireClip(orgId, clipId);
    const video = await this.videos.findLive(orgId, clip.videoId);
    const parsed = safeParseClipDocument(clip.document);
    if (!video || video.durationMs === null || !parsed.ok) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'clip_document_invalid', {
        message: CLIPS_MESSAGES.CLIP_DOCUMENT_INVALID,
      });
    }
    const duration = video.durationMs;
    const ranges = mergeRanges(
      clipSourceRanges(parsed.doc)
        .map((range) => ({ fromMs: range.fromMs, toMs: Math.min(range.toMs, duration) }))
        .filter((range) => range.toMs > range.fromMs),
    );
    const wide = mergeRanges(
      ranges.map((range) => ({
        fromMs: Math.max(0, range.fromMs - HANDLE_MS),
        toMs: Math.min(duration, range.toMs + HANDLE_MS),
      })),
    );
    if (ranges.length === 0) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'clip_document_invalid', {
        message: CLIPS_MESSAGES.CLIP_DOCUMENT_INVALID,
      });
    }
    return { clip, video: { ...video, durationMs: duration }, document: parsed.doc, ranges, wide };
  }
}

/** The transcript a stored document's captions show, or null. Never throws. */
function shownTranscriptId(document: unknown): string | null {
  const parsed = safeParseClipDocument(document);
  return parsed.ok ? (captionsTrackOf(parsed.doc)?.transcriptAssetId ?? null) : null;
}

function hasWordsIn(transcript: TranscriptView, ranges: readonly MsRange[]): boolean {
  return transcript.words.some((word) => {
    const mid = (word.start + word.end) / 2;
    return ranges.some((range) => mid >= range.fromMs && mid < range.toMs);
  });
}

/** The words as this clip shows them: its own text changes on, its hidden words out. */
function withTrackEdits(
  transcript: Transcript,
  track: Pick<CaptionsTrack, 'edits'> | null,
): Pick<Transcript, 'words'> {
  if (!track) return transcript;
  const words = [];
  for (const word of transcript.words) {
    const edit = Object.hasOwn(track.edits, String(word.i))
      ? track.edits[String(word.i)]
      : undefined;
    if (edit?.hidden) continue;
    const text = (edit?.text ?? word.text).trim();
    if (text.length > 0) words.push({ ...word, text });
  }
  return { words };
}

function hashOf(language: string, originId: string, lines: readonly TranslationLine[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify([language, originId, lines.map((line) => [line.from, line.to, line.text])]),
    )
    .digest('hex')
    .slice(0, 32);
}

/** UTF-8, or UTF-16 when the file says so with its first bytes (Windows editors save SRT that way). */
export function decodeText(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  }
  const text = new TextDecoder('utf-8').decode(buffer);
  // A zero byte means this was never text (a video, an archive).
  if (text.includes('\u0000')) {
    throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'captions_file_unreadable');
  }
  return text;
}

/**
 * The file as this clip's transcript. Tries the clock the file most likely
 * uses first (see the file comment), then the other; 422 when it has no
 * lines at all, or none inside the clip on either clock.
 */
export function readSuppliedFile(
  text: string,
  context: Pick<ClipContext, 'document' | 'ranges' | 'wide'>,
  language: string,
): SuppliedTranscript {
  let fileEndMs: number;
  try {
    const { cues } = parseSubtitleCues(text);
    fileEndMs = cues.reduce((latest, cue) => Math.max(latest, cue.end), 0);
  } catch (error) {
    throw fileRefusal(error);
  }
  const first = context.wide[0] as MsRange;
  const last = context.wide[context.wide.length - 1] as MsRange;
  const window = { fromMs: first.fromMs, toMs: last.toMs };
  const onVideoClock = () => parseSubtitleFile(text, { language, window });
  const onClipClock = () =>
    parseSubtitleFile(text, { language, window, place: clipClockPlacer(context.document) });
  // Two seconds of slack: a file made for the clip often ends a moment after it.
  const fitsTheClip = fileEndMs <= outputDuration(context.document) + 2_000;
  const order = fitsTheClip ? [onClipClock, onVideoClock] : [onVideoClock, onClipClock];

  for (const attempt of order) {
    try {
      return attempt();
    } catch (error) {
      if (!(error instanceof SubtitleFileError) || error.reason !== 'no_cues') {
        throw fileRefusal(error);
      }
    }
  }
  throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'captions_file_outside');
}

function fileRefusal(error: unknown): Error {
  if (!(error instanceof SubtitleFileError)) return error as Error;
  return error.reason === 'too_big'
    ? new ClipErrorException(HttpStatus.PAYLOAD_TOO_LARGE, 'captions_file_too_big')
    : new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'captions_file_unreadable');
}

/** The file's own name without any folder, cleaned, for "From your file: episode14.srt". */
function cleanFileName(name: string): string | undefined {
  const base = stripControlChars(name ?? '')
    .split(/[\\/]/)
    .pop()
    ?.replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return base && base.length > 0 ? base : undefined;
}
