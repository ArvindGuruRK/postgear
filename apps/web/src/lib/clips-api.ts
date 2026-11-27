/**
 * The browser's calls to the `/clips` routes (Sprint 12). Every call goes
 * through `api()` (cookies, typed `ApiError` with the refusal `code`, the
 * 402 listener that refreshes the plan's limits); the job stream is read
 * with `lib/sse.ts`.
 *
 * Later modules add their calls here (videos, uploads, clips, exports).
 */

import type {
  CaptionLook,
  ChannelPlatformId,
  ClipSetup,
  LibraryCategoryCount,
  LibrarySearchPage,
  LibrarySoundPage,
  SoundCategory,
  SoundCategoryCount,
  SoundFileView,
  SoundKind,
  SoundUploadView,
  StickerCategory,
  StickerFileView,
  StickerKind,
  StickerUploadView,
} from '@postgear/video-engine';
import type {
  AddCaptionsOutcome,
  CaptionStylesView,
  CaptionStyleView,
  CaptionsFileOutcome,
  ClipChannelPreview,
  ClipChannelView,
  ClipDetail,
  ClipDocument,
  ClipExportView,
  ClipFacesEnsure,
  ClipFacesRead,
  ClipImportOutcome,
  ClipJobView,
  ClipLayout,
  ClipListPage,
  ClipListSort,
  ClipPlatformId,
  ClipPreviewView,
  ClipProbe,
  ClipSharpState,
  ClipSource,
  ClipStatusFilter,
  ClipStreamsPage,
  ClipsStatus,
  ClipUploadStarted,
  ClipVideoDetail,
  ClipVideoPage,
  ClipVideoSort,
  ClipVideoView,
  ClipView,
  ClipVoicesView,
  ClipWordsView,
  ComingUpView,
  DownloadStarted,
  DownloadView,
  ExportQuality,
  HighlightsStarted,
  HighlightsView,
  ListenOutcome,
  ListKind,
  ListPeriod,
  ListSort,
  MakeVoiceOutcome,
  Ratio,
  SavedLayoutView,
  SetupPriceView,
  TranslateCaptionsOutcome,
  VideoTranscriptView,
} from '@/types/clips';
import { api, uploadFile } from './api';

const jobPath = (jobId: string) => `/clips/jobs/${encodeURIComponent(jobId)}`;
const downloadPath = (jobId: string) => `/clips/downloads/${encodeURIComponent(jobId)}`;
const clipPath = (clipId: string) => `/clips/${encodeURIComponent(clipId)}`;

/**
 * Imports a video from a link. The server probes the link itself and never
 * trusts a probe the browser sends. `existing: true` (and no job) when the
 * workspace already has it; 422 `rights_required` without the tick.
 */
export function importClipVideo(url: string, rightsConfirmed: boolean): Promise<ClipImportOutcome> {
  return api<ClipImportOutcome>('/clips/videos', {
    method: 'POST',
    body: { url, rightsConfirmed },
  });
}

/** One video (`GET /clips/videos/:videoId`); the page's players read the rest of its answer in Module 07. */
export function getClipVideo(
  videoId: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ video: ClipVideoView }> {
  return api(`/clips/videos/${encodeURIComponent(videoId)}`, { signal: options.signal });
}

/** A new clip of a READY video: 409 `video_not_ready`, 422 `clip_range_invalid`. */
export function createClip(
  videoId: string,
  fromMs: number,
  toMs: number,
): Promise<{ clip: ClipView; job: ClipJobView | null }> {
  return api('/clips', { method: 'POST', body: { videoId, fromMs, toMs } });
}

/** The clip, its video, the light copy to play and whether the sharp range is in. */
export function getClip(
  clipId: string,
  options: { signal?: AbortSignal } = {},
): Promise<ClipDetail> {
  return api<ClipDetail>(clipPath(clipId), { signal: options.signal });
}

/**
 * Starts an export of the clip as it is now (Module 15): 409 `export_running`
 * while one runs, 409 `clip_changed_elsewhere` when `revision` is not the
 * saved one, 402 `clips_quality_requires_plan` above the plan's quality.
 */
export async function exportClip(
  clipId: string,
  quality: ExportQuality,
  revision?: number,
): Promise<ClipJobView> {
  const { job } = await api<{ job: ClipJobView }>(`${clipPath(clipId)}/exports`, {
    method: 'POST',
    body: revision === undefined ? { quality } : { quality, revision },
  });
  return job;
}

/** The clip's newest five exports, newest first, a running one included. */
export async function listClipExports(
  clipId: string,
  options: { signal?: AbortSignal } = {},
): Promise<ClipExportView[]> {
  const { exports } = await api<{ exports: ClipExportView[] }>(`${clipPath(clipId)}/exports`, {
    signal: options.signal,
  });
  return exports;
}

