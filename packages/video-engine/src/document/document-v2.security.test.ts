/**
 * Security sweep, Sprint 13 Module 16: Sprint 12's "Documents" rows run
 * again over what Sprint 13 added to the clip document (version 2):
 * captions tracks and their edits, bleeps, Follow The Speaker's hand fixes,
 * brand cards, montage joins and parts. A hostile client can send any JSON
 * on save, so each cap holds at its value and one past it is refused, each
 * new object is strict, each reference is a plain id or a uuid, and the
 * refusal never repeats the text or the key that was sent.
 *
 * Existing tests this extends: `document.security.test.ts` (Sprint 12's caps
 * and strict keys), `upgrade.test.ts` (unknown keys without echo),
 * `cleanup/bleeps.test.ts` and `render/bleep-plan.test.ts` (the bleep cap at
 * the editor's own add).
 */
import { TEST_VIDEO_ID, testDocument, testSegment } from '../render/test-docs';
import {
  CAPTION_MAX_WORDS,
  CAPTION_SIZE_MAX,
  CAPTION_WORD_MAX,
  JOIN_FADE_MS,
  MAX_BLEEPS,
  MAX_CAPTION_EDITS,
  MAX_FOLLOW_OVERRIDES,
  MAX_SEGMENTS,
  MONTAGE_MAX_CLIPS,
  MONTAGE_PART_TITLE_MAX,
} from './limits';
import { CARD_MS, CARD_TEXT_MAX, type ClipDocument } from './schema';
import { safeParseClipDocument } from './upgrade';

const UUID = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const KEY = 'clips/other-org/library/0123456789abcdef0123456789abcdef.json';
const HOSTILE = '<img src=x onerror=alert(1)>';

type Json = Record<string, unknown>;

function base(): Json {
  return JSON.parse(JSON.stringify(testDocument([testSegment('seg', 0, 30_000)]))) as Json;
}

function captions(extra: Json = {}): Json {
  return {
    id: 'cap',
    kind: 'captions',
    transcriptAssetId: UUID,
    language: 'en',
    styleId: 'karaoke',
    position: { x: 0.5, y: 0.7 },
    sizePx: 80,
    maxWords: 3,
    edits: {},
    ...extra,
  };
}

function withCaptions(extra: Json = {}): Json {
  const doc = base();
  doc.tracks = [captions(extra)];
  return doc;
}

function bleep(i: number, extra: Json = {}): Json {
  return { id: `b${i}`, source: 'src', from: i * 10, to: i * 10 + 5, mode: 'bleep', ...extra };
}

function card(extra: Json = {}): Json {
  return {
    text: 'Follow For More',
    background: '#101010',
    colour: '#ffffff',
    logo: null,
    look: null,
    durationMs: CARD_MS,
    ...extra,
  };
}

function followed(overrides: Json[], extra: Json = {}): Json {
  const doc = base();
  const layout = doc.layout as Json;
  doc.layout = {
    ...layout,
    follow: { mode: 'speaker', faceAssetId: UUID, overrides, saved: { ...layout }, ...extra },
  };
  return doc;
}

function montage(count: number, title = 'Part'): Json {
  const doc = base();
  doc.meta = {
    montage: {
      parts: Array.from({ length: count }, (_, i) => ({
        clipId: `clip${i}`,
        title,
        firstSegment: 'seg',
      })),
    },
  };
  return doc;
}

function reads(doc: unknown): ClipDocument {
  const result = safeParseClipDocument(doc);
  if (!result.ok) throw new Error(`expected the document to read: ${result.issues.join('; ')}`);
  return result.doc;
}

function refused(doc: unknown): string[] {
  const result = safeParseClipDocument(doc);
  if (result.ok) throw new Error('expected the document to be refused');
  return result.issues;
}

/** The cap itself reads, and one more is refused: the count is the reason. */
function capped(make: (count: number) => unknown, cap: number): void {
  reads(make(cap));
  refused(make(cap + 1));
}

