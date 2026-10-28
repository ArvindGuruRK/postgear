/**
 * Holds the font table to the files it describes.
 *
 * The table is what the editor declares, the exporter inlines and the Font
 * Licences dialog shows, and nearly every value in it is a claim about a
 * binary: that the file exists, that it covers the weights it is declared
 * for, that its copyright notice and reserved names are the ones quoted. A
 * wrong claim fails quietly wherever it matters (a weight the file lacks is
 * drawn as the nearest one it has, a wrong copyright line ships in every
 * licence list), so this reads the files themselves.
 *
 * The WOFF2 reader below is the least that answers those questions: the
 * header, the table directory and the one brotli stream, out of which the
 * `name`, `fvar` and `OS/2` tables come as they are (WOFF2 only ever
 * transforms `glyf`, `loca` and `hmtx`). Node's zlib has brotli, so it needs
 * no dependency, and it lives here because the package itself never opens a
 * file.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import type { FontCategory } from '../types';
import {
  FONT_CATEGORIES,
  FONT_CATEGORY_LABELS,
  FONT_IDS,
  FONT_LICENCE_LABELS,
  FONTS,
  type FontDef,
  faceWeight,
  filesFor,
  fontLabel,
  fontStack,
  fontsInCategory,
  resolveWeight,
} from './index';

const FONTS_DIR = join(__dirname, '..', '..', 'fonts');
const ALL: FontDef[] = FONT_IDS.map((id) => FONTS[id]);

// ---------------------------------------------------------------------------
// Reading a WOFF2 file
// ---------------------------------------------------------------------------

/**
 * WOFF2's shorthand for common tables: a directory entry names one by its
 * index here (spec section 5.2). Commas, not spaces, separate them, since
 * three of the tags end in a space.
 */
const KNOWN_TAGS = (
  'cmap,head,hhea,hmtx,maxp,name,OS/2,post,cvt ,fpgm,glyf,loca,prep,CFF ,VORG,EBDT,EBLC,gasp,' +
  'hdmx,kern,LTSH,PCLT,VDMX,vhea,vmtx,BASE,GDEF,GPOS,GSUB,EBSC,JSTF,MATH,CBDT,CBLC,COLR,CPAL,' +
  'SVG ,sbix,acnt,avar,bdat,bloc,bsln,cvar,fdsc,feat,fmtx,fvar,gvar,hsty,just,lcar,mort,morx,' +
  'opbd,prop,trak,Zapf,Silf,Glat,Gloc,Feat,Sill'
).split(',');

/** What a file says about itself, in the terms the table uses. */
interface FileFacts {
  /** Name ID 0, with line breaks folded the way `FontDef.copyright` folds them. */
  copyright: string | undefined;
  /** Name ID 9. */
  designer: string | undefined;
  /** The `fvar` weight axis, when the file has one. */
  wght: [number, number] | undefined;
  /** OS/2 `usWeightClass`. */
  weightClass: number;
  /** OS/2 `fsSelection` bit 0. */
  italic: boolean;
}

function readBase128(view: DataView, at: number): [number, number] {
  let value = 0;

  for (let i = 0; i < 5; i += 1) {
    const byte = view.getUint8(at + i);
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, at + i + 1];
  }

  throw new Error('A UIntBase128 longer than five bytes.');
}

function woff2Tables(file: string): Map<string, DataView> {
  const bytes = readFileSync(join(FONTS_DIR, file));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.toString('latin1', 0, 4) !== 'wOF2') throw new Error(`${file} is not WOFF2.`);
  if (bytes.toString('latin1', 4, 8) === 'ttcf') throw new Error(`${file} is a collection.`);

  const tableCount = view.getUint16(12);
  const compressedLength = view.getUint32(20);
  const entries: Array<{ tag: string; length: number }> = [];
  let at = 48;

  for (let i = 0; i < tableCount; i += 1) {
    const flags = view.getUint8(at);
    at += 1;

    let tag = KNOWN_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) {
      tag = bytes.toString('latin1', at, at + 4);
      at += 4;
    }

    let length: number;
    [length, at] = readBase128(view, at);

    // `glyf` and `loca` are transformed unless their version is 3; any other
    // table only when its version is not 0. A transformed table's stream
    // length follows its original length.
    const version = flags >> 6;
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    if (transformed) [length, at] = readBase128(view, at);

    entries.push({ tag, length });
  }

  const stream = brotliDecompressSync(bytes.subarray(at, at + compressedLength));
  const tables = new Map<string, DataView>();
  let offset = 0;

  for (const { tag, length } of entries) {
    tables.set(tag, new DataView(stream.buffer, stream.byteOffset + offset, length));
    offset += length;
  }

  return tables;
}