/** Preview Export: a small copy of the whole clip; answers the running one while it runs. */
export async function previewClip(clipId: string, revision?: number): Promise<ClipJobView> {
  const { job } = await api<{ job: ClipJobView }>(`${clipPath(clipId)}/previews`, {
    method: 'POST',
    body: revision === undefined ? {} : { revision },
  });
  return job;
}

/** The clip's newest Preview Export, with an address to play it once done. */
export async function latestClipPreview(
  clipId: string,
  options: { signal?: AbortSignal } = {},
): Promise<ClipPreviewView | null> {
  const { preview } = await api<{ preview: ClipPreviewView | null }>(
    `${clipPath(clipId)}/previews/latest`,
    { signal: options.signal },
  );
  return preview;
}

/** The video tools, the platforms switched on, and the storage gauge. */
export async function getClipsStatus(options: { signal?: AbortSignal } = {}): Promise<ClipsStatus> {
  const { status } = await api<{ status: ClipsStatus }>('/clips/status', {
    signal: options.signal,
  });
  return status;
}

export async function getClipJob(
  jobId: string,
  options: { signal?: AbortSignal } = {},
): Promise<ClipJobView> {
  const { job } = await api<{ job: ClipJobView }>(jobPath(jobId), { signal: options.signal });
  return job;
}

/** 409 `job_finished` when it ended first; 503 `tools_offline` when the cancel could not reach the worker. */
export async function cancelClipJob(jobId: string): Promise<ClipJobView> {
  const { job } = await api<{ job: ClipJobView }>(`${jobPath(jobId)}/cancel`, { method: 'POST' });
  return job;
}

/** The live progress stream (`progress`, `done`, `failed`, `cancelled`, `error`); GET, read with `lib/sse.ts`. */
export function clipJobEventsPath(jobId: string): string {
  return `${jobPath(jobId)}/events`;
}

// --- Module 06: links and videos ------------------------------------------------

const videoPath = (videoId: string) => `/clips/videos/${encodeURIComponent(videoId)}`;
const uploadPath = (uploadId: string) => `/clips/videos/uploads/${encodeURIComponent(uploadId)}`;
const channelPath = (channelId: string) => `/clips/channels/${encodeURIComponent(channelId)}`;

/**
 * Reads a link: what it is, what the platform says about it, and whether the
 * workspace already has it. Refusals arrive as `ApiError` with our sentence
 * and code (`link_*`, `platform_*`, `clips_*`, `probe_throttled`).
 */
export async function probeLink(
  url: string,
  options: { signal?: AbortSignal } = {},
): Promise<ClipProbe> {
  const { probe } = await api<{ probe: ClipProbe }>('/clips/links/probe', {
    method: 'POST',
    body: { url },
    signal: options.signal,
  });
  return probe;
}

/** Imports the link with the rights tick (the same call as `importClipVideo`, under its Module 06 name). */
export function importVideo(url: string, rightsConfirmed: boolean): Promise<ClipImportOutcome> {
  return importClipVideo(url, rightsConfirmed);
}

/** One page of videos, newest first by default. */
export function listVideos(
  options: { cursor?: string | null; sort?: ClipVideoSort; signal?: AbortSignal } = {},
): Promise<ClipVideoPage> {
  const query = new URLSearchParams();
  if (options.cursor) query.set('cursor', options.cursor);
  if (options.sort && options.sort !== 'newest') query.set('sort', options.sort);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api<ClipVideoPage>(`/clips/videos${suffix}`, { signal: options.signal });
}

/** One video with its signed addresses, its newest import and its clips. */
export function getVideo(
  videoId: string,
  options: { signal?: AbortSignal } = {},
): Promise<ClipVideoDetail> {
  return api<ClipVideoDetail>(videoPath(videoId), { signal: options.signal });
}

/**
 * Find Clips (Module 16): charges the video's AI minutes once and starts the
 * run (202). 402 `clips_ai_minutes_used` when too few are left, 409
 * `highlights_running` while a run is on, 409 `video_not_ready`.
 */
export function startHighlights(videoId: string, setup?: ClipSetup): Promise<HighlightsStarted> {
  return api<HighlightsStarted>(`${videoPath(videoId)}/highlights`, {
    method: 'POST',
    ...(setup ? { body: { setup } } : {}),
  });
}

/** Sprint 13, Module 05: what a Clip Setup costs, line by line, and what is left. Never a charge. */
export function priceClipSetup(
  videoId: string,
  setup: ClipSetup,
  options: { signal?: AbortSignal } = {},
): Promise<SetupPriceView> {
  return api<SetupPriceView>(`${videoPath(videoId)}/setup/price`, {
    method: 'POST',
    body: { setup },
    signal: options.signal,
  });
}

