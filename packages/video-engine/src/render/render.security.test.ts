/**
 * Security sweep, "Render" (Sprint 12, Module 20 section 1), the pure half.
 *
 * What must hold: FFmpeg reads only files the plan names, as plain relative
 * names inside its scratch folder (no person's text becomes a path or a
 * protocol); every input is read with a protocol allowlist; the graph and
 * the ASS file are files, never part of an argument; a person's text is
 * escaped for ASS so that no input (braces, backslashes, line breaks,
 * override codes) can become an override or a new line of the file.
 *
 * The executor half (inputs outside the scratch folder, `font_missing`) is
 * in `packages/media-tools/src/render/execute.test.ts`.
 */
import { ASS_FILE, buildAss, escapeAssText } from './ass';
import { compileFfmpeg } from './compile';
import { isRenderCompileError } from './errors';
import { buildRenderPlan, type RenderContext } from './plan';
import {
  TEST_ASSET_ID,
  testBadge,
  testContext,
  testContextWithFonts,
  testDocument,
  testSegment,
  testSource,
  testSticker,
  testStickerAsset,
  testText,
  withItems,
  withTexts,
} from './test-docs';
import { ffmpegArgsFor, GRAPH_FILE, RENDER_INPUT_PROTOCOLS } from './types';

const WORD_JOINER = '\u2060';

/** What a person could type to break out of a caption. */
const HOSTILE_TEXTS = [
  '{\\an8}hi',
  '{\\pos(0,0)\\fs400\\c&H0000FF&}taken over',
  '\\{not a block\\}',
  'a\\Nb\\nc\\hd',
  '}{',
  '{{{{}}}}',
  '\\',
  '\\\\{\\\\}',
  'line one\nline two\r\nline three\rfour',
  'end\n[Events]\nDialogue: 0,0:00:00.00,9:59:59.99,S1,,0,0,0,,{\\fs999}injected',
  'Style: S9,Arial,400,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,0,0,0,1',
  '{\\p1}m 0 0 l 100 0 100 100 0 100{\\p0}',
  '{\\t(\\fscx500)}{\\move(0,0,999,999)}{\\clip(0,0,1,1)}{\\fn../../etc/passwd}',
  'tab\there, comma, , ,',
  'C:\\New\\h folder\\{x}',
];

/**
 * Reads escaped ASS text the way libass does for our escapes, and fails on
 * anything else: an unescaped brace, a backslash that would start a code,
 * or a raw line break. Returns what libass would draw.
 */
function readInert(escaped: string): string {
  let drawn = '';
  const chars = [...escaped];
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i] as string;
    if (char === '\r' || char === '\n') throw new Error(`A raw line break at ${i}`);
    if (char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f) {
      throw new Error(`A control character at ${i}`);
    }
    if (char === '{' || char === '}') throw new Error(`An unescaped brace at ${i}`);
    if (char !== '\\') {
      drawn += char;
      continue;
    }
    const next = chars[i + 1];
    if (next === '{' || next === '}') {
      drawn += next;
    } else if (next === 'N') {
      drawn += '\n';
    } else if (next === WORD_JOINER) {
      drawn += '\\';
    } else {
      throw new Error(`A backslash that starts a code at ${i}: \\${next ?? ''}`);
    }
    i += 1;
  }
  return drawn;
}

/** What the person typed, as it should be drawn: line breaks kept, other control characters gone. */
function expectedDrawing(text: string): string {
  return [...text.replace(/\r\n?/g, '\n')]
    .filter((c) => c === '\n' || (c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f))
    .join('');
}

describe('escapeAssText with hostile input', () => {
  it.each(HOSTILE_TEXTS)('draws %j exactly as typed and opens no override', (text) => {
    const escaped = escapeAssText(text);
    expect(readInert(escaped)).toBe(expectedDrawing(text));
  });

  it('drops NUL and other control characters instead of writing them into the file', () => {
    const escaped = escapeAssText('a\u0000b\u0007c\u001bd\u007fe');
    expect(readInert(escaped)).toBe('abcde');
  });

  it('holds for every pairing of the dangerous characters', () => {
    const pieces = ['{', '}', '\\', 'N', 'h', 'n', '\n', '\r', WORD_JOINER, 'a', ','];
    for (const a of pieces) {
      for (const b of pieces) {
        for (const c of pieces) {
          const text = a + b + c;
          expect(readInert(escapeAssText(text))).toBe(expectedDrawing(text));
        }
      }
    }
  });
});

