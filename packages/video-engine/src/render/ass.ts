/**
 * `buildAss(plan)`: the ASS subtitle file a render draws text from (Module
 * 11), burned in by one `ass=captions.ass:fontsdir=fonts` filter. Sprint 13's
 * captions are written into the same file.
 *
 * Also here, and easy to get subtly wrong: escaping a person's text so it
 * can never become an ASS override, colours in ASS's `&HAABBGGRR` order, and
 * times in `H:MM:SS.CC`.
 */
import { TEXT_SHADOW } from '../document/text';
import { CAPTION_LAYER, captionDialogues, captionStyleFields } from './caption-ass';
import { cardsOf } from './card-plan';
import type { RenderPlan } from './plan';
import type { PlanShape, PlanText, PlanTextRun } from './text-plan';

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

/** A number for an ASS file: at most two decimals, no trailing zeros. */
export function assNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot write ${String(value)} into an ASS file`);
  }
  const fixed = (Math.round(value * 100) / 100).toFixed(2);
  const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '-0' ? '0' : trimmed;
}

/** An opacity (0 to 1) as an ASS alpha override value, `&HXX&`: 00 opaque, FF transparent. */
export function assAlpha(opacity: number): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(opacity) ? opacity : 1));
  const alpha = Math.round((1 - clamped) * 255);
  return `&H${alpha.toString(16).toUpperCase().padStart(2, '0')}&`;
}

/** An ASS `Bold` value: 0 for 400, otherwise the weight itself (libass reads 1 and -1 as 700). */
export function assWeight(weight: number): string {
  return weight === 400 ? '0' : String(weight);
}

/** `#RRGGBB` as an ASS colour override value, `&HBBGGRR&` (the alpha is set apart, with `\1a`). */
export function assColourTag(hex: string): string {
  const full = assColour(hex);
  return `&H${full.slice(4)}&`;
}

/** Bezier handle length for a quarter circle: 4/3 x (sqrt 2 - 1). */
const KAPPA = 0.5522847498;

/**
 * An ASS drawing (`\p1`) of a rectangle `width` by `height` with round
 * corners of `radius`, from (0, 0) to (width, height): a circle when the
 * radius is half of a square's side. Its bounding box starts at the origin,
 * so `\an7` puts its top left at `\pos`.
 */
export function roundRectDrawing(width: number, height: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const k = r * KAPPA;
  const n = assNumber;
  const w = width;
  const h = height;
  return [
    `m ${n(r)} 0`,
    `l ${n(w - r)} 0`,
    `b ${n(w - r + k)} 0 ${n(w)} ${n(r - k)} ${n(w)} ${n(r)}`,
    `l ${n(w)} ${n(h - r)}`,
    `b ${n(w)} ${n(h - r + k)} ${n(w - r + k)} ${n(h)} ${n(w - r)} ${n(h)}`,
    `l ${n(r)} ${n(h)}`,
    `b ${n(r - k)} ${n(h)} 0 ${n(h - r + k)} 0 ${n(h - r)}`,
    `l 0 ${n(r)}`,
    `b 0 ${n(r - k)} ${n(r - k)} 0 ${n(r)} 0`,
  ].join(' ');
}

/** An ASS drawing of a triangle pointing right, filling `width` by `height` from the origin. */
export function playMarkDrawing(width: number, height: number): string {
  return `m 0 0 l ${assNumber(width)} ${assNumber(height / 2)} l 0 ${assNumber(height)}`;
}

/** The ASS alignment for a text box, all vertically centred: `\an4`, `\an5` or `\an6`. */
export function assAlignment(align: PlanText['align']): number {
  return align === 'left' ? 4 : align === 'right' ? 6 : 5;
}

const STYLE_FORMAT =
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, ' +
  'Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, ' +
  'Shadow, Alignment, MarginL, MarginR, MarginV, Encoding';

const EVENT_FORMAT =
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text';

/** One `Style:` line's fields after the name, for a text. Texts with the same fields share a style. */
function styleFields(text: PlanText): string {
  const { backing } = text;
  const outlineColour =
    backing.kind === 'outline'
      ? assColour(backing.colour)
      : backing.kind === 'box'
        ? assColour(backing.colour, backing.opacity)
        : assColour('#000000');
  const borderStyle = backing.kind === 'box' ? 3 : 1;
  const outline =
    backing.kind === 'outline' ? backing.width : backing.kind === 'box' ? backing.pad : 0;
  const shadow = text.shadow ? text.geometry.shadowPx : 0;
  return [
    text.main.assName,
    assNumber(text.main.fontSize),
    assColour(text.colour),
    assColour(text.colour),
    outlineColour,
    assColour(TEXT_SHADOW.colour, TEXT_SHADOW.opacity),
    assWeight(text.main.weight),
    text.italic ? '-1' : '0',
    '0',
    '0',
    '100',
    '100',
    '0',
    '0',
    String(borderStyle),
    assNumber(outline),
    assNumber(shadow),
    String(assAlignment(text.align)),
    '0',
    '0',
    '0',
    '1',
  ].join(',');
}

