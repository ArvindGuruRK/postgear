/**
 * `buildAss(plan)`: the ASS subtitle files a render draws text from.
 *
 * Module 05 renders no text yet (the plan refuses text items), so `buildAss`
 * returns no files. What is already here, and already right, is the part that
 * is easy to get subtly wrong later: escaping a person's text so it can never
 * become an ASS override, colours in ASS's `&HAABBGGRR` order, and times in
 * `H:MM:SS.CC`. Module 11 adds the header, the styles and one `Dialogue` per
 * text item (cookbook section 6: `PlayRes` equal to the canvas, `\an`, `\pos`,
 * `\frz-ROT`, `\fad`, margins as the text box).
 */
import type { RenderPlan } from './plan';

/** One ASS file the executor writes beside the graph, by relative name. */
export interface AssFile {
  name: string;
  content: string;
}

/** The text file's name inside the scratch folder (`ass=captions.ass:fontsdir=fonts`). */
export const ASS_FILE = 'captions.ass';

/** U+2060 WORD JOINER: invisible, and breaks a backslash away from the letter after it. */
const WORD_JOINER = '⁠';

/**
 * A person's text as the last field of an ASS `Dialogue` line, drawn exactly
 * as typed.
 *
 * - `{` and `}` would open and close an override block: written `\{` and `\}`,
 *   which libass draws as the plain braces.
 * - A backslash would start `\N`, `\n` or `\h` (a line break or a hard space):
 *   a word joiner goes after it, so libass draws the backslash itself.
 * - A typed line break becomes `\N`, the ASS line break; a carriage return and
 *   any other control character is dropped, so the text stays on one line of
 *   the file. Commas need nothing: the text is the last field.
 *
 * Verified on FFmpeg 9.0.2 (2026-11-18): `a\{b\}c` drew as `a{b}c`, and a
 * backslash with the word joiner after it drew `C:\New\h` as typed.
 */
export function escapeAssText(text: string): string {
  let out = '';
  const normalised = text.replace(/\r\n?/g, '\n');
  for (const char of normalised) {
    if (char === '\\') {
      out += `\\${WORD_JOINER}`;
    } else if (char === '{') {
      out += '\\{';
    } else if (char === '}') {
      out += '\\}';
    } else if (char === '\n') {
      out += '\\N';
    } else if (char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f) {
      // Tabs and other control characters have no meaning in a caption.
    } else {
      out += char;
    }
  }
  return out;
}

/**
 * `#RRGGBB` and an opacity (0 to 1) as an ASS colour, `&HAABBGGRR`: blue,
 * green, red order, and alpha 00 opaque, FF transparent.
 */
export function assColour(hex: string, opacity = 1): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`A colour is #RRGGBB, not ${hex}`);
  }
  const clamped = Math.min(1, Math.max(0, Number.isFinite(opacity) ? opacity : 1));
  const alpha = Math.round((1 - clamped) * 255);
  const red = hex.slice(1, 3);
  const green = hex.slice(3, 5);
  const blue = hex.slice(5, 7);
  const two = (value: number): string => value.toString(16).toUpperCase().padStart(2, '0');
  return `&H${two(alpha)}${blue}${green}${red}`.toUpperCase();
}

/** Milliseconds as an ASS time, `H:MM:SS.CC` (centiseconds, rounded). */
export function assTime(ms: number): string {
  const centis = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 10));
  const hours = Math.floor(centis / 360_000);
  const minutes = Math.floor((centis % 360_000) / 6_000);
  const seconds = Math.floor((centis % 6_000) / 100);
  const cs = centis % 100;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${hours}:${pad(minutes)}:${pad(seconds)}.${pad(cs)}`;
}

/**
 * The ASS files for a plan. None until Module 11: the plan refuses text, so a
 * plan that reaches here has nothing to draw.
 */
export function buildAss(plan: RenderPlan): AssFile[] {
  if (plan.fonts.families.length === 0) {
    return [];
  }
  // A plan with text cannot be built yet (`text_unsupported`); keep the stub honest if one appears.
  throw new Error('Text rendering arrives in Module 11');
}