/** A name record in Windows Unicode English, which every file here carries. */
function nameRecord(name: DataView, id: number): string | undefined {
  const count = name.getUint16(2);
  const storage = name.getUint16(4);

  for (let i = 0; i < count; i += 1) {
    const record = 6 + i * 12;
    const platform = name.getUint16(record);
    const encoding = name.getUint16(record + 2);
    const language = name.getUint16(record + 4);

    if (name.getUint16(record + 6) !== id || platform !== 3 || language !== 0x409) continue;
    if (encoding !== 1 && encoding !== 10) continue;

    const length = name.getUint16(record + 8);
    const start = storage + name.getUint16(record + 10);
    let text = '';
    for (let k = 0; k < length; k += 2) text += String.fromCharCode(name.getUint16(start + k));
    return text;
  }

  return undefined;
}

function weightAxis(fvar: DataView | undefined): [number, number] | undefined {
  if (!fvar) return undefined;

  const axes = fvar.getUint16(4);
  const count = fvar.getUint16(8);
  const size = fvar.getUint16(10);

  for (let i = 0; i < count; i += 1) {
    const axis = axes + i * size;
    const tag = String.fromCharCode(
      fvar.getUint8(axis),
      fvar.getUint8(axis + 1),
      fvar.getUint8(axis + 2),
      fvar.getUint8(axis + 3),
    );

    if (tag === 'wght') return [fvar.getInt32(axis + 4) / 65536, fvar.getInt32(axis + 12) / 65536];
  }

  return undefined;
}

const fold = (text: string | undefined) => text?.replace(/\s+/g, ' ').trim();

const facts = new Map<string, FileFacts>();

function factsOf(file: string): FileFacts {
  let known = facts.get(file);

  if (!known) {
    const tables = woff2Tables(file);
    const name = tables.get('name');
    const os2 = tables.get('OS/2');
    if (!name || !os2) throw new Error(`${file} has no name or OS/2 table.`);

    known = {
      copyright: fold(nameRecord(name, 0)),
      designer: fold(nameRecord(name, 9)),
      wght: weightAxis(tables.get('fvar')),
      weightClass: os2.getUint16(4),
      italic: (os2.getUint16(62) & 1) === 1,
    };
    facts.set(file, known);
  }

  return known;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** The house rule (`apps/web/src/lib/title-case.test.ts`): every word that starts with a letter starts with a capital. */
function isTitleCase(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean);
  const capitalised = words.every((word) => {
    const first = word.replace(/^[^A-Za-z0-9]+/, '')[0];
    if (!first || !/[A-Za-z]/.test(first)) return true;
    return first === first.toUpperCase();
  });
  return capitalised && text !== text.toUpperCase();
}

/** Whether a family's own name uses a reserved name, which is what the OFL's condition 3 restricts. */
function usesName(family: string, reserved: string): boolean {
  const escaped = reserved.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(family);
}

function licenceText(id: string): string {
  return readFileSync(join(FONTS_DIR, 'licenses', `${id}.txt`), 'utf8');
}

const GENERIC: Record<FontCategory, string> = {
  sans: 'sans-serif',
  serif: 'serif',
  display: 'sans-serif',
  script: 'cursive',
  handwritten: 'cursive',
  comic: 'sans-serif',
  mono: 'monospace',
};

