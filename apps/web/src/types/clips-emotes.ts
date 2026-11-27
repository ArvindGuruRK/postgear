/**
 * Emote Maker (Sprint 13, Module 14): what `POST /clips/emotes/export` and
 * `GET /clips/emotes/:jobId` answer. The file shapes are the engine's own
 * (`emoteFileSchema`), so the page and the worker never disagree.
 */
import type { EmoteFile, EmotePlatform, EmoteRequest } from '@postgear/video-engine';
import type { ClipJobView } from './clips';

export type EmoteExportBody = EmoteRequest;

export interface EmoteFileView extends EmoteFile {
  /** A five minute address; null for a file left out, or once the 24 hours are over. */
  url: string | null;
}

export interface EmoteResultView {
  platform: EmotePlatform;
  files: EmoteFileView[];
  zip: { name: string; bytes: number; url: string | null };
  /** Made from a clip's sharp range rather than the light copy. */
  sharp: boolean;
  expiresAt: string | null;
  expired: boolean;
}

export interface EmoteView {
  job: ClipJobView;
  /** Null until the job is done. */
  emote: EmoteResultView | null;
}

export interface EmoteExportOutcome extends EmoteView {
  /** The job finished (done, failed or cancelled) while the request waited. */
  finished: boolean;
}