describe('Clips security: Documents version 2 (Sprint 13)', () => {
  it('reads a document with every Sprint 13 part, so every refusal below is the change alone', () => {
    const doc = withCaptions({ edits: { '0': { text: 'Hello' }, '3': { hidden: true } } });
    doc.bleeps = [bleep(1)];
    doc.cards = { opening: card(), closing: card({ logo: { asset: UUID } }) };
    doc.joins = [{ beforeSegment: 'seg', kind: 'fade', ms: JOIN_FADE_MS }];
    expect(reads(doc).schemaVersion).toBe(2);
    expect(
      reads(followed([{ from: 0, to: 1_000, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } }])),
    ).toBeDefined();
    expect(reads(montage(2))).toBeDefined();
    expect(TEST_VIDEO_ID).toBeDefined();
  });

  describe('captions', () => {
    it(`keeps up to ${MAX_CAPTION_EDITS} word changes`, () => {
      capped(
        (count) =>
          withCaptions({
            edits: Object.fromEntries(
              Array.from({ length: count }, (_, i) => [String(i), { hidden: true }]),
            ),
          }),
        MAX_CAPTION_EDITS,
      );
    });

    it(`keeps a changed word up to ${CAPTION_WORD_MAX} characters, and never a blank one`, () => {
      reads(withCaptions({ edits: { '1': { text: 'w'.repeat(CAPTION_WORD_MAX) } } }));
      refused(withCaptions({ edits: { '1': { text: 'w'.repeat(CAPTION_WORD_MAX + 1) } } }));
      refused(withCaptions({ edits: { '1': { text: '   ' } } }));
      refused(withCaptions({ edits: { '1': { text: '' } } }));
    });

    it.each(['01', '-1', '1.5', '1e3', 'x', '__proto__', 'constructor', '1234567890', HOSTILE])(
      'refuses a word index that is not a plain whole number: %j',
      (index) => {
        const issues = refused(withCaptions({ edits: { [index]: { hidden: true } } }));
        // A key the schema refused is never written back whole.
        if (index === HOSTILE) expect(issues.join('\n')).not.toContain('onerror');
      },
    );

    it('refuses a word change with a field it does not know, without repeating it', () => {
      const issues = refused(
        withCaptions({ edits: { '2': { text: 'ok', key: KEY, organizationId: 'other-org' } } }),
      );
      const text = issues.join('\n');
      expect(text).not.toContain(KEY);
      expect(text).not.toContain('other-org');
    });

    it('never repeats an over-long word it refused', () => {
      const word = `${HOSTILE}${'w'.repeat(CAPTION_WORD_MAX)}`;
      expect(refused(withCaptions({ edits: { '2': { text: word } } })).join('\n')).not.toContain(
        'onerror',
      );
    });

    it.each([
      ['a size past the cap', { sizePx: CAPTION_SIZE_MAX + 1 }],
      ['more words a page than a style can hold', { maxWords: CAPTION_MAX_WORDS + 1 }],
      ['a language that is not a short code', { language: 'en-US' }],
      ['a language that is a path', { language: '../en' }],
      ['a transcript named by its storage key', { transcriptAssetId: KEY }],
      ['a style id that is a path', { styleId: '../other-org/style' }],
      ['a style id with a space', { styleId: 'my style' }],
      ['a source the clip does not have', { source: 'other-src' }],
      ['a mark colour that is not #RRGGBB', { markColour: 'red; background:url(x)' }],
      ['a letter case it does not know', { letterCase: 'title' }],
      ['a position off the canvas', { position: { x: 1.5, y: 0.5 } }],
      ['a field it does not know', { organizationId: 'other-org' }],
    ])('refuses a captions track with %s', (_label, extra) => {
      const text = refused(withCaptions(extra)).join('\n');
      expect(text).not.toContain(KEY);
      expect(text).not.toContain('other-org');
    });

    it('refuses two captions tracks that do not each name their own video', () => {
      const doc = base();
      doc.tracks = [captions(), captions({ id: 'cap2' })];
      refused(doc);
      doc.tracks = [captions({ source: 'src' }), captions({ id: 'cap2', source: 'src' })];
      refused(doc);
    });
  });

  describe('bleeps', () => {
    it(`keeps up to ${MAX_BLEEPS}`, () => {
      capped((count) => {
        const doc = base();
        doc.bleeps = Array.from({ length: count }, (_, i) => bleep(i));
        return doc;
      }, MAX_BLEEPS);
    });

    it.each([
      ['an end before its start', { from: 50, to: 10 }],
      ['a negative time', { from: -5 }],
      ['a video the clip does not have', { source: 'other-src' }],
      ['a mode it does not know', { mode: 'beep-and-shout' }],
      ['a field it does not know', { organizationId: 'other-org' }],
    ])('refuses a bleep with %s', (_label, extra) => {
      const doc = base();
      doc.bleeps = [bleep(1, extra)];
      expect(refused(doc).join('\n')).not.toContain('other-org');
    });

    it('refuses two bleeps with one id', () => {
      const doc = base();
      doc.bleeps = [bleep(1), bleep(1)];
      refused(doc);
    });
  });

  describe('Follow The Speaker', () => {
    const fix = (i: number) => ({
      from: i * 10,
      to: i * 10 + 5,
      rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
    });

    it(`keeps up to ${MAX_FOLLOW_OVERRIDES} hand fixes`, () => {
      capped(
        (count) => followed(Array.from({ length: count }, (_, i) => fix(i))),
        MAX_FOLLOW_OVERRIDES,
      );
    });

    it.each([
      ['a face file named by its storage key', { faceAssetId: KEY }],
      ['a person anchor past its length', { personId: 'p'.repeat(41) }],
      ['a field it does not know', { organizationId: 'other-org' }],
    ])('refuses a follow with %s', (_label, extra) => {
      expect(refused(followed([fix(1)], extra)).join('\n')).not.toContain(KEY);
    });

    it('refuses a hand fix that ends before it starts, or carries a field it does not know', () => {
      refused(followed([{ ...fix(1), from: 50, to: 10 }]));
      refused(followed([{ ...fix(1), organizationId: 'other-org' }]));
    });

    it('refuses a saved layout that is itself followed', () => {
      const doc = followed([fix(1)]);
      const follow = (doc.layout as Json).follow as Json;
      (follow.saved as Json).follow = { ...follow };
      refused(doc);
    });
  });

  describe('cards', () => {
    function withCard(extra: Json): Json {
      const doc = base();
      doc.cards = { closing: card(extra) };
      return doc;
    }

    it(`keeps a card line up to ${CARD_TEXT_MAX} characters`, () => {
      reads(withCard({ text: 'c'.repeat(CARD_TEXT_MAX) }));
      refused(withCard({ text: 'c'.repeat(CARD_TEXT_MAX + 1) }));
    });

    it.each([
      ['a second line', { text: 'One\\NTwo\nThree' }],
      ['a carriage return', { text: 'One\rDialogue: 0,0:00:00.00' }],
      ['an emoji', { text: 'Follow 🔥' }],
      ['no line and no logo', { text: '  ', logo: null }],
      ['a logo named by its storage key', { logo: { asset: KEY } }],
      ['a logo with a field it does not know', { logo: { asset: UUID, key: KEY } }],
      ['a look that is a path', { look: '../hook-bold' }],
      ['a length of its own', { durationMs: 60_000 }],
      ['a colour that is not #RRGGBB', { background: 'url(x)' }],
      ['a field it does not know', { organizationId: 'other-org' }],
    ])('refuses a card with %s', (_label, extra) => {
      const text = refused(withCard(extra)).join('\n');
      expect(text).not.toContain(KEY);
      expect(text).not.toContain('Dialogue');
    });

    it('refuses a third card', () => {
      const doc = base();
      doc.cards = { opening: card(), closing: card(), middle: card() };
      refused(doc);
    });
  });

  describe('montage joins and parts', () => {
    it(`keeps up to ${MAX_SEGMENTS} joins`, () => {
      capped((count) => {
        const doc = base();
        doc.joins = Array.from({ length: count }, (_, i) => ({
          beforeSegment: `gone${i}`,
          kind: 'fade',
          ms: JOIN_FADE_MS,
        }));
        return doc;
      }, MAX_SEGMENTS);
    });

    it.each([
      ['a length of its own', { ms: 10_000 }],
      ['a kind it does not know', { kind: 'wipe' }],
      ['a part named by a path', { beforeSegment: '../seg' }],
      ['a field it does not know', { organizationId: 'other-org' }],
    ])('refuses a join with %s', (_label, extra) => {
      const doc = base();
      doc.joins = [{ beforeSegment: 'seg', kind: 'fade', ms: JOIN_FADE_MS, ...extra }];
      refused(doc);
    });

    it('refuses two joins before one part', () => {
      const doc = base();
      const join = { beforeSegment: 'seg', kind: 'fade', ms: JOIN_FADE_MS };
      doc.joins = [join, join];
      refused(doc);
    });

    it(`keeps up to ${MONTAGE_MAX_CLIPS} parts, each name up to ${MONTAGE_PART_TITLE_MAX} characters`, () => {
      capped((count) => montage(count), MONTAGE_MAX_CLIPS);
      reads(montage(2, 't'.repeat(MONTAGE_PART_TITLE_MAX)));
      const text = refused(montage(2, `${HOSTILE}${'t'.repeat(MONTAGE_PART_TITLE_MAX)}`)).join(
        '\n',
      );
      expect(text).not.toContain('onerror');
    });

    it('refuses a part that names its clip by anything but an id, or carries a field it does not know', () => {
      const doc = montage(2);
      const parts = ((doc.meta as Json).montage as Json).parts as Json[];
      (parts[0] as Json).clipId = KEY;
      expect(refused(doc).join('\n')).not.toContain(KEY);
      const other = montage(2);
      const more = ((other.meta as Json).montage as Json).parts as Json[];
      (more[1] as Json).organizationId = 'other-org';
      expect(refused(other).join('\n')).not.toContain('other-org');
    });
  });

  it('refuses a version 2 field on the document it does not know, without repeating it', () => {
    const doc = withCaptions();
    doc.captionsKey = KEY;
    const text = refused(doc).join('\n');
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('captionsKey');
  });
});