/** The price, the sound note and the latest Find Clips run of a video. */
export function getHighlights(
  videoId: string,
  options: { signal?: AbortSignal } = {},
): Promise<HighlightsView> {
  return api<HighlightsView>(`${videoPath(videoId)}/highlights`, { signal: options.signal });
}

/** Tries a failed import again (409 `video_not_failed` when it is not failed any more). */
export function retryVideo(videoId: string): Promise<{ video: ClipVideoView; job: ClipJobView }> {
  return api(`${videoPath(videoId)}/retry`, { method: 'POST' });
}

/** Stops a video that is still coming in (409 `video_not_importing` once it is ready). */
export function cancelVideo(
  videoId: string,
): Promise<{ message: string; job: ClipJobView | null }> {
  return api(`${videoPath(videoId)}/cancel`, { method: 'POST' });
}

/** Deletes a video, its files and its clips that were never exported. */
export function deleteVideo(videoId: string): Promise<{ message: string }> {
  return api(videoPath(videoId), { method: 'DELETE' });
}

// --- Module 06: uploads in parts -------------------------------------------------

export function startUpload(input: {
  name: string;
  bytes: number;
  mimeType: string;
}): Promise<ClipUploadStarted> {
  return api<ClipUploadStarted>('/clips/videos/uploads', { method: 'POST', body: input });
}

/** One signed address per part asked for (an hour each). */
export async function signParts(
  uploadId: string,
  partNumbers: number[],
  options: { signal?: AbortSignal } = {},
): Promise<Array<{ partNumber: number; url: string }>> {
  const { parts } = await api<{ parts: Array<{ partNumber: number; url: string }> }>(
    `${uploadPath(uploadId)}/parts`,
    { method: 'POST', body: { partNumbers }, signal: options.signal },
  );
  return parts;
}

/** Joins the parts and starts the import. Safe to call twice. */
export function completeUpload(
  uploadId: string,
  parts: Array<{ partNumber: number; etag: string }>,
): Promise<{ video: ClipVideoView; job: ClipJobView | null }> {
  return api(`${uploadPath(uploadId)}/complete`, { method: 'POST', body: { parts } });
}

/** Module 12 (D13-09): imports a file picked in Google Drive, as an upload. */
export function importFromDrive(
  fileId: string,
  accessToken: string,
): Promise<{ video: ClipVideoView; job: ClipJobView | null }> {
  return api('/clips/videos/drive', { method: 'POST', body: { fileId, accessToken } });
}

// --- Module 06: My Channels --------------------------------------------------------

export async function listChannels(
  options: { signal?: AbortSignal } = {},
): Promise<ClipChannelView[]> {
  const { channels } = await api<{ channels: ClipChannelView[] }>('/clips/channels', {
    signal: options.signal,
  });
  return channels;
}

/** 422 `channel_not_found` or `link_is_a_video`, 409 `channel_exists`, 402 `channel_limit`. */
export async function addChannel(
  platform: ChannelPlatformId,
  handle: string,
): Promise<ClipChannelView> {
  const { channel } = await api<{ channel: ClipChannelView }>('/clips/channels', {
    method: 'POST',
    body: { platform, handle },
  });
  return channel;
}

/** Resolves a channel name without saving it (the Add dialog's Check); refuses like `addChannel`. */
export async function checkChannel(
  platform: ChannelPlatformId,
  handle: string,
  options: { signal?: AbortSignal } = {},
): Promise<ClipChannelPreview> {
  const { channel } = await api<{ channel: ClipChannelPreview }>('/clips/channels/check', {
    method: 'POST',
    body: { platform, handle },
    signal: options.signal,
  });
  return channel;
}

export function removeChannel(channelId: string): Promise<{ message: string }> {
  return api(channelPath(channelId), { method: 'DELETE' });
}

export interface ListStreamsOptions {
  kind?: ListKind;
  cursor?: string | null;
  sort?: ListSort;
  period?: ListPeriod;
  hidden?: boolean;
  signal?: AbortSignal;
}

/** One page (50) of a channel's list. Never touches the probe. */
export function listStreams(
  channelId: string,
  options: ListStreamsOptions = {},
): Promise<ClipStreamsPage> {
  const query = new URLSearchParams();
  if (options.kind) query.set('kind', options.kind);
  if (options.cursor) query.set('cursor', options.cursor);
  if (options.sort) query.set('sort', options.sort);
  if (options.period) query.set('period', options.period);
  if (options.hidden) query.set('hidden', 'true');
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api<ClipStreamsPage>(`${channelPath(channelId)}/streams${suffix}`, {
    signal: options.signal,
  });
}

