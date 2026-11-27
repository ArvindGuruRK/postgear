import { clipSourceRanges } from '../captions/map';
import { builtInCaptionStyle } from '../captions/styles';
import { createClipDocument } from '../document/create';
import { MAX_SEGMENTS } from '../document/limits';
import {
  type CaptionsTrack,
  type ClipDocument,
  clipDocumentSchema,
  type SavedLayout,
  type Segment,
} from '../document/schema';
import { hookTitleOf } from '../effects/hook';
import { defaultClipSetup } from '../highlights/setup';
import { addArea, applyLayout, type VideoSize } from '../layout/edit';
import { enableFollow } from '../reframe/follow';
import type { TranscriptWord } from '../transcript/types';
import {
  applyRecipe,
  describeRecipe,
  type RecipeContext,
  type RecipeSettings,
  type RecipeTranscript,
  recipeFromClip,
  recipeFromSetup,
  recipeSettingsSchema,
  STARTER_RECIPE_IDS,
  STARTER_RECIPES,
  starterRecipe,
} from './index';

const VIDEO_ID = '6f1c2b1e-8d4a-4c1e-9b7a-2f3e4d5c6b7a';
const INTRO_VIDEO_ID = '7a2d3c4b-1e5f-4a6b-8c7d-9e0f1a2b3c4d';
const TRANSCRIPT_ID = '0b3e4c1a-2f5d-4e6a-9b7c-8d9e0f1a2b3c';
const FACES_ID = '1c4f5d2b-3a6e-4f7b-8c8d-9e0f1a2b3c4d';
const PRESET_ID = '2d5a6e3c-4b7f-4a8c-9d9e-0f1a2b3c4d5e';
const WIDE: VideoSize = { width: 1920, height: 1080 };

/** A clip of the video from 10 s to 70 s, wide by default. */
function clip(ratio: ClipDocument['canvas']['ratio'] = '16:9', fromMs = 10_000, toMs = 70_000) {
  return createClipDocument({ videoId: VIDEO_ID, fromMs, toMs, ratio });
}

const SWEAR = 'shit';

function starterSettings(id: string): RecipeSettings {
  const found = starterRecipe(id);
  if (!found) throw new Error(`No starter ${id}`);
  return found.settings;
}

function lookOf(id: string) {
  const found = builtInCaptionStyle(id);
  if (!found) throw new Error(`No style ${id}`);
  return found.look;
}

/**
 * Words every 400 ms (300 ms long) over `[fromMs, toMs)`, with `extra` words
 * put in at given times. `i` follows time order.
 */
function speech(
  blocks: Array<[number, number]>,
  extra: Array<[string, number, number]> = [],
): TranscriptWord[] {
  const list: Array<[string, number, number]> = [...extra];
  for (const [fromMs, toMs] of blocks) {
    for (let at = fromMs; at + 300 <= toMs; at += 400) {
      if (extra.some(([, start, end]) => at < end && at + 300 > start)) continue;
      list.push(['word', at, at + 300]);
    }
  }
  list.sort((a, b) => a[1] - b[1]);
  return list.map(([text, start, end], i) => ({ i, start, end, text, sure: 0.9 }));
}

/** Talking from 10 s to 70 s with two pauses (20 to 22 s, 40 to 41.5 s), an "um" and a swear word. */
function talking(): RecipeTranscript {
  return {
    assetId: TRANSCRIPT_ID,
    language: 'en',
    covered: [{ fromMs: 0, toMs: 120_000 }],
    words: speech(
      [
        [10_000, 20_000],
        [22_000, 40_000],
        [41_500, 70_000],
      ],
      [
        ['um', 30_000, 30_300],
        [SWEAR, 50_000, 50_300],
      ],
    ),
  };
}

function ctx(overrides: Partial<RecipeContext> = {}): RecipeContext {
  return {
    videoSize: WIDE,
    transcript: talking(),
    captionLook: (id) => builtInCaptionStyle(id)?.look ?? null,
    layoutPreset: () => null,
    hookTitleText: 'The one thing nobody tells you',
    ...overrides,
  };
}

function captionsOf(doc: ClipDocument): CaptionsTrack | null {
  const track = doc.tracks.find((candidate) => candidate.kind === 'captions');
  return track && track.kind === 'captions' ? track : null;
}

/** The stretches of the main source the clip plays. */
function played(doc: ClipDocument, sourceId?: string) {
  return clipSourceRanges(doc, sourceId ?? doc.segments[0]?.source);
}