describe('a hostile text in a real document', () => {
  const texts = HOSTILE_TEXTS.map((text, i) =>
    testText(`t${i}`, { text, start: i * 100, duration: 1_000 }),
  );
  const plan = buildRenderPlan(
    withTexts(testDocument([testSegment('seg', 0, 10_000)]), texts),
    testContextWithFonts(),
  );
  const compiled = compileFfmpeg(plan);
  const args = ffmpegArgsFor(compiled, 'render.mp4.part');
  const [ass] = buildAss(plan);

  it('stays inside its own Dialogue line of the ASS file', () => {
    if (!ass) throw new Error('no ASS file');
    expect(ass.name).toBe(ASS_FILE);
    const lines = ass.content.split('\n');
    // One Dialogue per text, and the three section headers only.
    expect(lines.filter((line) => line.startsWith('Dialogue:'))).toHaveLength(texts.length);
    expect(lines.filter((line) => line.startsWith('['))).toEqual([
      '[Script Info]',
      '[V4+ Styles]',
      '[Events]',
    ]);
    expect(
      lines
        .filter((line) => line.startsWith('Style:'))
        .every((line) => /^Style: S\d+,PGF /.test(line)),
    ).toBe(true);
    for (const line of lines.filter((l) => l.startsWith('Dialogue:'))) {
      // The text is the tenth field; after our one placement block, nothing opens another.
      const field = line.split(',').slice(9).join(',');
      const placement = /^\{[^{}]*\}/.exec(field);
      expect(placement).not.toBeNull();
      let rest = field.slice((placement as RegExpExecArray)[0].length);
      // Our own font switches are `{\fnPGF xxxxxx N00\fsNN\bN00}`; strip them, then nothing is a code.
      rest = rest.replace(/\{\\fnPGF [0-9a-f]{6} [1-9]00\\fs[\d.]+\\b[1-9]00\}/g, '');
      expect(() => readInert(rest)).not.toThrow();
    }
  });

  it('never reaches the argument list or the graph', () => {
    const graph = compiled.filterComplexScript;
    for (const text of HOSTILE_TEXTS) {
      const marker = text.replace(/[^A-Za-z]/g, '');
      if (marker.length < 6) continue;
      expect(args.join('\n')).not.toContain(marker);
      expect(graph).not.toContain(marker);
    }
    // The graph names the caption file by its fixed name only.
    expect(graph).toContain(`ass=filename=${ASS_FILE}:fontsdir=fonts`);
    expect(args[args.indexOf('-/filter_complex') + 1]).toBe(GRAPH_FILE);
    expect(args).not.toContain('-filter_complex');
    expect(args).not.toContain('-vf');
    expect(args).not.toContain('-af');
  });
});