export function hideStream(
  channelId: string,
  externalId: string,
): Promise<{ externalId: string; hidden: boolean }> {
  return api(`${channelPath(channelId)}/hidden/${encodeURIComponent(externalId)}`, {
    method: 'PUT',
  });
}

export function unhideStream(
  channelId: string,
  externalId: string,
): Promise<{ externalId: string; hidden: boolean }> {
  return api(`${channelPath(channelId)}/hidden/${encodeURIComponent(externalId)}`, {
    method: 'DELETE',
  });
}

/** Asks the platform again (429 `refresh_throttled` within 30 seconds). */
export function refreshChannel(channelId: string): Promise<{ refreshedAt: string }> {
  return api(`${channelPath(channelId)}/refresh`, { method: 'POST' });
}

// --- Module 07: clips ---------------------------------------------------------------

export interface ListClipsOptions {
  status?: ClipStatusFilter;
  videoId?: string;
  /** Where the video came from; empty means every source. */
  sources?: readonly ClipSource[];
  page?: number;
  sort?: ClipListSort;
  /** Module 17, the composer's Clips tab: only clips with an exported file, whatever their state. */
  withExport?: boolean;
  /** Module 17: words of the clip's name. */
  q?: string;
  signal?: AbortSignal;
}

/** One page (24) of the workspace's clips with the counts per state, under the same filters. */
export function listClips(options: ListClipsOptions = {}): Promise<ClipListPage> {
  const query = new URLSearchParams();
  if (options.status && options.status !== 'all') query.set('status', options.status);
  if (options.videoId) query.set('videoId', options.videoId);
  if (options.sources && options.sources.length > 0) query.set('source', options.sources.join(','));
  if (options.page && options.page > 1) query.set('page', String(options.page));
  if (options.sort && options.sort !== 'newest') query.set('sort', options.sort);
  if (options.withExport) query.set('withExport', 'true');
  if (options.q?.trim()) query.set('q', options.q.trim());
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api<ClipListPage>(`/clips${suffix}`, { signal: options.signal });
}

export interface SendClipBody {
  channelIds: string[];
  caption: string;
  /** Send the last export of a clip changed since (Send The Old Version). */
  oldVersion?: boolean;
}

/**
 * Module 17, Send To Composer: a draft with the clip's exported file on the
 * chosen channels. 409 `clip_not_exported` or `clip_export_outdated`; 422
 * `clip_does_not_fit`.
 */
export function sendClip(clipId: string, body: SendClipBody): Promise<{ group: string }> {
  return api(`/clips/${encodeURIComponent(clipId)}/send`, { method: 'POST', body });
}

/** Module 17: the waiting posts in the next 14 days that use a clip (Coming Up). */
export function getComingUp(options: { signal?: AbortSignal } = {}): Promise<ComingUpView> {
  return api<ComingUpView>('/clips/coming-up', { signal: options.signal });
}

/** Edit Whole Video: a clip over the whole video (422 `clip_too_long` past 30 minutes). */
export function createWholeClip(
  videoId: string,
): Promise<{ clip: ClipView; job: ClipJobView | null }> {
  return api('/clips', { method: 'POST', body: { videoId, whole: true } });
}

export interface ClipChange {
  title?: string;
  status?: 'DRAFT' | 'HIDDEN';
  document?: ClipDocument;
}

/**
 * Saves a change under the revision lock: 409 `clip_changed_elsewhere` (the
 * current revision in `details.revision`), 422 `clip_document_invalid`, 413
 * `clip_document_too_large`.
 */
export async function updateClip(
  clipId: string,
  revision: number,
  change: ClipChange,
  options: { signal?: AbortSignal; keepalive?: boolean } = {},
): Promise<ClipView> {
  const { clip } = await api<{ clip: ClipView }>(clipPath(clipId), {
    method: 'PATCH',
    body: { revision, ...change },
    signal: options.signal,
    keepalive: options.keepalive,
  });
  return clip;
}

/** Opening a clip to edit it: NEW becomes DRAFT (no revision change). */
export async function openClip(clipId: string): Promise<ClipView> {
  const { clip } = await api<{ clip: ClipView }>(`${clipPath(clipId)}/open`, { method: 'POST' });
  return clip;
}

/** A new DRAFT with the same document and " copy" on the name. */
export async function duplicateClip(clipId: string): Promise<ClipView> {
  const { clip } = await api<{ clip: ClipView }>(`${clipPath(clipId)}/duplicate`, {
    method: 'POST',
  });
  return clip;
}

export function deleteClip(clipId: string): Promise<{ message: string }> {
  return api(clipPath(clipId), { method: 'DELETE' });
}

/**
 * Asks for more of the video around the clip (a trim past what is stored):
 * 202 with the job, or `job: null` when it is already there.
 */