function plays(doc: ClipDocument, ms: number, sourceId?: string): boolean {
  return played(doc, sourceId).some((range) => ms >= range.fromMs && ms < range.toMs);
}

function valid(doc: ClipDocument): void {
  const result = clipDocumentSchema.safeParse(doc);
  if (!result.success) throw new Error(JSON.stringify(result.error.issues.slice(0, 3)));
}

const FULL: RecipeSettings = {
  version: 1,
  ratio: '9:16',
  layout: { kind: 'split' },
  captions: { on: true, styleId: 'marker', position: { x: 0.5, y: 0.6 }, sizePx: 70, maxWords: 2 },
  silences: { on: true, minMs: 800 },
  fillers: { on: true },
  bleep: { on: true, mode: 'mute' },
  hookTitle: { on: true, look: 'hook-box' },
};

describe('applyRecipe', () => {
  it('applies every part, in order, as the editor would', () => {
    const outcome = applyRecipe(clip(), FULL, ctx());
    const { doc } = outcome;
    valid(doc);
    expect(doc.canvas.ratio).toBe('9:16');
    expect(doc.layout.kind).toBe('split');
    expect(captionsOf(doc)).toMatchObject({
      styleId: 'marker',
      transcriptAssetId: TRANSCRIPT_ID,
      language: 'en',
      position: { x: 0.5, y: 0.6 },
      sizePx: 70,
      maxWords: 2,
    });
    // The pauses and the "um" are gone; the speech either side plays.
    expect(plays(doc, 21_000)).toBe(false);
    expect(plays(doc, 40_750)).toBe(false);
    expect(plays(doc, 30_150)).toBe(false);
    expect(plays(doc, 15_000)).toBe(true);
    expect(doc.meta?.cleanup).toEqual({ silencesMinMs: 800, fillers: true });
    expect(doc.bleeps).toHaveLength(1);
    expect(doc.bleeps[0]).toMatchObject({ mode: 'mute', from: 49_960, to: 50_340 });
    expect(hookTitleOf(doc)?.text).toBe('The one thing nobody tells you');
    expect(outcome).toMatchObject({ needs: [], missing: [], skipped: [], follow: null });
    expect(doc.recipeId).toBeUndefined();
  });

  it('applies shape before layout, so a layout the new shape offers is taken', () => {
    const { doc, skipped } = applyRecipe(
      clip('16:9'),
      { version: 1, ratio: '9:16', layout: { kind: 'split' } },
      ctx(),
    );
    expect(doc.layout.kind).toBe('split');
    expect(skipped).toEqual([]);
  });

  it('gives the same answer every time (the order is fixed)', () => {
    const doc = clip();
    const a = applyRecipe(doc, FULL, ctx());
    const b = applyRecipe(doc, FULL, ctx());
    const times = (d: ClipDocument) => d.segments.map((x) => [x.source, x.sourceIn, x.sourceOut]);
    expect(times(b.doc)).toEqual(times(a.doc));
    expect(captionsOf(b.doc)).toEqual(captionsOf(a.doc));
    expect(hookTitleOf(b.doc)?.style).toEqual(hookTitleOf(a.doc)?.style);
    expect(b.doc.bleeps).toEqual(a.doc.bleeps);
    const missingAll = applyRecipe(
      doc,
      starterSettings('starter-social-edit'),
      ctx({ transcript: null, hookTitleText: null }),
    );
    expect(missingAll.needs).toEqual(['transcript', 'faces', 'hookTitle']);
    expect(missingAll.skipped).toEqual([
      { part: 'silences', reason: 'no_transcript' },
      { part: 'captions', reason: 'no_transcript' },
    ]);
  });

  it('touches only the fields a recipe has', () => {
    const doc = clip();
    expect(applyRecipe(doc, { version: 1 }, ctx()).doc).toBe(doc);
    expect(
      applyRecipe(doc, { version: 1, exportQuality: '1080p', genre: 'podcast' }, ctx()).doc,
    ).toBe(doc);

    const captioned = applyRecipe(
      doc,
      { version: 1, captions: { on: true, styleId: 'karaoke' } },
      ctx(),
    ).doc;
    expect(captioned.canvas).toEqual(doc.canvas);
    expect(captioned.layout).toEqual(doc.layout);
    expect(captioned.segments).toEqual(doc.segments);
    expect(captioned.bleeps).toEqual(doc.bleeps);
    expect(captioned.meta).toBeUndefined();
    expect(captionsOf(captioned)?.styleId).toBe('karaoke');

    const cleaned = applyRecipe(doc, { version: 1, fillers: { on: true } }, ctx()).doc;
    expect(cleaned.tracks).toEqual(doc.tracks);
    expect(cleaned.layout).toEqual(doc.layout);
    expect(plays(cleaned, 30_150)).toBe(false);
    expect(plays(cleaned, 21_000)).toBe(true);
    expect(cleaned.meta?.cleanup).toEqual({ fillers: true });
  });

  it("uses the style's own size and words when a recipe leaves them out", () => {
    const look = lookOf('boxed');
    const doc = applyRecipe(
      clip(),
      { version: 1, captions: { on: true, styleId: 'boxed' } },
      ctx(),
    ).doc;
    expect(captionsOf(doc)).toMatchObject({
      sizePx: look.sizePx,
      maxWords: look.maxWords,
      position: { x: 0.5, y: 0.72 },
    });
  });

  it('restyles captions the clip already has', () => {
    const first = applyRecipe(
      clip(),
      { version: 1, captions: { on: true, styleId: 'karaoke' } },
      ctx(),
    ).doc;
    const second = applyRecipe(
      first,
      { version: 1, captions: { on: true, styleId: 'marker', sizePx: 66 } },
      ctx(),
    ).doc;
    expect(second.tracks.filter((track) => track.kind === 'captions')).toHaveLength(1);
    expect(captionsOf(second)).toMatchObject({ styleId: 'marker', sizePx: 66 });
  });

  it('falls back to Clean for a deleted caption style and says so', () => {
    const outcome = applyRecipe(
      clip(),
      { version: 1, captions: { on: true, styleId: 'gone-style' } },
      ctx(),
    );
    expect(captionsOf(outcome.doc)?.styleId).toBe('clean');
    expect(captionsOf(outcome.doc)?.sizePx).toBe(lookOf('clean').sizePx);
    expect(outcome.missing).toEqual([
      { part: 'captionStyle', id: 'gone-style', usedInstead: 'clean' },
    ]);
  });

  it("takes the workspace's own style when the caller knows it", () => {
    const own = { ...lookOf('clean'), sizePx: 90, maxWords: 4 };
    const outcome = applyRecipe(
      clip(),
      { version: 1, captions: { on: true, styleId: PRESET_ID } },
      ctx({ captionLook: (id) => (id === PRESET_ID ? own : null) }),
    );
    expect(captionsOf(outcome.doc)).toMatchObject({ styleId: PRESET_ID, sizePx: 90, maxWords: 4 });
    expect(outcome.missing).toEqual([]);
  });

  it('switches captions, bleeps and the hook title off', () => {
    const full = applyRecipe(clip(), FULL, ctx()).doc;
    const off = applyRecipe(
      full,
      {
        version: 1,
        captions: { on: false, styleId: 'clean' },
        bleep: { on: false, mode: 'bleep' },
        hookTitle: { on: false, look: 'hook-bold' },
      },
      ctx({ transcript: null }),
    );
    expect(captionsOf(off.doc)).toBeNull();
    expect(off.doc.bleeps).toEqual([]);
    expect(hookTitleOf(off.doc)).toBeNull();
    // Switching off needs no words.
    expect(off.needs).toEqual([]);
    expect(off.skipped).toEqual([]);
  });

  describe('layouts', () => {
    it('skips a layout the shape does not offer', () => {
      const doc = clip('16:9');
      const outcome = applyRecipe(doc, { version: 1, layout: { kind: 'split' } }, ctx());
      expect(outcome.doc.layout).toEqual(doc.layout);
      expect(outcome.skipped).toEqual([{ part: 'layout', reason: 'not_offered' }]);
    });

    it('applies a saved layout preset by id', () => {
      const saved = applyLayout(clip('9:16'), 'gameplay', WIDE).layout as SavedLayout;
      const outcome = applyRecipe(
        clip('9:16'),
        { version: 1, layout: { kind: 'gameplay', presetId: PRESET_ID } },
        ctx({ layoutPreset: (id) => (id === PRESET_ID ? saved : null) }),
      );
      expect(outcome.doc.layout.kind).toBe('gameplay');
      expect(outcome.doc.layout.areas.map((a) => a.frame)).toEqual(saved.areas.map((a) => a.frame));
      expect(outcome.missing).toEqual([]);
    });

    it('falls back to the built-in kind for a deleted preset, else keeps the layout', () => {
      const tall = applyRecipe(
        clip('9:16'),
        { version: 1, layout: { kind: 'split', presetId: PRESET_ID } },
        ctx(),
      );
      expect(tall.doc.layout.kind).toBe('split');
      expect(tall.missing).toEqual([{ part: 'layoutPreset', id: PRESET_ID, usedInstead: 'split' }]);

      const wide = clip('16:9');
      const kept = applyRecipe(
        wide,
        { version: 1, layout: { kind: 'split', presetId: PRESET_ID } },
        ctx(),
      );
      expect(kept.doc.layout).toEqual(wide.layout);
      expect(kept.missing).toEqual([{ part: 'layoutPreset', id: PRESET_ID, usedInstead: null }]);
    });

    it('carries a Custom layout whole', () => {
      const custom = addArea(clip('9:16'), WIDE, 'Chat');
      expect(custom.layout.kind).toBe('custom');
      const settings = recipeFromClip(custom);
      expect(settings.layout?.kind).toBe('custom');
      const applied = applyRecipe(clip('16:9'), settings, ctx()).doc;
      valid(applied);
      expect(applied.layout.kind).toBe('custom');
      expect(applied.layout.areas.map((a) => [a.name, a.frame])).toEqual(
        custom.layout.areas.map((a) => [a.name, a.frame]),
      );
    });
  });

  describe('Follow The Speaker', () => {
    const path = [{ at: 0, rect: { x: 0.3, y: 0, w: 0.3164, h: 1 } }];
    function following(): ClipDocument {
      const doc = clip('9:16');
      return enableFollow(doc, { mode: 'speaker', faceAssetId: FACES_ID, paths: [path] });
    }

    it('asks for faces and says which mode to switch on', () => {
      const outcome = applyRecipe(
        clip('9:16'),
        { version: 1, follow: { on: true, mode: 'both' } },
        ctx(),
      );
      expect(outcome.follow).toEqual({ mode: 'both' });
      expect(outcome.needs).toEqual(['faces']);
    });

    it('skips following on a wide shape', () => {
      const outcome = applyRecipe(
        clip('16:9'),
        { version: 1, follow: { on: true, mode: 'speaker' } },
        ctx(),
      );
      expect(outcome.follow).toBeNull();
      expect(outcome.skipped).toEqual([{ part: 'follow', reason: 'not_offered' }]);
    });

    it('switches following off, giving back the layout it replaced', () => {
      const doc = following();
      const outcome = applyRecipe(
        doc,
        { version: 1, follow: { on: false, mode: 'speaker' } },
        ctx(),
      );
      expect(outcome.doc.layout).toEqual(doc.layout.follow?.saved);
    });

    it('asks for nothing when the clip already follows the same way', () => {
      const outcome = applyRecipe(
        following(),
        { version: 1, follow: { on: true, mode: 'speaker' } },
        ctx(),
      );
      expect(outcome.follow).toBeNull();
      expect(outcome.needs).toEqual([]);
    });

    it('follows again after a new layout frames other areas', () => {
      const outcome = applyRecipe(following(), { version: 1, layout: { kind: 'gameplay' } }, ctx());
      expect(outcome.doc.layout.follow).toBeUndefined();
      expect(outcome.doc.layout.kind).toBe('gameplay');
      expect(outcome.follow).toEqual({ mode: 'speaker' });
      expect(outcome.needs).toEqual(['faces']);
    });
  });

  describe('words', () => {
    it('needs a transcript and skips every word part without one', () => {
      const doc = clip();
      const outcome = applyRecipe(
        doc,
        { ...FULL, ratio: undefined, layout: undefined, hookTitle: undefined },
        ctx({ transcript: null }),
      );
      expect(outcome.doc).toBe(doc);
      expect(outcome.needs).toEqual(['transcript']);
      expect(outcome.skipped).toEqual([
        { part: 'silences', reason: 'no_transcript' },
        { part: 'fillers', reason: 'no_transcript' },
        { part: 'captions', reason: 'no_transcript' },
        { part: 'bleep', reason: 'no_transcript' },
      ]);
    });

    it('says nobody speaks when the clip has no words', () => {
      const quiet: RecipeTranscript = { ...talking(), words: speech([[80_000, 90_000]]) };
      const doc = clip();
      const outcome = applyRecipe(
        doc,
        starterSettings('starter-auto-edit-talking-video'),
        ctx({ transcript: quiet }),
      );
      expect(outcome.doc).toBe(doc);
      expect(outcome.needs).toEqual([]);
      expect(outcome.skipped).toEqual([
        { part: 'silences', reason: 'no_speech' },
        { part: 'fillers', reason: 'no_speech' },
        { part: 'captions', reason: 'no_speech' },
      ]);
    });

    it('says when nothing was found to cut or bleep', () => {
      const plain: RecipeTranscript = { ...talking(), words: speech([[10_000, 70_000]]) };
      const outcome = applyRecipe(
        clip(),
        {
          version: 1,
          silences: { on: true, minMs: 800 },
          fillers: { on: true },
          bleep: { on: true, mode: 'bleep' },
        },
        ctx({ transcript: plain }),
      );
      expect(outcome.skipped).toEqual([
        { part: 'silences', reason: 'nothing_found' },
        { part: 'fillers', reason: 'nothing_found' },
        { part: 'bleep', reason: 'nothing_found' },
      ]);
      // The switches are recorded all the same, so Save As Recipe reads them back.
      expect(outcome.doc.meta?.cleanup).toEqual({ silencesMinMs: 800, fillers: true });
    });

    it('keeps loud pauses when the caller knows the sound', () => {
      const outcome = applyRecipe(
        clip(),
        { version: 1, silences: { on: true, minMs: 800 } },
        ctx({ isLoud: (range) => range.fromMs < 30_000 }),
      );
      expect(plays(outcome.doc, 21_000)).toBe(true);
      expect(plays(outcome.doc, 40_750)).toBe(false);
    });

    it('uses the workspace words for bleeps', () => {
      const outcome = applyRecipe(
        clip(),
        { version: 1, bleep: { on: true, mode: 'bleep' } },
        ctx({ bleepLists: { language: 'en', workspace: ['um'] } }),
      );
      expect(outcome.doc.bleeps.map((b) => b.from)).toEqual([29_960, 49_960]);
    });

    it('keeps the longest cuts that fit when every pause would pass the part limit', () => {
      // 200 pauses: 100 long (1.9 s) and 100 short (0.9 s), each after a 0.5 s word.
      const words: TranscriptWord[] = [];
      let at = 1_000;
      const longGaps: number[] = [];
      const shortGaps: number[] = [];
      for (let k = 0; k < 200; k += 1) {
        words.push({ i: k, start: at, end: at + 500, text: 'word', sure: 0.9 });
        at += 500;
        const gap = k % 2 === 0 ? 1_900 : 900;
        (k % 2 === 0 ? longGaps : shortGaps).push(at + gap / 2);
        at += gap;
      }
      words.push({ i: 200, start: at, end: at + 500, text: 'word', sure: 0.9 });
      const doc = createClipDocument({
        videoId: VIDEO_ID,
        fromMs: 1_000,
        toMs: at + 500,
        ratio: '9:16',
      });
      const outcome = applyRecipe(
        doc,
        { version: 1, silences: { on: true, minMs: 800 } },
        ctx({ transcript: { ...talking(), words, covered: [{ fromMs: 0, toMs: at + 1_000 }] } }),
      );
      valid(outcome.doc);
      expect(outcome.doc.segments.length).toBe(MAX_SEGMENTS);
      expect(longGaps.every((ms) => !plays(outcome.doc, ms))).toBe(true);
      expect(shortGaps.filter((ms) => !plays(outcome.doc, ms))).toHaveLength(
        MAX_SEGMENTS - 1 - 100,
      );
      expect(outcome.skipped).toEqual([]);
    });

    it('does not cut a clip shorter than allowed', () => {
      const doc = clip('9:16', 10_000, 13_600);
      const transcript: RecipeTranscript = {
        ...talking(),
        words: [
          { i: 0, start: 10_000, end: 10_400, text: 'hello', sure: 1 },
          { i: 1, start: 13_200, end: 13_600, text: 'there', sure: 1 },
        ],
      };
      const outcome = applyRecipe(
        doc,
        { version: 1, silences: { on: true, minMs: 800 } },
        ctx({ transcript }),
      );
      expect(outcome.doc.segments).toEqual(doc.segments);
      expect(outcome.skipped).toEqual([{ part: 'silences', reason: 'clip_too_short' }]);
      expect(outcome.doc.meta).toBeUndefined();
    });
  });

  describe('hook title', () => {
    it('needs a line when the caller has none', () => {
      const outcome = applyRecipe(
        clip(),
        { version: 1, hookTitle: { on: true, look: 'hook-bold' } },
        ctx({ hookTitleText: null }),
      );
      expect(hookTitleOf(outcome.doc)).toBeNull();
      expect(outcome.needs).toEqual(['hookTitle']);
    });

    it("restyles the clip's own title without a new line", () => {
      const first = applyRecipe(
        clip(),
        { version: 1, hookTitle: { on: true, look: 'hook-bold' } },
        ctx(),
      ).doc;
      const outcome = applyRecipe(
        first,
        { version: 1, hookTitle: { on: true, look: 'hook-pop' } },
        ctx({ hookTitleText: null }),
      );
      expect(outcome.needs).toEqual([]);
      expect(hookTitleOf(outcome.doc)?.text).toBe('The one thing nobody tells you');
      expect(recipeFromClip(outcome.doc).hookTitle).toEqual({ on: true, look: 'hook-pop' });
    });
  });

  describe('intro and outro parts', () => {
    const introLayout: SavedLayout = {
      kind: 'fullscreen',
      areas: [
        {
          id: 'area_intro',
          name: 'Video',
          frame: { x: 0, y: 0, w: 1, h: 1 },
          crop: [{ at: 0, rect: { x: 0.341796875, y: 0, w: 0.31640625, h: 1 } }],
          fit: 'cover',
        },
      ],
    };

    function branded(sameSource = false): ClipDocument {
      const doc = clip('9:16');
      const main = doc.segments[0] as Segment;
      const introSource = sameSource ? main.source : 'src_intro';
      const next: ClipDocument = {
        ...doc,
        sources: sameSource
          ? doc.sources
          : [...doc.sources, { id: 'src_intro', videoId: INTRO_VIDEO_ID }],
        segments: [
          sameSource
            ? {
                id: 'seg_intro',
                source: introSource,
                sourceIn: 20_000,
                sourceOut: 22_000,
                speed: 1,
                volume: 1,
                role: 'intro',
                layoutOverride: introLayout,
              }
            : {
                id: 'seg_intro',
                source: introSource,
                sourceIn: 0,
                sourceOut: 2_000,
                speed: 1,
                volume: 1,
                role: 'intro',
                layoutOverride: introLayout,
              },
          main,
          {
            id: 'seg_outro',
            source: 'src_intro',
            sourceIn: 2_000,
            sourceOut: 4_000,
            speed: 1,
            volume: 1,
            role: 'outro',
            layoutOverride: introLayout,
          },
        ],
      };
      if (sameSource) next.sources = [...doc.sources, { id: 'src_intro', videoId: INTRO_VIDEO_ID }];
      valid(next);
      return next;
    }

    it('never cuts, captions or bleeps them, and reads the words of the main source', () => {
      const doc = branded();
      const settings: RecipeSettings = {
        ...starterSettings('starter-auto-edit-talking-video'),
        bleep: { on: true, mode: 'bleep' },
      };
      const outcome = applyRecipe(doc, settings, ctx());
      valid(outcome.doc);
      const segments = outcome.doc.segments;
      expect(segments[0]).toEqual(doc.segments[0]);
      expect(segments.at(-1)).toEqual(doc.segments[2]);
      expect(segments.length).toBeGreaterThan(3);
      const mainId = (doc.segments[1] as Segment).source;
      expect(plays(outcome.doc, 21_000, mainId)).toBe(false);
      expect(captionsOf(outcome.doc)?.transcriptAssetId).toBe(TRANSCRIPT_ID);
      expect(outcome.doc.bleeps.every((b) => b.source === mainId)).toBe(true);
      expect(outcome.skipped).toEqual([]);
    });

    it('spares an intro that plays a stretch of the same video', () => {
      const doc = branded(true);
      const outcome = applyRecipe(doc, { version: 1, silences: { on: true, minMs: 800 } }, ctx());
      valid(outcome.doc);
      expect(outcome.doc.segments[0]).toEqual(doc.segments[0]);
      expect(outcome.doc.segments.at(-1)).toEqual(doc.segments[2]);
      // The other pause is cut from the main part.
      expect(plays(outcome.doc, 40_750, (doc.segments[1] as Segment).source)).toBe(false);
    });
  });
});

