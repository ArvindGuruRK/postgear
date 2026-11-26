/**
 * Captions in the render plan (Sprint 13, Module 03).
 *
 * The render never fetches anything: the prepare step hands in the clip's
 * transcript (the video's word fixes already applied) and the caption style's
 * look, and this resolves them into the pages the ASS writer draws, with
 * every font decided against the manifest the render has. A style's family
 * the manifest lacks, or a letter no shipped font can draw, is `font_missing`:
 * libass must never pick some other face on its own.
 */
import {
  type CaptionLayout,
  captionLayout,
  captionsTrackOf,
  displayWord,
} from '../captions';
import type { CaptionLook } from '../captions/styles';
import type { ClipDocument } from '../document/schema';
import type { Transcript } from '../transcript/types';
import { RenderCompileError } from './errors';
import {
  assFontSize,
  covers,
  type FontManifest,
  type FontManifestEntry,
  resolveTextFont,
  type TextRun,
  textRuns,
} from './fonts';
import type { PlanTextRun } from './text-plan';

/** What the prepare step hands in for a clip with captions. */
export interface RenderCaptionsAsset {
  /** The transcript the captions track names, with the video's word fixes applied. */
  transcript: Pick<Transcript, 'words' | 'language'>;
  /** The caption style's look (`resolveStyle(track.styleId, workspace styles).style.look`). */
  look: CaptionLook;
  /** False for a supplied file or a translation: the page is the unit of highlight. */
  wordTimed: boolean;
  /** The source whose words these are (the transcript's video); absent for a single-source clip. */
  sourceId?: string;
}

/** One word of a page, ready to write: its text as font runs. */
export interface PlanCaptionWord {
  /** The runs of the word (one, unless it mixes scripts). */
  runs: PlanTextRun[];
}

export interface PlanCaptions {
  layout: CaptionLayout;
  /** The style's own font at its nearest weight. */
  main: PlanTextRun;
  /** `words[page][position]`: every page's words as font runs, in the layout's order. */
  words: PlanCaptionWord[][];
  /** The font files and PostScript names the captions use. */
  files: string[];
  psNames: string[];
}

function toRun(entry: FontManifestEntry, text: string, sizePx: number): PlanTextRun {
  return {
    text,
    assName: entry.assName,
    psName: entry.psName,
    fontSize: assFontSize(entry, sizePx),
    weight: entry.weight,
  };
}

/**
 * A word that needs one script font (a Tamil word) is drawn whole in that
 * font when it has every letter of the word, its comma or full stop included,
 * instead of handing the punctuation back to the style's own font. The word
 * is then one run: nothing changes inside it, and a page of such words is one
 * run too, so a box behind it is one box.
 */
function wholeWordRuns(
  text: string,
  runs: readonly TextRun[],
  main: FontManifestEntry,
  manifest: FontManifest,
): TextRun[] {
  const others = [...new Set(runs.filter((run) => run.entry !== main).map((run) => run.entry))];
  if (others.length !== 1 || runs.length === 1) return [...runs];
  const script = others[0] as FontManifestEntry;
  const coverage = manifest.coverage[script.fontId];
  for (const char of text) {
    if (/\p{M}|\p{Cf}/u.test(char)) continue;
    if (!covers(coverage, char.codePointAt(0) as number)) return [...runs];
  }
  return [{ text, entry: script }];
}

/**
 * The document's captions as a plan, or null when it has no captions track.
 * Throws `captions_missing` when the words were not handed in, and
 * `font_missing` for a family or a letter the manifest cannot draw.
 */
export function planCaptions(
  doc: ClipDocument,
  asset: RenderCaptionsAsset | null | undefined,
  manifest: FontManifest | null,
): PlanCaptions | null {
  const track = captionsTrackOf(doc);
  if (!track) return null;
  if (!asset) {
    throw new RenderCompileError('captions_missing', "The captions' words were not handed in", {
      trackId: track.id,
    });
  }
  const layout = captionLayout({
    doc,
    track,
    look: asset.look,
    transcript: asset.transcript,
    wordTimed: asset.wordTimed,
    sourceId: asset.sourceId,
  });
  const family = layout.look.font;
  const mainEntry = manifest ? resolveTextFont(manifest, family, layout.look.weight) : null;
  if (!manifest || !mainEntry) {
    throw new RenderCompileError('font_missing', 'A font the captions use is not installed', {
      families: family,
    });
  }

  const used = new Map<string, FontManifestEntry>([[mainEntry.psName, mainEntry]]);
  const missing: string[] = [];
  const words = layout.pages.map((page) =>
    page.words.map((word) => {
      const text = displayWord(word.text, layout.look.letterCase);
      const result = textRuns(text, mainEntry, manifest);
      if (!result.ok) {
        for (const char of result.missing) if (!missing.includes(char)) missing.push(char);
        return { runs: [] };
      }
      const runs = wholeWordRuns(text, result.runs, mainEntry, manifest);
      for (const run of runs) used.set(run.entry.psName, run.entry);
      return { runs: runs.map((run) => toRun(run.entry, run.text, layout.geometry.sizePx)) };
    }),
  );
  if (missing.length > 0) {
    throw new RenderCompileError('font_missing', 'No installed font can draw a letter of the captions', {
      families: family,
      // Code points, never the text itself.
      letters: missing
        .slice(0, 8)
        .map((char) => `U+${(char.codePointAt(0) as number).toString(16).toUpperCase()}`)
        .join(' '),
    });
  }

  return {
    layout,
    main: toRun(mainEntry, '', layout.geometry.sizePx),
    words,
    files: [...new Set([...used.values()].map((entry) => entry.file))].sort(),
    psNames: [...new Set([...used.values()].map((entry) => entry.psName))].sort(),
  };
}