export function requestMoreVideo(
  clipId: string,
  fromMs: number,
  toMs: number,
): Promise<{ job: ClipJobView | null; sharp: ClipSharpState }> {
  return api(`${clipPath(clipId)}/more-video`, { method: 'POST', body: { fromMs, toMs } });
}

// --- Module 10: saved layouts -------------------------------------------------------

export async function listLayouts(
  ratio?: Ratio,
  options: { signal?: AbortSignal } = {},
): Promise<SavedLayoutView[]> {
  const suffix = ratio ? `?ratio=${encodeURIComponent(ratio)}` : '';
  const { layouts } = await api<{ layouts: SavedLayoutView[] }>(`/clips/layouts${suffix}`, {
    signal: options.signal,
  });
  return layouts;
}

/** 409 `layout_limit` at 50 a workspace. */
export async function saveLayout(input: {
  name: string;
  ratio: Ratio;
  layout: ClipLayout;
}): Promise<SavedLayoutView> {
  const { layout } = await api<{ layout: SavedLayoutView }>('/clips/layouts', {
    method: 'POST',
    body: input,
  });
  return layout;
}

export async function renameLayout(layoutId: string, name: string): Promise<SavedLayoutView> {
  const { layout } = await api<{ layout: SavedLayoutView }>(
    `/clips/layouts/${encodeURIComponent(layoutId)}`,
    { method: 'PATCH', body: { name } },
  );
  return layout;
}

export function deleteLayout(layoutId: string): Promise<{ message: string }> {
  return api(`/clips/layouts/${encodeURIComponent(layoutId)}`, { method: 'DELETE' });
}

// --- Module 12: the sticker library and the workspace's own stickers ------------------

export interface SearchStickersOptions {
  q?: string;
  kind?: StickerKind;
  category?: StickerCategory;
  /** The workspace's starred stickers only. */
  favourites?: boolean;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}

/** One page of the catalogue (24 by default), with `suggest` when nothing matched. 429 `library_throttled`. */
export function searchStickers(options: SearchStickersOptions = {}): Promise<LibrarySearchPage> {
  const query = new URLSearchParams();
  const q = options.q?.trim();
  if (q) query.set('q', q);
  if (options.kind) query.set('kind', options.kind);
  if (options.category) query.set('category', options.category);
  if (options.favourites) query.set('favourites', 'true');
  if (options.page && options.page > 1) query.set('page', String(options.page));
  if (options.pageSize) query.set('pageSize', String(options.pageSize));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api<LibrarySearchPage>(`/clips/library/stickers${suffix}`, { signal: options.signal });
}

/** The chips: our categories that have stickers of that kind, with their counts. */
export async function stickerCategories(
  kind?: StickerKind,
  options: { signal?: AbortSignal } = {},
): Promise<LibraryCategoryCount[]> {
  const suffix = kind ? `?kind=${encodeURIComponent(kind)}` : '';
  const { categories } = await api<{ categories: LibraryCategoryCount[] }>(
    `/clips/library/categories${suffix}`,
    { signal: options.signal },
  );
  return categories;
}

/** Stars a sticker for the whole workspace. 404 `sticker_not_found` when it left the library. */
export async function favouriteSticker(stickerId: string): Promise<void> {
  await api('/clips/library/favourites', {
    method: 'PUT',
    body: { type: 'sticker', itemId: stickerId },
  });
}

export async function unfavouriteSticker(stickerId: string): Promise<void> {
  await api(`/clips/library/favourites/sticker/${encodeURIComponent(stickerId)}`, {
    method: 'DELETE',
  });
}

/**
 * Uploads a PNG, GIF or WebP (8 MB at most) and waits for its check: 201
 * ready or still checking; 413, 415 or 422 with one sentence.
 */
export async function uploadSticker(file: File): Promise<StickerUploadView> {
  const { sticker } = await uploadFile<{ sticker: StickerUploadView }>(
    '/clips/stickers/uploads',
    file,
  );
  return sticker;
}

export async function listStickerUploads(
  options: { signal?: AbortSignal } = {},
): Promise<StickerUploadView[]> {
  const { stickers } = await api<{ stickers: StickerUploadView[] }>('/clips/stickers/uploads', {
    signal: options.signal,
  });
  return stickers;
}

/** 409 `sticker_in_use` (with the number of clips) while a clip uses it. */
export function deleteStickerUpload(assetId: string): Promise<{ message: string }> {
  return api(`/clips/stickers/uploads/${encodeURIComponent(assetId)}`, { method: 'DELETE' });
}