describe('recipeFromClip', () => {
  it('reads back what was applied, and applies again to the same clip (round trip)', () => {
    const made = applyRecipe(clip(), FULL, ctx()).doc;
    const settings = recipeFromClip(made, { exportQuality: '1080p' });
    expect(recipeSettingsSchema.safeParse(settings).success).toBe(true);
    expect(settings).toEqual({ ...FULL, exportQuality: '1080p' });

    const again = applyRecipe(clip(), settings, ctx()).doc;
    expect(recipeFromClip(again, { exportQuality: '1080p' })).toEqual(settings);
    expect(again.canvas).toEqual(made.canvas);
    expect(again.layout.kind).toBe(made.layout.kind);
    expect(again.layout.areas.map((a) => a.frame)).toEqual(made.layout.areas.map((a) => a.frame));
    expect(captionsOf(again)).toEqual(captionsOf(made));
    expect(again.segments.map((s) => [s.sourceIn, s.sourceOut])).toEqual(
      made.segments.map((s) => [s.sourceIn, s.sourceOut]),
    );
    const bleeps = (d: ClipDocument) => d.bleeps.map(({ source: _s, ...rest }) => rest);
    expect(bleeps(again)).toEqual(bleeps(made));
  });

  it('reads a fresh clip as its shape and layout only', () => {
    expect(recipeFromClip(clip('4:5'))).toEqual({
      version: 1,
      ratio: '4:5',
      layout: { kind: 'fullscreen' },
    });
  });

  it("saves a followed clip's own layout and the follow switch", () => {
    const own = applyLayout(clip('9:16'), 'split', WIDE);
    const followed = enableFollow(own, {
      mode: 'speaker',
      faceAssetId: FACES_ID,
      paths: [[{ at: 0, rect: { x: 0.2, y: 0, w: 0.4, h: 0.6 } }]],
    });
    expect(recipeFromClip(followed)).toEqual({
      version: 1,
      ratio: '9:16',
      layout: { kind: 'split' },
      follow: { on: true, mode: 'speaker' },
    });
  });

  it('carries the Clip Setup and export extras', () => {
    expect(
      recipeFromClip(clip(), { clipLength: 'under30', genre: 'gaming', exportQuality: '720p' }),
    ).toMatchObject({
      clipLength: 'under30',
      genre: 'gaming',
      exportQuality: '720p',
    });
  });
});

