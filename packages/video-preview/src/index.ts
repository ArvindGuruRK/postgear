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
export {
  DomOverlayLayer,
  type DomOverlayLayerOptions,
  type TextCss,
  textCss,
} from './dom-overlay-layer';
export { WebAudioLayer, type WebAudioLayerOptions } from './audio-layer';
export {
  DRIFT_RESTART_MS,
  GAIN_RAMP_MS,
  gainRamp,
  METER_WARN_LEVEL,
  peakOf,
  soundDriftMs,
  soundStart,
} from './audio-model';
export {
  applyParamEvents,
  BLEEP_RAMP_MS,
  BLEEP_TONE_GAIN,
  BLEEP_TONE_HZ,
  type BleepPlan,
  type BleepRange,
  type BleepWindow,
  bleepGateAt,
  bleepPlan,
  bleepWindows,
  type ParamEvent,
  type TonePlan,
} from './bleep-schedule';
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
export {
  BadgeShapesNode,
  badgeShapeCss,
  imageDecoderFrames,
  PictureStickerNode,
  type StickerFrames,
  type StickerFramesLoader,
  type StickerPicture,
  stickerBoxCss,
} from './sticker-nodes';
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
export {
  type CaptionCss,
  CaptionsNode,
  captionCss,
  captionEntrance,
  captionWordPaints,
  ENTRANCE_FADE_MS,
  ENTRANCE_POP_MS,
  ENTRANCE_POP_SCALE,
  POP_MS,
  POP_SCALE,
  type WordPaint,
} from './captions-node';