/** The files a clip's stickers draw, by `stickerRefKey`; `missing` for one that is gone. */
export async function stickerFiles(
  refs: { library: readonly string[]; asset: readonly string[] },
  options: { signal?: AbortSignal } = {},
): Promise<StickerFileView[]> {
  const query = new URLSearchParams();
  if (refs.library.length > 0) query.set('library', refs.library.join(','));
  if (refs.asset.length > 0) query.set('asset', refs.asset.join(','));
  if (query.size === 0) return [];
  const { files } = await api<{ files: StickerFileView[] }>(
    `/clips/stickers/files?${query.toString()}`,
    { signal: options.signal },
  );
  return files;
}

// --- Module 14: the sound library and the workspace's own sounds ----------------------

export interface SearchSoundsOptions {
  q?: string;
  kind?: SoundKind;
  category?: SoundCategory;
  /** The workspace's starred sounds only. */
  favourites?: boolean;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}

/** One page of the sound catalogue (24 by default), with `suggest` when nothing matched. 429 `library_throttled`. */
export function searchSounds(options: SearchSoundsOptions = {}): Promise<LibrarySoundPage> {
  const query = new URLSearchParams();
  const q = options.q?.trim();
  if (q) query.set('q', q);
  if (options.kind) query.set('kind', options.kind);
  if (options.category) query.set('category', options.category);
  if (options.favourites) query.set('favourites', 'true');
  if (options.page && options.page > 1) query.set('page', String(options.page));
  if (options.pageSize) query.set('pageSize', String(options.pageSize));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api<LibrarySoundPage>(`/clips/library/sounds${suffix}`, { signal: options.signal });
}

/** The chips: the sound categories of that kind that have sounds, with their counts. */
export async function soundCategories(
  kind?: SoundKind,
  options: { signal?: AbortSignal } = {},
): Promise<SoundCategoryCount[]> {
  const query = new URLSearchParams({ type: 'sound' });
  if (kind) query.set('kind', kind);
  const { categories } = await api<{ categories: SoundCategoryCount[] }>(
    `/clips/library/categories?${query.toString()}`,
    { signal: options.signal },
  );
  return categories;
}

/** Stars a sound for the whole workspace. 404 `sound_not_found` when it left the library. */
export async function favouriteSound(soundId: string): Promise<void> {
  await api('/clips/library/favourites', {
    method: 'PUT',
    body: { type: 'sound', itemId: soundId },
  });
}

export async function unfavouriteSound(soundId: string): Promise<void> {
  await api(`/clips/library/favourites/sound/${encodeURIComponent(soundId)}`, {
    method: 'DELETE',
  });
}

/**
 * Uploads an MP3, WAV, M4A or AAC file (20 MB at most) and waits briefly for
 * its check: 201 ready or still checking; 413, 415 or 422 with one sentence.
 */
export async function uploadSound(file: File): Promise<SoundUploadView> {
  const { sound } = await uploadFile<{ sound: SoundUploadView }>('/clips/sounds/uploads', file);
  return sound;
}

export async function listSoundUploads(
  options: { signal?: AbortSignal } = {},
): Promise<SoundUploadView[]> {
  const { sounds } = await api<{ sounds: SoundUploadView[] }>('/clips/sounds/uploads', {
    signal: options.signal,
  });
  return sounds;
}

/** 409 `sound_in_use` (with the number of clips) while a clip uses it. */
export function deleteSoundUpload(assetId: string): Promise<{ message: string }> {
  return api(`/clips/sounds/uploads/${encodeURIComponent(assetId)}`, { method: 'DELETE' });
}

/** The files a clip's sounds play, by `soundRefKey`; `missing` for one that is gone. */
export async function soundFiles(
  refs: { library: readonly string[]; asset: readonly string[] },
  options: { signal?: AbortSignal } = {},
): Promise<SoundFileView[]> {
  const query = new URLSearchParams();
  if (refs.library.length > 0) query.set('library', refs.library.join(','));
  if (refs.asset.length > 0) query.set('asset', refs.asset.join(','));
  if (query.size === 0) return [];
  const { files } = await api<{ files: SoundFileView[] }>(
    `/clips/sounds/files?${query.toString()}`,
    { signal: options.signal },
  );
  return files;
}

// ---- Downloads (Module 18) ---------------------------------------------------------

/**
 * Prepares a file in the chosen quality (`formatId` from the probe). The
 * server probes the link again and finds the format in that fresh probe
 * (422 `format_gone` when it is no longer offered). 402 with the plan's
 * sentence past a limit, 409 `downloads_busy` with three being prepared.
 */
export function startDownload(
  url: string,
  formatId: string,
  rightsConfirmed: boolean,
): Promise<DownloadStarted> {
  return api<DownloadStarted>('/clips/downloads', {
    method: 'POST',
    body: { url, formatId, rightsConfirmed },
  });
}

