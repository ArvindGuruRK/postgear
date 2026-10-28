/**
 * `@postgear/design-engine`: the template library and the one renderer.
 *
 * Browser-safe TypeScript and React, the same rule as
 * `@postgear/social-core/composer`: no Node built-ins anywhere in `src/`, so
 * the web editor and the API's exporter can import the identical code. The
 * `fonts/` folder holds files, not code; whoever reads them (the API) does
 * the reading.
 *
 * Everything the API and the web app use goes through this file, so neither
 * reaches into the package's folders and the public surface is one list.
 */

export { boundText, clampText, isTypeable, singleLine, slotText } from './bindings';
export {
  applyBrand,
  brandFromTheme,
  type ContrastVerdict,
  checkContrast,
  PHOTO_INK,
  PHOTO_INK_MUTED,
  paletteForSlide,
  photoGround,
  photoNeedsDarkening,
  SAFE_PHOTO_OVERLAY,
  slideGround,
} from './brand';
export {
  AA_CONTRAST,
  colorDistance,
  contrastRatio,
  ensureReadable,
  hexToRgb,
  INK_DARK,
  INK_LIGHT,
  isHexColor,
  luminance,
  meetsAA,
  mix,
  mutedInk,
  normalizeHex,
  readableInk,
  rgba,
  rgbToHex,
  saturation,
  surfaceFrom,
} from './color';
export {
  type ClampReport,
  clampToRegion,
  clampWithReport,
  dragToOffset,
  NO_OFFSET,
  NUDGE_STEP,
  NUDGE_STEP_LARGE,
  type Offset,
  offsetBounds,
  placeInRegion,
} from './constraints';
export {
  addSlide,
  applyBrandKit,
  applyTheme,
  BLANK_PRESET_ID,
  blankDocument,
  type CreateDocumentInput,
  detachBrandKit,
  documentFromPreset,
  duplicateSlide,
  emptyBrand,
  moveSlide,
  removeSlide,
  resetDocument,
  resetElement,
  resetSlide,
  setBackground,
  setBrandName,
  setCaption,
  setHandle,
  setLogoPlacement,
  setSlideLayout,
  slideId,
  updateBrandColors,
  updateElement,
  updateSlide,
} from './document';
export {
  approximateMeasure,
  baseFontSize,
  type FitInput,
  type FitResult,
  fitText,
  type MeasuredStyle,
  type MeasureText,
  MIN_FIT_SCALE,
  wrapText,
} from './fit';
export {
  FONT_IDS,
  FONTS,
  type FontDef,
  type FontFace,
  faceWeight,
  filesFor,
  fontStack,
  resolveWeight,
} from './fonts';
export {
  contentBox,
  coversRect,
  exportSizeLabel,
  FORMAT_IDS,
  FORMATS,
  formatSpec,
  isFormatId,
  nest,
  overlapsRect,
  shortEdge,
} from './formats';
export {
  COALESCE_MS,
  canRedo,
  canUndo,
  createHistory,
  current,
  HISTORY_LIMIT,
  type HistoryState,
  type PushOptions,
  push,
  redo,
  reset,
  undo,
} from './history';
export {
  contrastFixFor,
  fixContrast,
  inkOf,
  legibleInk,
  regionGround,
  type SlotInk,
  slidePalette,
  slotInk,
} from './ink';
export { type DesignIssue, type DesignIssueKind, findDesignIssues, issueMessage } from './issues';
export {
  decorRect,
  defaultLayoutFor,
  findLayout,
  findRegion,
  findSlot,
  LAYOUTS,
  latestLayout,
  layoutKey,
  layoutsForRole,
  logoPlacements,
  PLAIN_LAYOUT_ID,
  parseLayoutKey,
  plainLayout,
  regionLabel,
  regionRect,
  SLIDE_ROLE_LABELS,
  SLIDE_ROLES,
  type SlotFrame,
  type SlotPlacement,
  slotFrame,
  slotPlacement,
} from './layouts';
export { designMediaIds, slideMediaIds } from './media';
export {
  FEATURED_PRESET_IDS,
  matchesPresetQuery,
  PRESETS,
  presetById,
  presetFormats,
  presetStyle,
  presetsByCategory,
  SAMPLE_HANDLE,
} from './presets';
export {
  buildExportPage,
  buildFontStylesheet,
  type ExportPageInput,
  fontLoadSpec,
  type InlineFont,
} from './render/export-html';
export { FIT_STEPS, fitScriptSource, fitSlots } from './render/fit-runtime';
export {
  ScaledSlide,
  type ScaledSlideProps,
  type SlideMode,
  SlideView,
  type SlideViewProps,
} from './render/SlideView';
export { sampleElements, sampleState } from './samples';
export {
  brandColorsSchema,
  DesignVersionError,
  designBrandSchema,
  designDocumentSchema,
  designSlideSchema,
  elementStateSchema,
  parseDesignDocument,
  safeParseDesignDocument,
  slideBackgroundSchema,
  upgrade,
} from './schema';
export { DEFAULT_THEME_ID, fontsOf, isThemeId, THEMES, themeById } from './themes';
export * from './types';
