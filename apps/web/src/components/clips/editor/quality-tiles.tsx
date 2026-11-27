'use client';

/**
 * The export quality tiles (Module 15 section 7), shared by the editor's
 * Export tab and the Clips tab's Export All (Module 11): the four tiles with
 * their help lines, and the plan lock on the ones above the plan's
 * `clips.export_max_quality`.
 */
import type { ChoiceTileOption } from '@postgear/ui';
import {
  EXPORT_QUALITIES,
  type ExportQuality,
  QUALITY_HELP,
  QUALITY_LABELS,
  qualityAllowed,
} from '@postgear/video-engine';
import { PremiumLockMark } from '@/components/studio/premium-lock';

/** The tiles, a lock on each above `ceiling` (null while the plan is unknown: none locked). */
export function qualityTileOptions(ceiling: string | null): ChoiceTileOption<ExportQuality>[] {
  return EXPORT_QUALITIES.map((quality) => {
    const locked = ceiling !== null && !qualityAllowed(quality, ceiling);
    return {
      value: quality,
      label: QUALITY_LABELS[quality],
      line: QUALITY_HELP[quality],
      corner: locked ? <PremiumLockMark className="h-5 w-5" /> : undefined,
      spokenLabel: locked ? `${QUALITY_LABELS[quality]}, locked` : undefined,
    };
  });
}