describe('a hostile Follow Badge name', () => {
  // The schema refuses control characters and emoji in a name; braces and backslashes are allowed.
  const names = ['{\\an8}x', '{\\p1}m 0 0 l 9 0', '\\N[Events]', '}{\\fs999}', 'a\\\\b{c}'];
  const badges = names.map((name, i) =>
    testBadge(`b${i}`, { ref: { badge: 'twitch', name }, start: i * 100, duration: 1_000 }),
  );
  const plan = buildRenderPlan(
    withItems(testDocument([testSegment('seg', 0, 10_000)]), badges),
    testContextWithFonts(),
  );
  const [ass] = buildAss(plan);

  it('is drawn as plain text inside its own Dialogue lines', () => {
    if (!ass) throw new Error('no ASS file');
    const lines = ass.content.split('\n');
    expect(lines.filter((line) => line.startsWith('['))).toEqual([
      '[Script Info]',
      '[V4+ Styles]',
      '[Events]',
    ]);
    const dialogues = lines.filter((line) => line.startsWith('Dialogue:'));
    expect(dialogues.length).toBeGreaterThanOrEqual(names.length);
    let drawn = '';
    for (const line of dialogues) {
      const field = line.split(',').slice(9).join(',');
      const placement = /^\{[^{}]*\}/.exec(field);
      expect(placement).not.toBeNull();
      let rest = field.slice((placement as RegExpExecArray)[0].length);
      rest = rest.replace(/\{\\fnPGF [0-9a-f]{6} [1-9]00\\fs[\d.]+\\b[1-9]00\}/g, '');
      // A badge's own shapes: our placement block turns drawing on (`\p1`), then only path numbers follow.
      if ((placement as RegExpExecArray)[0].includes('\\p1}')) {
        expect(rest).toMatch(/^[mlb\d\s.-]+\{\\p0\}$/);
        continue;
      }
      expect(() => readInert(rest)).not.toThrow();
      drawn += `${readInert(rest)}\n`;
    }
    for (const name of names) expect(drawn).toContain(name);
  });
});

describe('every input FFmpeg reads', () => {
  function inputsOf(args: readonly string[]): Array<{ file: string; protocols: string | null }> {
    const found: Array<{ file: string; protocols: string | null }> = [];
    let since = 0;
    args.forEach((arg, i) => {
      if (arg !== '-i') return;
      const options = args.slice(since, i);
      const at = options.lastIndexOf('-protocol_whitelist');
      found.push({
        file: args[i + 1] as string,
        protocols: at === -1 ? null : (options[at + 1] as string),
      });
      since = i + 2;
    });
    return found;
  }

  const ctx: RenderContext = (() => {
    const base = testContextWithFonts({ quality: '720p', watermark: true });
    return {
      ...base,
      assets: {
        ...base.assets,
        stickers: { [`asset:${TEST_ASSET_ID}`]: testStickerAsset() },
        watermark: { file: 'watermark.png', width: 600, height: 150 },
      },
    };
  })();
  const doc = withItems(
    testDocument([testSegment('a', 0, 4_000), testSegment('b', 30_000, 34_000)]),
    [testSticker('s1')],
  );

  it('is a plain file read with only the file protocol: video, sticker and mark', () => {
    const compiled = compileFfmpeg(buildRenderPlan(doc, ctx));
    const inputs = inputsOf(ffmpegArgsFor(compiled, 'render.mp4.part'));
    expect(inputs.map((input) => input.file)).toEqual(
      expect.arrayContaining(['source.mp4', 'sticker-0.png', 'watermark.png']),
    );
    expect(RENDER_INPUT_PROTOCOLS).toBe('file');
    for (const input of inputs) {
      expect(input.protocols).toBe('file');
      expect(input.file).toMatch(/^[A-Za-z0-9_][A-Za-z0-9._/-]*$/);
    }
  });

  it('refuses a file name that is a path out, a protocol, a list or a flag', () => {
    const hostile = [
      '../source.mp4',
      '/etc/passwd',
      'C:/Windows/win.ini',
      'concat:a.mp4|b.mp4',
      'http://127.0.0.1:9/x.mp4',
      'file:source.mp4',
      'subfile,,start,0,end,0,,:source.mp4',
      '-i',
      '-protocol_whitelist',
      'a/../../b.mp4',
      'source.mp4\nsecond',
      "it's.mp4",
      'pipe:0',
    ];
    for (const file of hostile) {
      const asSource = testContext({ assets: { sources: { src: testSource({ file }) } } });
      const asSticker = {
        ...ctx,
        assets: {
          ...ctx.assets,
          stickers: { [`asset:${TEST_ASSET_ID}`]: testStickerAsset({ file }) },
        },
      };
      for (const context of [asSource, asSticker]) {
        let refused = false;
        try {
          buildRenderPlan(doc, context);
        } catch (error) {
          refused = isRenderCompileError(error);
        }
        expect({ file, refused }).toEqual({ file, refused: true });
      }
    }
  });
});