describe('describeRecipe', () => {
  it('reads a recipe in one plain line', () => {
    expect(
      describeRecipe({
        version: 1,
        ratio: '9:16',
        layout: { kind: 'blurred' },
        captions: { on: true, styleId: 'marker' },
        silences: { on: true, minMs: 800 },
        exportQuality: '1080p',
      }),
    ).toBe('Vertical, Blurred, Marker captions, silences removed, 1080p');
  });

  it('reads an empty recipe', () => {
    expect(describeRecipe({ version: 1 })).toBe('Changes nothing yet');
  });

  it('starts with a capital and names every switch', () => {
    expect(
      describeRecipe({
        version: 1,
        follow: { on: true, mode: 'speaker' },
        fillers: { on: true },
        bleep: { on: true, mode: 'mute' },
        hookTitle: { on: true, look: 'hook-bold' },
        exportQuality: '1080p60',
      }),
    ).toBe('Follows the speaker, filler words removed, bad words muted, hook title, 1080p 60 fps');
    expect(describeRecipe({ version: 1, bleep: { on: true, mode: 'bleep' } })).toBe(
      'Bad words bleeped',
    );
    expect(describeRecipe({ version: 1, captions: { on: false, styleId: 'clean' } })).toBe(
      'No captions',
    );
  });

  it("uses the workspace's own names when given", () => {
    const settings: RecipeSettings = {
      version: 1,
      ratio: '1:1',
      layout: { kind: 'split', presetId: PRESET_ID },
      captions: { on: true, styleId: TRANSCRIPT_ID },
    };
    expect(
      describeRecipe(settings, {
        captionStyle: (id) => (id === TRANSCRIPT_ID ? 'Client Yellow' : null),
        layoutPreset: (id) => (id === PRESET_ID ? 'Podcast Pair' : null),
      }),
    ).toBe('Square, Podcast Pair, Client Yellow captions');
    expect(describeRecipe(settings)).toBe('Square, Split, Own captions');
  });
});