describe('the font table', () => {
  it('has a def for every FontId in types.ts, each under its own id', () => {
    const source = readFileSync(join(__dirname, '..', 'types.ts'), 'utf8');
    const union = /export type FontId =([^;]*);/.exec(source)?.[1] ?? '';
    const ids = [...union.matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1]);

    expect(ids).toHaveLength(52);
    expect([...FONT_IDS].sort()).toEqual([...ids].sort());
    expect(ALL.filter((font, index) => font.id !== FONT_IDS[index])).toEqual([]);
  });

  it('files every family under a known category, licence and source', () => {
    const licences = Object.keys(FONT_LICENCE_LABELS);

    expect(
      ALL.filter(
        (font) =>
          !FONT_CATEGORIES.includes(font.category) ||
          !licences.includes(font.licence) ||
          !['google-subset', 'upstream-full'].includes(font.source),
      ).map((font) => font.id),
    ).toEqual([]);
    expect(ALL.filter((font) => font.licence === 'Apache-2.0').map((font) => font.id)).toEqual([
      'luckiest-guy',
      'chewy',
      'satisfy',
      'rancho',
    ]);
  });

  it('gives no two families the same CSS family name', () => {
    const names = ALL.map((font) => font.family.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('labels every family, category and licence in Title Case', () => {
    const labels = [
      ...ALL.map((font) => font.label),
      ...Object.values(FONT_CATEGORY_LABELS),
      ...Object.values(FONT_LICENCE_LABELS),
    ];
    expect(labels.filter((label) => !isTitleCase(label))).toEqual([]);
  });

  it('gives every family a fallback that ends in the generic family of its category', () => {
    expect(
      ALL.filter((font) => font.fallback.split(',').at(-1)?.trim() !== GENERIC[font.category]).map(
        (font) => font.id,
      ),
    ).toEqual([]);
  });

  it('quotes a copyright line for every family, on one line', () => {
    expect(
      ALL.filter(
        (font) => !font.copyright.startsWith('Copyright') || /[\r\n]/.test(font.copyright),
      ),
    ).toEqual([]);
  });

  it('ships every family whose name uses a reserved name as the whole upstream file', () => {
    // A subset is a Modified Version, which may not use a Reserved Font Name.
    expect(
      ALL.filter(
        (font) =>
          font.source !== 'upstream-full' &&
          font.reservedNames.some((reserved) => usesName(font.family, reserved)),
      ).map((font) => font.id),
    ).toEqual([]);
    expect(
      ALL.filter((font) => font.source === 'upstream-full').every(
        (font) => font.reservedNames.length > 0,
      ),
    ).toBe(true);
  });

  it('keeps a reserved name in a subset only for DM Serif Display, whose name does not use it', () => {
    // It reserves Adobe's "Source" (the family is built on Source Serif).
    expect(
      ALL.filter((font) => font.reservedNames.length > 0 && font.source === 'google-subset').map(
        (font) => [font.id, font.reservedNames],
      ),
    ).toEqual([['dm-serif-display', ['Source']]]);
  });

  it('records exactly the reserved names the licence and the copyright line declare', () => {
    const problems = ALL.flatMap((font) => {
      const header =
        font.licence === 'OFL-1.1'
          ? licenceText(font.id).split('This Font Software is licensed')[0]
          : '';
      const declared = `${header} ${font.copyright}`;
      const declares =
        /reserved\s+(font\s*)?names?/i.test(declared) && !/no reserved font name/i.test(declared);
      const missing = font.reservedNames.filter((reserved) => !declared.includes(reserved));

      return [
        ...missing.map((reserved) => `${font.id}: "${reserved}" is declared nowhere`),
        ...(declares !== font.reservedNames.length > 0
          ? [`${font.id}: the licence ${declares ? 'reserves' : 'reserves no'} name`]
          : []),
      ];
    });

    expect(problems).toEqual([]);
  });
});

describe('the font files', () => {
  it('exist for every face, one file per face, and nothing else is in the folder', () => {
    const declared = ALL.flatMap((font) => font.faces.map((face) => face.file));
    const onDisk = readdirSync(FONTS_DIR).filter((name) => name.endsWith('.woff2'));

    expect(declared.filter((file) => !existsSync(join(FONTS_DIR, file)))).toEqual([]);
    expect(new Set(declared).size).toBe(declared.length);
    expect([...onDisk].sort()).toEqual([...declared].sort());
    expect(declared).toHaveLength(61);
  });

  it('cover exactly the weights each face declares', () => {
    const problems = ALL.flatMap((font) =>
      font.faces.flatMap((face) => {
        const file = factsOf(face.file);

        if (Array.isArray(face.weight)) {
          const [min, max] = face.weight;
          return file.wght?.[0] === min && file.wght?.[1] === max && min < max
            ? []
            : [`${face.file}: declares ${min} to ${max}, the file's wght axis is ${file.wght}`];
        }

        return file.wght === undefined && file.weightClass === face.weight
          ? []
          : [`${face.file}: declares ${face.weight}, the file is ${file.wght ?? file.weightClass}`];
      }),
    );

    expect(problems).toEqual([]);
  });

  it('carry the copyright notice and designer the table quotes', () => {
    const problems = ALL.flatMap((font) =>
      font.faces.flatMap((face) => {
        const file = factsOf(face.file);
        return [
          ...(file.copyright === font.copyright
            ? []
            : [`${face.file}: copyright "${file.copyright}"`]),
          ...(file.designer === font.designer ? [] : [`${face.file}: designer "${file.designer}"`]),
        ];
      }),
    );

    expect(problems).toEqual([]);
  });

  it('are all upright, as every face is declared', () => {
    expect(ALL.flatMap((font) => font.faces.filter((face) => factsOf(face.file).italic))).toEqual(
      [],
    );
  });

  it('each come with their licence text, and only theirs', () => {
    const texts = readdirSync(join(FONTS_DIR, 'licenses'));

    expect([...texts].sort()).toEqual(FONT_IDS.map((id) => `${id}.txt`).sort());
    expect(
      ALL.filter((font) =>
        font.licence === 'OFL-1.1'
          ? !licenceText(font.id).includes('SIL OPEN FONT LICENSE Version 1.1')
          : !licenceText(font.id).includes('Version 2.0, January 2004'),
      ).map((font) => font.id),
    ).toEqual([]);
  });
});

describe('the picker helpers', () => {
  it('orders the categories as the picker shows them, each with a label', () => {
    expect(FONT_CATEGORIES).toEqual([
      'sans',
      'serif',
      'display',
      'script',
      'handwritten',
      'comic',
      'mono',
    ]);
    expect(FONT_CATEGORIES.map((category) => FONT_CATEGORY_LABELS[category])).toEqual([
      'Sans Serif',
      'Serif',
      'Display',
      'Script',
      'Handwritten',
      'Comic',
      'Monospace',
    ]);
  });

  it('lists every family in exactly one category, alphabetically by label', () => {
    const listed = FONT_CATEGORIES.flatMap((category) => fontsInCategory(category));

    expect(listed.map((font) => font.id).sort()).toEqual([...FONT_IDS].sort());
    expect(FONT_CATEGORIES.filter((category) => fontsInCategory(category).length === 0)).toEqual(
      [],
    );
    expect(fontsInCategory('handwritten').map((font) => font.label)).toEqual([
      'Kalam',
      'Rancho',
      'Sriracha',
    ]);
    expect(fontsInCategory('mono').map((font) => font.id)).toEqual(['jetbrains-mono']);

    for (const category of FONT_CATEGORIES) {
      const fonts = fontsInCategory(category);
      expect(fonts.every((font) => font.category === category)).toBe(true);
      expect(fonts.map((font) => font.label)).toEqual(
        fonts.map((font) => font.label).sort((a, b) => a.localeCompare(b, 'en')),
      );
    }
  });

  it('names a family by its label', () => {
    expect(fontLabel('dm-serif-display')).toBe('DM Serif Display');
    expect(fontLabel('plus-jakarta-sans')).toBe('Plus Jakarta Sans');
  });

  it('builds the CSS stack from the family and its fallback', () => {
    expect(fontStack('inter')).toBe('"Inter", ui-sans-serif, system-ui, sans-serif');
    expect(fontStack('pacifico')).toBe('"Pacifico", "Segoe Script", "Snell Roundhand", cursive');
  });
});

describe('weights', () => {
  it('clamps a variable family into the range its file has', () => {
    expect(resolveWeight('manrope', 820)).toBe(800);
    expect(resolveWeight('manrope', 100)).toBe(200);
    expect(resolveWeight('manrope', 650)).toBe(650);
    expect(resolveWeight('dm-sans', 1000)).toBe(1000);
    expect(resolveWeight('cormorant-garamond', 800)).toBe(700);
  });

  it('snaps a static family to its nearest weight', () => {
    expect(resolveWeight('poppins', 800)).toBe(700);
    expect(resolveWeight('poppins', 560)).toBe(600);
    expect(resolveWeight('kalam', 360)).toBe(400);
    expect(resolveWeight('comic-neue', 200)).toBe(300);
    expect(resolveWeight('sniglet', 700)).toBe(800);
    expect(resolveWeight('bangers', 800)).toBe(400);
  });

  it('keeps every weight a face declares', () => {
    const changed = ALL.flatMap((font) =>
      font.faces
        .flatMap((face) => (Array.isArray(face.weight) ? face.weight : [face.weight]))
        .filter((weight) => resolveWeight(font.id, weight) !== weight)
        .map((weight) => `${font.id} ${weight}`),
    );

    expect(changed).toEqual([]);
  });

  it('declares a range as two numbers and a static cut as one', () => {
    expect(faceWeight({ file: 'sora-var.woff2', weight: [100, 800] })).toBe('100 800');
    expect(faceWeight({ file: 'poppins-600.woff2', weight: 600 })).toBe('600');
  });

  it('lists the files a set of families needs once each', () => {
    expect(filesFor(['poppins', 'inter', 'poppins'])).toEqual([
      'poppins-400.woff2',
      'poppins-600.woff2',
      'poppins-700.woff2',
      'inter-var.woff2',
    ]);
  });
});