/** The last two days of downloads, newest first. */
export async function listDownloads(
  options: { signal?: AbortSignal } = {},
): Promise<DownloadView[]> {
  const { downloads } = await api<{ downloads: DownloadView[] }>('/clips/downloads', {
    signal: options.signal,
  });
  return downloads;
}

/**
 * Save File: asks for the five minute signed address named after the video,
 * then sends the browser there, so it saves a large file itself instead of
 * holding it in memory. Asked as JSON first, so a refusal (409 not ready yet,
 * 410 expired, 404 gone) throws an `ApiError` with its sentence instead of
 * showing the API's JSON as a page.
 */
export async function saveDownloadFile(jobId: string): Promise<void> {
  const { url } = await api<{ url: string }>(`${downloadPath(jobId)}/file`);
  window.location.assign(url);
}

/** Save To Media: 422 `media_too_big` with the sizes in its sentence over Media's video limit. */
export async function saveDownloadToMedia(jobId: string): Promise<DownloadView> {
  const { download } = await api<{ download: DownloadView }>(
    `${downloadPath(jobId)}/save-to-media`,
    {
      method: 'POST',
    },
  );
  return download;
}

/** Delete Download: one still being prepared is cancelled, a finished one loses its file. */
export function deleteDownload(jobId: string): Promise<{ message: string }> {
  return api<{ message: string }>(downloadPath(jobId), { method: 'DELETE' });
}

/** Download Original: a five minute address for an uploaded video's own file. */
export async function downloadOriginal(videoId: string): Promise<string> {
  const { url } = await api<{ url: string }>(
    `/clips/videos/${encodeURIComponent(videoId)}/download-original`,
    { method: 'POST' },
  );
  return url;
}

// --- Sprint 13, Module 03: captions ---------------------------------------------------

/**
 * Adds captions to a clip. Not listened to yet: `covered: false` with the
 * listening job (ask again when it ends, which is free). Listened to: the
 * captions `track` for the editor to put in the document, and the words.
 */
export function addCaptions(
  clipId: string,
  body: { styleId?: string; language?: string } = {},
): Promise<AddCaptionsOutcome> {
  return api(`${clipPath(clipId)}/captions`, { method: 'POST', body });
}

/**
 * The words of the clip's captions (or of its video, when it has none yet).
 * `source: 'spoken'` (Module 04, the Transcript pane) always reads the
 * video's own listened words, never a file or a translation.
 */
export function getClipWords(
  clipId: string,
  options: { signal?: AbortSignal; source?: 'captions' | 'spoken' } = {},
): Promise<ClipWordsView> {
  const query = options.source === 'spoken' ? '?source=spoken' : '';
  return api(`${clipPath(clipId)}/words${query}`, { signal: options.signal });
}

// --- Sprint 13, Module 04: a video's transcript ---------------------------------------

const transcriptPath = (videoId: string) =>
  `/clips/videos/${encodeURIComponent(videoId)}/transcript`;

/**
 * Listens to a stretch of a video (the whole video without one). Charged in
 * AI minutes only for what was not listened to yet; 402 with one sentence
 * when the month's minutes are used.
 */
export function listenToVideo(
  videoId: string,
  body: { fromMs?: number; toMs?: number; language?: string } = {},
): Promise<ListenOutcome> {
  return api(transcriptPath(videoId), { method: 'POST', body });
}

/** The words of a stretch of a video (the whole video without one), and what the rest costs. */
export function getVideoTranscript(
  videoId: string,
  range: { fromMs?: number; toMs?: number } = {},
  options: { signal?: AbortSignal } = {},
): Promise<VideoTranscriptView> {
  const query = new URLSearchParams();
  if (range.fromMs !== undefined) query.set('fromMs', String(range.fromMs));
  if (range.toMs !== undefined) query.set('toMs', String(range.toMs));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api(`${transcriptPath(videoId)}${suffix}`, { signal: options.signal });
}

/** Fixes words of a video by their index, for every clip of it. */
export function fixTranscriptWords(
  videoId: string,
  fixes: Array<{ index: number; text: string }>,
): Promise<{ changed: number; fixes: number }> {
  return api(`${transcriptPath(videoId)}/words`, { method: 'PATCH', body: { fixes } });
}

/** An SRT or VTT file as the clip's captions. Free; 413 or 422 with one sentence. */
export function uploadCaptionsFile(
  clipId: string,
  file: File,
  fields: { styleId?: string; language?: string } = {},
): Promise<CaptionsFileOutcome> {
  const sent: Record<string, string> = {};
  if (fields.styleId) sent.styleId = fields.styleId;
  if (fields.language) sent.language = fields.language;
  return uploadFile(`${clipPath(clipId)}/captions/from-file`, file, undefined, sent);
}