/** The override that switches a run to its font, written only when the font changes. */
function fontSwitch(run: PlanTextRun): string {
  return `{\\fn${run.assName}\\fs${assNumber(run.fontSize)}\\b${assWeight(run.weight)}}`;
}

/** The `Text` field of one text: the placement block, then the runs with their font switches. */
function dialogueText(
  text: PlanText,
  canvasWidth: number,
): { text: string; marginL: number; marginR: number } {
  const g = text.geometry;
  const anchorX =
    text.align === 'left' ? g.boxLeft : text.align === 'right' ? g.boxLeft + g.boxWidth : g.cx;
  const tags = [
    `\\an${assAlignment(text.align)}`,
    `\\pos(${assNumber(anchorX)},${assNumber(g.cy)})`,
    // The turn is about the item's centre whatever the alignment (CSS rotates the box about its centre).
    `\\org(${assNumber(g.cx)},${assNumber(g.cy)})`,
  ];
  if (text.rotationDeg !== 0) {
    // ASS turns counter-clockwise; the document's rotation is clockwise.
    tags.push(`\\frz${assNumber(-text.rotationDeg)}`);
  }
  if (text.fadeInMs > 0 || text.fadeOutMs > 0) {
    tags.push(`\\fad(${Math.round(text.fadeInMs)},${Math.round(text.fadeOutMs)})`);
  }
  if (text.opacity < 1) {
    // Per layer, never one `\alpha`: that would replace the box's own opacity instead of multiplying it.
    const opacity = Math.max(0, text.opacity);
    const backing = text.backing.kind === 'box' ? text.backing.opacity : 1;
    tags.push(
      `\\1a${assAlpha(opacity)}`,
      `\\3a${assAlpha(opacity * backing)}`,
      `\\4a${assAlpha(opacity * TEXT_SHADOW.opacity)}`,
    );
  }

  let body = `{${tags.join('')}}`;
  let current: PlanTextRun = text.main;
  for (const run of text.runs) {
    const same =
      run.assName === current.assName &&
      run.fontSize === current.fontSize &&
      run.weight === current.weight;
    if (!same) {
      body += fontSwitch(run);
      current = run;
    }
    body += escapeAssText(run.text);
  }

  // The box is the event's margins: libass wraps inside them even with `\pos`.
  const marginL = Math.round(g.boxLeft);
  const marginR = Math.round(canvasWidth - g.boxLeft - g.boxWidth);
  return { text: body, marginL, marginR };
}

/** The `Text` field of one shape: placed by its top left, turned about its centre, filled flat. */
function shapeText(shape: PlanShape): string {
  const left = shape.cx - shape.width / 2;
  const top = shape.cy - shape.height / 2;
  const tags = [
    '\\an7',
    `\\pos(${assNumber(left)},${assNumber(top)})`,
    `\\org(${assNumber(shape.cx)},${assNumber(shape.cy)})`,
  ];
  if (shape.rotationDeg !== 0) {
    tags.push(`\\frz${assNumber(-shape.rotationDeg)}`);
  }
  tags.push(
    '\\bord0',
    '\\shad0',
    `\\1c${assColourTag(shape.colour)}`,
    `\\1a${assAlpha(shape.opacity)}`,
    '\\p1',
  );
  const drawing =
    shape.kind === 'mark'
      ? playMarkDrawing(shape.width, shape.height)
      : roundRectDrawing(shape.width, shape.height, shape.radius);
  return `{${tags.join('')}}${drawing}{\\p0}`;
}

/** The style shapes are drawn with: no outline, no shadow (a drawing never uses its font). */
function shapeStyle(fontName: string): string {
  return [
    fontName,
    '20',
    assColour('#FFFFFF'),
    assColour('#FFFFFF'),
    assColour('#000000'),
    assColour('#000000'),
    '0',
    '0',
    '0',
    '0',
    '100',
    '100',
    '0',
    '0',
    '1',
    '0',
    '0',
    '7',
    '0',
    '0',
    '0',
    '1',
  ].join(',');
}

