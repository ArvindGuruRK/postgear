/**
 * `@postgear/video-preview`: the browser preview of a clip (web only).
 *
 * `PreviewEngine` plays the light copy part by part on two `<video>`
 * elements and draws every layout area from `frameState` onto canvases, with
 * one clock in the clip's own time. `usePreviewEngine` gives a component one
 * engine for its life. It has no knowledge of FFmpeg: the export is
 * `@postgear/video-engine`'s compiler, and both read the same `frameState`.
 *
 * The fakes its tests use are at `@postgear/video-preview/testing`.
 */
export { previewError } from './errors';
export { EmptyOverlayLayer, SilentAudioLayer } from './layers';
export {
  nextHandover,
  outputAt,
  type PreviewPart,
  partAt,
  previewParts,
  runEnd,
  seekTargetAt,
  sourceAt,
} from './parts';
export { IDLE_PREVIEW_SNAPSHOT, PreviewEngine, type PreviewEngineOptions } from './preview-engine';
export type {
  AudioLayer,
  FrameScheduler,
  LayerUpdate,
  LayerUpdateReason,
  OverlayLayer,
  PreviewError,
  PreviewErrorCode,
  PreviewSnapshot,
  PreviewSource,
  PreviewStats,
} from './types';
export {
  type UsePreviewEngine,
  type UsePreviewEngineOptions,
  usePreviewEngine,
} from './use-preview-engine';