describe('recipeFromSetup', () => {
  const setup = defaultClipSetup(600_000);

  it("puts the setup's own controls on top of the recipe", () => {
    const base = starterSettings('starter-social-edit');
    const settings = recipeFromSetup(
      {
        ...setup,
        ratio: '1:1',
        length: '30to60',
        genre: 'podcast',
        captions: { on: true, styleId: 'bold-pop' },
        follow: false,
        silences: false,
        hookTitle: true,
      },
      base,
    );
    expect(recipeSettingsSchema.safeParse(settings).success).toBe(true);
    expect(settings).toEqual({
      version: 1,
      ratio: '1:1',
      clipLength: '30to60',
      genre: 'podcast',
      follow: { on: false, mode: 'speaker' },
      captions: { on: true, styleId: 'bold-pop' },
      silences: { on: false, minMs: 800 },
      hookTitle: { on: true, look: 'hook-bold' },
    });
  });

  it("keeps the recipe's caption place while its style is kept", () => {
    const base: RecipeSettings = {
      version: 1,
      captions: { on: true, styleId: 'marker', sizePx: 70, maxWords: 2 },
      fillers: { on: true },
    };
    const same = recipeFromSetup({ ...setup, captions: { on: true, styleId: 'marker' } }, base);
    expect(same.captions).toEqual({ on: true, styleId: 'marker', sizePx: 70, maxWords: 2 });
    expect(same.fillers).toEqual({ on: true });
    const other = recipeFromSetup({ ...setup, captions: { on: true, styleId: 'clean' } }, base);
    expect(other.captions).toEqual({ on: true, styleId: 'clean' });
    const off = recipeFromSetup(setup, base);
    expect(off.captions).toEqual({ on: false, styleId: setup.captions.styleId });
  });

  it('without a recipe, writes only what the setup switches on', () => {
    expect(recipeFromSetup(setup, null)).toEqual({
      version: 1,
      ratio: '9:16',
      clipLength: 'auto',
      genre: 'auto',
    });
    expect(recipeFromSetup({ ...setup, silences: true, follow: true }, null)).toMatchObject({
      silences: { on: true, minMs: 800 },
      follow: { on: true, mode: 'speaker' },
    });
  });
});

