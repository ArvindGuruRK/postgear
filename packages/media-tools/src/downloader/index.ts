/**
 * The link fetchers (Module 03): the real yt-dlp binding, the simulated
 * fixture binding, and the pure pieces they share (argument builders, the
 * probe and error mappers, the playlist slicer, progress parsing).
 */
export {
  audioArgs,
  ffmpegSeconds,
  HLS_PROTOCOLS,
  hlsCopyArgs,
  MP3_BITRATE,
  mp3Args,
  NORMALISE,
  normaliseArgs,
  normaliseFps,
  remuxArgs,
} from './ffmpeg.args';
export { defaultFetchText, type FetchText, type FetchTextOptions } from './fetch-text';
export { createFixtureDownloader, type FixtureDownloaderOptions } from './fixture.downloader';
export {
  MAX_PLAYLIST_BYTES,
  PlaylistSliceError,
  type PlaylistSliceErrorCode,
  type SlicedPlaylist,
  type SlicePlaylistInput,
  sliceHlsPlaylist,
} from './playlist-slicer';
export {
  createFfmpegProgressHandler,
  createSpanReporter,
  createYtDlpProgressHandler,
  parseYtDlpProgressLine,
  type ProgressSpan,
  YTDLP_PROGRESS_TEMPLATE,
  type YtDlpProgressLine,
  ytDlpLinePercent,
} from './progress';
export {
  defaultSamplesDir,
  SAMPLES_FOLDER,
  type SampleChat,
  sampleChat,
  sampleDurationMs,
  sampleFileName,
  type SampleName,
  type SamplePlan,
  samplePlan,
} from './samples';
export { resolveSimulationLink, type SimulationAnswer, simulationLinks } from './simulation';
export * from './types';
export {
  assertCanonicalUrl,
  FORMAT_ID_PATTERN,
  formatSelector,
  IMPORT_EXTRACTORS,
  type SectionRange,
  type YtDlpConfig,
  ytDlpBaseArgs,
  ytDlpConfigFromEnv,
  type YtDlpDownloadOptions,
  ytDlpDownloadArgs,
  ytDlpProbeArgs,
} from './yt-dlp.args';
export {
  createYtDlpDownloader,
  DEFAULT_RANGE_MAX_BYTES,
  DEFAULT_TIMEOUTS,
  type YtDlpDownloaderOptions,
  type YtDlpTimeouts,
  YOUTUBE_SECTION_PAD_MS,
} from './yt-dlp.downloader';
export { mapYtDlpError, toDownloaderError } from './yt-dlp.errors';
export {
  chooseVideo,
  mapProbeJson,
  type PickedFormat,
  pickFormats,
  type ProbeResult,
} from './yt-dlp.probe';
