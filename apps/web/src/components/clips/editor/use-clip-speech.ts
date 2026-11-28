'use client';

/**
 * When someone talks in the clip (Sprint 13, Module 17 item 9), for the
 * preview's Lower Under Speech. Fetched only once a music item asks for it,
 * from the clip's spoken words (the video's own listened transcript, the
 * same file the export reads), and worked out again on every edit so a cut
 * moves the dips with the words. A montage gets none: one video's words
 * cannot say when the others talk (the export does the same).
 */
import {
  type ClipDocument,
  type MsRange,
  soundItems,
  speechSpans,
  type TranscriptWord,
} from '@postgear/video-engine';
import { useEffect, useMemo, useState } from 'react';
import { getClipWords } from '@/lib/clips-api';

/** Whether any music in the clip is lowered under speech (and the clip is of one video). */
export function wantsSpeech(document: ClipDocument | null): boolean {
  if (!document || document.sources.length > 1) return false;
  return soundItems(document).some((item) => item.type === 'music' && item.duck);
}

export function useClipSpeech(clipId: string, document: ClipDocument | null): MsRange[] | null {
  const wanted = wantsSpeech(document);
  const [words, setWords] = useState<readonly TranscriptWord[] | null>(null);

  useEffect(() => {
    if (!wanted) return;
    const controller = new AbortController();
    getClipWords(clipId, { signal: controller.signal, source: 'spoken' })
      .then((view) => setWords(view.transcript?.words ?? []))
      // No words: nothing is lowered, as in the export.
      .catch(() => undefined);
    return () => controller.abort();
  }, [clipId, wanted]);

  return useMemo(() => {
    if (!wanted || !document || !words) return null;
    return speechSpans(document, { words: [...words] }, { sourceId: document.sources[0]?.id });
  }, [wanted, document, words]);
}