describe('Starter Recipes', () => {
  it('are the five, in order, with stable ids, Title Case names and sentence-case help', () => {
    expect(STARTER_RECIPES.map((s) => s.id)).toEqual([...STARTER_RECIPE_IDS]);
    expect(STARTER_RECIPES.map((s) => s.name)).toEqual([
      'Clean Up Recording',
      'Auto-Edit Talking Video',
      'Captions Only',
      'Reframe',
      'Social Edit',
    ]);
    for (const starter of STARTER_RECIPES) {
      expect(recipeSettingsSchema.safeParse(starter.settings).success).toBe(true);
      expect(starter.help).toMatch(/^[A-Z][a-z]/);
      expect(starter.help.slice(1)).toBe(starter.help.slice(1).toLowerCase());
      expect(starterRecipe(starter.id)).toBe(starter);
    }
    expect(starterRecipe('starter-nope')).toBeNull();
  });

  const reads: Record<string, string> = {
    'starter-clean-up-recording': 'Silences removed, filler words removed',
    'starter-auto-edit-talking-video': 'Clean captions, silences removed, filler words removed',
    'starter-captions-only': 'Bold Pop captions',
    'starter-reframe': 'Vertical, follows the speaker',
    'starter-social-edit':
      'Vertical, follows the speaker, Bold Pop captions, silences removed, hook title',
  };

  it.each(STARTER_RECIPES.map((s) => [s.id, s] as const))(
    '%s applies to a fresh clip and reads back',
    (_id, starter) => {
      expect(describeRecipe(starter.settings)).toBe(reads[starter.id]);
      const outcome = applyRecipe(clip('16:9'), starter.settings, ctx());
      valid(outcome.doc);
      expect(outcome.missing).toEqual([]);
      // Follow is switched on by the caller with the faces; the rest is in the clip.
      const back = recipeFromClip(outcome.doc);
      const { follow, ...rest } = starter.settings;
      expect(back).toMatchObject(rest);
      expect(outcome.follow).toEqual(follow?.on ? { mode: follow.mode } : null);
    },
  );

  it('Reframe touches nothing but shape and follow', () => {
    const doc = applyRecipe(
      clip('16:9'),
      { ...FULL, ratio: undefined, layout: undefined },
      ctx(),
    ).doc;
    const outcome = applyRecipe(
      doc,
      starterSettings('starter-reframe'),
      ctx({ transcript: null, hookTitleText: null }),
    );
    expect(outcome.doc.canvas.ratio).toBe('9:16');
    expect(outcome.doc.segments).toEqual(doc.segments);
    expect(outcome.doc.bleeps).toEqual(doc.bleeps);
    expect(outcome.doc.meta).toEqual(doc.meta);
    expect(outcome.doc.layout.kind).toBe(doc.layout.kind);
    expect(outcome.doc.tracks.map((t) => t.kind)).toEqual(doc.tracks.map((t) => t.kind));
    expect(captionsOf(outcome.doc)).toEqual(captionsOf(doc));
    expect(outcome.follow).toEqual({ mode: 'speaker' });
    expect(outcome.needs).toEqual(['faces']);
    expect(outcome.skipped).toEqual([]);
  });
});
