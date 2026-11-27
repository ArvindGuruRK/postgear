'use client';

/**
 * A montage's captions in the editor (Module 11). A montage keeps the
 * captions of its clips: one captions track per video, each with its own
 * transcript, all drawn in the first track's look. The clip's words routes
 * refuse a montage (`montage_captions_fixed`), so the words of each track
 * are read from its own video (`GET /clips/videos/:videoId/transcript` over
 * that video's parts) and kept by transcript id. A track whose transcript
 * cannot be found simply shows no captions.
 *
 * On an ordinary clip with one track nothing here runs: `useCaptions` holds
 * its words as before.
 */
import {
  type CaptionLayout,
  type CaptionLook,
  type CaptionsTrack,
  type ClipDocument,
  captionLayout,
  inFirstCaptionsLook,
} from '@postgear/video-engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getVideoTranscript } from '@/lib/clips-api';
import type { TranscriptView } from '@/types/clips';

export interface TrackNeed {
  transcriptId: string;
  videoId: string;
  fromMs: number;
  toMs: number;
}

/** The video a captions track reads: the one it names, or the clip's only one. */
function sourceOfTrack(
  doc: Pick<ClipDocument, 'sources' | 'segments'>,
  track: CaptionsTrack,
): string | null {
  if (track.source) return track.source;
  const main = doc.segments.filter((segment) => segment.role === undefined);
  const sources = new Set(main.map((segment) => segment.source));
  return sources.size === 1 ? ([...sources][0] ?? null) : null;
}

/**
 * What each track from `from` on needs fetched: its transcript, its video
 * and the stretch its parts play. Tracks already held are left out.
 */
export function trackNeeds(
  doc: Pick<ClipDocument, 'sources' | 'segments'>,
  tracks: readonly CaptionsTrack[],
  held: ReadonlySet<string>,
  from = 1,
): TrackNeed[] {
  const needs: TrackNeed[] = [];
  for (const track of tracks.slice(from)) {
    if (held.has(track.transcriptAssetId)) continue;
    const source = sourceOfTrack(doc, track);
    const video = doc.sources.find((one) => one.id === source)?.videoId;
    const parts = doc.segments.filter((segment) => segment.source === source);
    if (!video || parts.length === 0) continue;
    needs.push({
      transcriptId: track.transcriptAssetId,
      videoId: video,
      fromMs: Math.min(...parts.map((part) => part.sourceIn)),
      toMs: Math.max(...parts.map((part) => part.sourceOut)),
    });
  }
  return needs;
}

/** The tracks' words by transcript id, each read once: every track on a montage, else the second on. */
export function useMontageTranscripts(
  doc: Pick<ClipDocument, 'sources' | 'segments'>,
  tracks: readonly CaptionsTrack[],
  options: { all: boolean },
): ReadonlyMap<string, TranscriptView> {
  const [held, setHeld] = useState<ReadonlyMap<string, TranscriptView>>(new Map());
  const [tried, setTried] = useState<ReadonlySet<string>>(new Set());
  const from = options.all ? 0 : 1;
  const needs = useMemo(
    () => trackNeeds(doc, tracks, new Set([...held.keys(), ...tried]), from),
    [doc, tracks, held, tried, from],
  );
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // Each transcript is asked for once; a later change of what is needed never drops an answer.
  useEffect(() => {
    if (needs.length === 0) return;
    setTried((current) => new Set([...current, ...needs.map((need) => need.transcriptId)]));
    for (const need of needs) {
      getVideoTranscript(need.videoId, { fromMs: need.fromMs, toMs: need.toMs })
        .then((view) => {
          if (!live.current || view.transcript?.id !== need.transcriptId) return;
          const transcript = view.transcript;
          setHeld((current) => new Map(current).set(transcript.id, transcript));
        })
        .catch(() => undefined);
    }
  }, [needs]);

  return held;
}

/**
 * One layout per track whose words are in, in track order, each in the
 * first track's look. `first`, when given, stands for the first track (the
 * words `useCaptions` holds).
 */
export function montageCaptionLayouts(input: {
  doc: ClipDocument;
  tracks: readonly CaptionsTrack[];
  first: CaptionLayout | null;
  look: CaptionLook;
  transcripts: ReadonlyMap<string, TranscriptView>;
}): Array<{ trackId: string; layout: CaptionLayout }> {
  const out: Array<{ trackId: string; layout: CaptionLayout }> = [];
  input.tracks.forEach((track, index) => {
    if (index === 0 && input.first) {
      out.push({ trackId: track.id, layout: input.first });
      return;
    }
    const transcript = input.transcripts.get(track.transcriptAssetId);
    if (!transcript) return;
    out.push({
      trackId: track.id,
      layout: captionLayout({
        doc: input.doc,
        track: inFirstCaptionsLook(input.doc, track),
        look: input.look,
        transcript,
        wordTimed: transcript.source === 'listened',
      }),
    });
  });
  return out;
}
