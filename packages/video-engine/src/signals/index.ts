/**
 * Highlight signals (Module 16). The normalising helpers stay inside the
 * folder (their tests import them directly); everything another workspace
 * needs is here.
 */
export * from './file';
export {
  clipCap,
  type FindHighlightsOptions,
  findHighlights,
  type HighlightResult,
  highlightScore,
  MIN_HIGHLIGHT_SCORE,
} from './score';
export * from './tracks';
export { SIGNALS_ENGINE_VERSION, SIGNALS_TUNING, TUNING as SIGNALS_TUNING_VALUES } from './tuning';
export * from './types';