/**
 * The ASS file for a plan's texts and Follow Badge shapes (cookbook section
 * 6), or no file when the clip has neither. One `Style` per distinct look, one `Dialogue` per text:
 *
 * - `PlayResX` and `PlayResY` are the document canvas, so every number is a
 *   canvas pixel and a 720p export uses the same file (libass scales it);
 *   `WrapStyle: 0` balances the lines; `ScaledBorderAndShadow: yes` scales
 *   outlines and shadows with it; `YCbCr Matrix: None` keeps colours as set.
 * - The box width is the event's margins, and `\pos` sits at the anchor
 *   inside the box (`\an4`, `\an5`, `\an6`: left, centre, right, all
 *   vertically centred); `\org` at the item's centre and `\frz` minus the
 *   clockwise rotation turn it like CSS.
 * - Times are absolute starts and ends rounded to centiseconds, never
 *   durations, so two texts never drift apart.
 * - Outline is `BorderStyle 1`; Box is `BorderStyle 3` with the box colour as
 *   `OutlineColour` (its alpha the box's opacity) and the padding as
 *   `Outline`; the shadow is the style's `Shadow` and `BackColour`.
 */
export function buildAss(plan: RenderPlan): AssFile[] {
  const main = mainAss(plan);
  // Module 10: each card with a line has its own small file, on the card's own clock.
  const cards = cardsOf(plan.cards).flatMap((card) =>
    card.text && card.assFile
      ? [{ name: card.assFile, content: cardAss(card.text, plan.canvas) }]
      : [],
  );
  return main ? [main, ...cards] : cards;
}

/** A card's line as its own ASS file: the same writer as the clip's texts, one style, one event. */
export function cardAss(text: PlanText, canvas: { width: number; height: number }): string {
  const line = dialogueText(text, canvas.width);
  return assContent(
    canvas,
    [`Style: S1,${styleFields(text)}`],
    [
      `Dialogue: 0,${assTime(text.startMs)},${assTime(text.endMs)},S1,,` +
        `${line.marginL},${line.marginR},0,,${line.text}`,
    ],
  );
}

/** The whole text of an ASS file from its style and event lines. */
function assContent(
  canvas: { width: number; height: number },
  styles: string[],
  events: string[],
): string {
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${canvas.width}`,
    `PlayResY: ${canvas.height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: None',
    '',
    '[V4+ Styles]',
    STYLE_FORMAT,
    ...styles,
    '',
    '[Events]',
    EVENT_FORMAT,
    ...events,
    '',
  ].join('\n');
}

/** The clip's own file (`captions.ass`): its texts, badges and captions, or null when it has none. */
function mainAss(plan: RenderPlan): AssFile | null {
  const shapes = plan.shapes ?? [];
  const captions = plan.captions ?? null;
  if (plan.texts.length === 0 && shapes.length === 0 && !captions) {
    return null;
  }
  const styles = new Map<string, string>();
  const lines: Array<{ layer: number; order: number; line: string }> = [];
  if (captions) {
    // Captions first and lowest: a text or badge a person placed is drawn over them.
    const fields = captionStyleFields(captions);
    const name = `S${styles.size + 1}`;
    styles.set(fields, name);
    for (const line of captionDialogues(captions, name, plan.canvas.width)) {
      lines.push({ layer: CAPTION_LAYER, order: lines.length, line });
    }
  }
  const ordered = [...plan.texts].sort((a, b) => a.layer - b.layer);
  for (const text of ordered) {
    const fields = styleFields(text);
    let name = styles.get(fields);
    if (!name) {
      name = `S${styles.size + 1}`;
      styles.set(fields, name);
    }
    const line = dialogueText(text, plan.canvas.width);
    lines.push({
      layer: text.layer,
      order: lines.length,
      line:
        `Dialogue: ${text.layer},${assTime(text.startMs)},${assTime(text.endMs)},${name},,` +
        `${line.marginL},${line.marginR},0,,${line.text}`,
    });
  }
  if (shapes.length > 0) {
    // A drawing never selects a font, but its style still names one the render has (the badge's own).
    const fields = shapeStyle(ordered[0]?.main.assName ?? 'Sans');
    let name = styles.get(fields);
    if (!name) {
      name = `S${styles.size + 1}`;
      styles.set(fields, name);
    }
    for (const shape of shapes) {
      lines.push({
        layer: shape.layer,
        order: lines.length,
        line: `Dialogue: ${shape.layer},${assTime(shape.startMs)},${assTime(shape.endMs)},${name},,0,0,0,,${shapeText(shape)}`,
      });
    }
  }
  // Bottom first, so the file's order and the layers agree.
  const events = lines
    .sort((a, b) => a.layer - b.layer || a.order - b.order)
    .map((entry) => entry.line);

  const content = assContent(
    plan.canvas,
    [...styles.entries()].map(([fields, name]) => `Style: ${name},${fields}`),
    events,
  );
  return { name: ASS_FILE, content };
}