/** Translates the clip's captions. Charged in AI minutes; a failure gives them back. */
export function translateCaptions(
  clipId: string,
  language: string,
): Promise<TranslateCaptionsOutcome> {
  return api(`${clipPath(clipId)}/captions/translate`, { method: 'POST', body: { language } });
}

/** Fixes a word everywhere it was heard in the video ("Replace Everywhere"). */
export function replaceTranscriptWord(
  videoId: string,
  from: string,
  to: string,
  language?: string,
): Promise<{ changed: number; fixes: number }> {
  return api(`/clips/videos/${encodeURIComponent(videoId)}/transcript/words`, {
    method: 'PATCH',
    body: { replace: { from, to }, ...(language ? { language } : {}) },
  });
}

export function listCaptionStyles(
  options: { signal?: AbortSignal } = {},
): Promise<CaptionStylesView> {
  return api('/clips/caption-styles', { signal: options.signal });
}

/** 409 `caption_style_limit` at 30 a workspace. */
export async function createCaptionStyle(input: {
  name: string;
  look: CaptionLook;
}): Promise<CaptionStyleView> {
  const { style } = await api<{ style: CaptionStyleView }>('/clips/caption-styles', {
    method: 'POST',
    body: input,
  });
  return style;
}

export async function updateCaptionStyle(
  styleId: string,
  change: { name?: string; look?: CaptionLook },
): Promise<CaptionStyleView> {
  const { style } = await api<{ style: CaptionStyleView }>(
    `/clips/caption-styles/${encodeURIComponent(styleId)}`,
    { method: 'PATCH', body: change },
  );
  return style;
}

export function deleteCaptionStyle(styleId: string): Promise<{ message: string }> {
  return api(`/clips/caption-styles/${encodeURIComponent(styleId)}`, { method: 'DELETE' });
}

/** Module 07: finds faces in the clip's stretch (free), or answers that a face file covers it. */
export function ensureClipFaces(clipId: string): Promise<ClipFacesEnsure> {
  return api<ClipFacesEnsure>(`${clipPath(clipId)}/faces`, { method: 'POST' });
}

/**
 * Module 07: the face file's address when it is ready, or whether a job is
 * still looking. `follow` (Module 08, Follow The Speaker) also asks for the
 * scene cuts and speech stretches; without it they come back `[]` and `null`.
 */
export function readClipFaces(
  clipId: string,
  options: { signal?: AbortSignal; follow?: boolean } = {},
): Promise<ClipFacesRead> {
  const query = options.follow ? '?follow=1' : '';
  return api<ClipFacesRead>(`${clipPath(clipId)}/faces${query}`, { signal: options.signal });
}

// --- Sprint 13, Module 09: AI effects ---------------------------------------------------

/** The workspace's own bleep words (My Words), lower case. */
export async function getWordList(options: { signal?: AbortSignal } = {}): Promise<string[]> {
  const { words } = await api<{ words: string[] }>('/clips/word-list', { signal: options.signal });
  return words;
}

/**
 * Replaces the workspace's own bleep words. 422 `word_list_word_too_long`,
 * `word_list_one_word` or `word_list_full`, each with a sentence.
 */
export async function saveWordList(words: readonly string[]): Promise<string[]> {
  const saved = await api<{ words: string[] }>('/clips/word-list', {
    method: 'PUT',
    body: { words: [...words] },
  });
  return saved.words;
}

/** The highest `attempt` the hook titles route takes. */
export const HOOK_TITLES_MAX_ATTEMPT = 50;

/**
 * Three hook titles written from the clip's words; `attempt` counts the Try
 * Agains (0 first), each answering three new titles. Free; 422
 * `hook_titles_no_words`, 429 `hook_titles_throttled`, 502
 * `hook_titles_failed`, 503 `hook_titles_off`, each with a sentence.
 */
export async function suggestHookTitles(clipId: string, attempt = 0): Promise<string[]> {
  const { titles } = await api<{ titles: string[] }>(`${clipPath(clipId)}/hook-titles`, {
    method: 'POST',
    body: { attempt: Math.min(HOOK_TITLES_MAX_ATTEMPT, Math.max(0, Math.floor(attempt))) },
  });
  return titles;
}

/** The voices Text To Speech offers, and whether it can run now. */
export function listVoices(options: { signal?: AbortSignal } = {}): Promise<ClipVoicesView> {
  return api('/clips/voices', { signal: options.signal });
}

/**
 * Makes a voice from a line (charged in AI minutes; the same line and voice
 * again is one charge). 503 `voice_off`, 422 `voice_unknown` or `voice_language`, 402
 * `clips_ai_minutes_used`, each with a sentence.
 */
export function makeVoice(
  clipId: string,
  body: { text: string; voiceId: string; revision: number },
): Promise<MakeVoiceOutcome> {
  return api(`${clipPath(clipId)}/voice`, { method: 'POST', body });
}
