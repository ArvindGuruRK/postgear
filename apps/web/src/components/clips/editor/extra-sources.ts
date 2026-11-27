/**
 * The preview's other videos (Sprint 13, Module 10): a brand kit's intro and
 * outro (and Module 11's montage videos) are sources of the document beside
 * the clip's own video. `GET /clips/:clipId` answers each one's light copy in
 * `extraSources`, keyed by the document's source id; the preview engine takes
 * them as `extraSources` in the same shape as its main `source`.
 */
import type { PreviewSource } from '@postgear/video-preview';
import { useMemo } from 'react';
import type { ClipDetail } from '@/types/clips';

/** Every other video's light copy as the preview plays it (whole file, so no offset). */
export function previewSourcesOf(
  detail: Pick<ClipDetail, 'extraSources'>,
): Record<string, PreviewSource> {
  const sources: Record<string, PreviewSource> = {};
  for (const [sourceId, media] of Object.entries(detail.extraSources ?? {})) {
    sources[sourceId] = {
      url: media.playback.url,
      expiresAt: media.playback.expiresAt,
      offsetMs: 0,
      fps: media.proxy?.fps ?? null,
    };
  }
  return sources;
}

/** `previewSourcesOf`, kept the same object while the answer is the same (the engine compares it). */
export function usePreviewSources(
  detail: Pick<ClipDetail, 'extraSources'>,
): Record<string, PreviewSource> {
  const extra = detail.extraSources;
  return useMemo(() => previewSourcesOf({ extraSources: extra }), [extra]);
}
