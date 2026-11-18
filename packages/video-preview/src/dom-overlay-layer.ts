/**
 * The overlay layer that draws text (Module 11) and stickers (Module 12) as
 * DOM above the picture, from the same `frameState` and the same numbers
 * the export is made from (`textGeometry`, `resolveTextFont`, `textFadeAt`
 * through the state's opacity, `stickerFrameAt`, `badgeLayout`).
 *
 * ```
 * host (the stage's overlay element, the size of the stage on screen)
 *   canvas box     canvas pixels (1080 wide), scaled to the stage by one transform
 *     sticker      one per picture sticker: an <img>, or a <canvas> for a moving one
 *     badge parts  a Follow Badge's pill, disc and play mark
 *     text         one per item (and a badge's two lines): the wrapping box, turned about its centre
 *       words      the words, in the item's font, size, colour and backing
 * ```
 *
 * Stacking follows the export: every picture sticker is an overlay drawn
 * before the text layer, so pictures sit under all texts (bottom first, in
 * track order, at negative z-indices); texts and badges are the ASS layers,
 * in track order above them. `sticker-nodes.ts` has how a sticker is drawn.
 *
 * - Everything is laid out in canvas pixels, so a size means what it means
 *   in the export at every stage size.
 * - The weight is the one the export draws (the nearest the font has), and
 *   `line-height` is the font's own ascent plus descent, so lines are spaced
 *   as libass spaces them.
 * - Outline: `-webkit-text-stroke` is centred on the glyph edge while ASS
 *   grows outward, so the stroke is twice the width, painted under the fill.
 *   Box: an inline background with the padding, cloned on every line. Shadow:
 *   the same offset with no blur.
 * - A text waits for its font (`document.fonts.load`) before it shows, so
 *   the stage never flashes another face.
 * - The known differences (line breaks may fall on another word, outlines
 *   differ by a pixel or two) are why Preview Export exists.
 *
 * Cheap per frame: a node is restyled only when its item or opacity changed.
 */
import {
  type BadgeLayout,
  badgeLayout,
  displayText,
  FONT_MANIFEST,
  type FontManifest,
  type FrameState,
  lineHeightEm,
  type OverlayState,
  resolveTextFont,
  type StickerItem,
  stickerRefKey,
  TEXT_SHADOW,
  type TextItem,
  textGeometry,
} from '@postgear/video-engine';
import {
  BadgeShapesNode,
  imageDecoderFrames,
  PictureStickerNode,
  type StickerFrames,
  type StickerFramesLoader,
  type StickerPicture,
} from './sticker-nodes';
import type { LayerUpdate, OverlayLayer } from './types';

export interface DomOverlayLayerOptions {
  /** The fonts the export has: the weights and line heights the text is drawn with. */
  manifest?: FontManifest;
  /** The CSS `font-family` for a family name (the web app adds its fallbacks). */
  fontFamily?: (family: string) => string;
  /** Called with each text's height in canvas pixels whenever one changes (the handles read it). */
  onMeasure?: (heights: ReadonlyMap<string, number>) => void;
  /** Decodes a moving sticker's frames (`ImageDecoder` by default; tests pass a fake). */
  loadFrames?: StickerFramesLoader;
}

/** A Follow Badge's layout, kept while its item, opacity and the canvas stay the same. */
interface BadgeMemo {
  item: StickerItem;
  opacity: number;
  canvasWidth: number;
  canvasHeight: number;
  layout: BadgeLayout;
}

interface TextNode {
  box: HTMLDivElement;
  words: HTMLSpanElement;
  item: TextItem | null;
  opacity: number;
  /** Null until first drawn. */
  hidden: boolean | null;
  fontKey: string;
}

function hexToRgba(hex: string, opacity: number): string {
  const value = /^#([0-9a-fA-F]{6})$/.exec(hex)?.[1] ?? '000000';
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, opacity))})`;
}

function defaultFontFamily(family: string): string {
  return `"${family.replace(/"/g, '')}", sans-serif`;
}

/** The weight the export draws a text at: the nearest the font has. */
function drawnWeight(manifest: FontManifest, item: TextItem): number {
  return resolveTextFont(manifest, item.style.font, item.style.weight)?.weight ?? item.style.weight;
}

/** CSS for one text, as property names and values (an empty value removes the property). */
export interface TextCss {
  /** The wrapping box: place, width, turn, font and alignment. */
  box: Record<string, string>;
  /** The words inside it: the backing (outline, box) and the shadow. */
  words: Record<string, string>;
}

/**
 * The CSS that draws a text like its ASS line, in canvas pixels. Pure, so
 * the editor's in-place typing box uses the same numbers as the layer.
 */
export function textCss(
  item: TextItem,
  canvas: { width: number; height: number },
  manifest: FontManifest = FONT_MANIFEST,
  fontFamily: (family: string) => string = defaultFontFamily,
): TextCss {
  const g = textGeometry(item, canvas);
  const { style } = item;
  const font = resolveTextFont(manifest, style.font, style.weight);
  const shadow = style.shadow
    ? `${g.shadowPx}px ${g.shadowPx}px 0 ${hexToRgba(TEXT_SHADOW.colour, TEXT_SHADOW.opacity)}`
    : '';
  const box: Record<string, string> = {
    left: `${g.boxLeft}px`,
    top: `${g.cy}px`,
    width: `${g.boxWidth}px`,
    transform: `translateY(-50%) rotate(${item.transform.rotation}deg)`,
    'text-align': style.align,
    'font-family': fontFamily(style.font),
    'font-size': `${g.sizePx}px`,
    'font-weight': String(font?.weight ?? style.weight),
    'font-style': style.italic ? 'italic' : 'normal',
    'line-height': String(font ? lineHeightEm(font) : 1.2),
    color: style.colour,
  };
  const words: Record<string, string> = {
    '-webkit-text-stroke': '',
    'paint-order': '',
    background: '',
    padding: '',
    'box-shadow': '',
    'text-shadow': shadow,
  };
  if (style.outline) {
    // ASS grows the outline outward; a CSS stroke is centred on the edge, so twice as wide, under the fill.
    words['-webkit-text-stroke'] = `${g.backingPx * 2}px ${style.outline.colour}`;
    words['paint-order'] = 'stroke fill';
  } else if (style.background) {
    words.background = hexToRgba(style.background.colour, style.background.opacity);
    words.padding = `${g.backingPx}px`;
    words['box-shadow'] = shadow;
    words['text-shadow'] = '';
  }
  return { box, words };
}

export class DomOverlayLayer implements OverlayLayer {
  private host: HTMLElement | null = null;
  private canvasBox: HTMLDivElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly nodes = new Map<string, TextNode>();
  private readonly heights = new Map<string, number>();
  private readonly loadedFonts = new Set<string>();
  private readonly loadingFonts = new Set<string>();
  private hiddenId: string | null = null;
  private canvas = { width: 0, height: 0 };
  private lastState: FrameState | null = null;
  private readonly manifest: FontManifest;
  private readonly fontFamily: (family: string) => string;
  private readonly onMeasure: ((heights: ReadonlyMap<string, number>) => void) | undefined;
  private readonly loadFrames: StickerFramesLoader;
  private readonly pictureNodes = new Map<string, PictureStickerNode>();
  private readonly badgeNodes = new Map<string, BadgeShapesNode>();
  private readonly badgeMemos = new Map<string, BadgeMemo>();
  private pictures: ReadonlyMap<string, StickerPicture> = new Map();
  /** Decoded moving pictures by address: null when this browser cannot decode one. */
  private readonly frames = new Map<string, StickerFrames | null>();
  private readonly loadingFrames = new Set<string>();

  constructor(options: DomOverlayLayerOptions = {}) {
    this.manifest = options.manifest ?? FONT_MANIFEST;
    this.fontFamily = options.fontFamily ?? defaultFontFamily;
    this.onMeasure = options.onMeasure;
    this.loadFrames = options.loadFrames ?? imageDecoderFrames;
  }

  mount(host: HTMLElement): void {
    this.host = host;
    const doc = host.ownerDocument;
    const box = doc.createElement('div');
    box.dataset.previewLayer = 'canvas-box';
    box.style.position = 'absolute';
    box.style.left = '0';
    box.style.top = '0';
    box.style.transformOrigin = '0 0';
    box.style.pointerEvents = 'none';
    host.appendChild(box);
    this.canvasBox = box;
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.fitToHost());
      this.resizeObserver.observe(host);
    }
  }

  /** The text being typed in place is drawn by the editing box instead. */
  setHidden(itemId: string | null): void {
    if (this.hiddenId === itemId) return;
    this.hiddenId = itemId;
    if (this.lastState) this.draw(this.lastState, true);
  }

  /**
   * The sticker files the clip uses, by `stickerRefKey` (`library:<id>`,
   * `asset:<id>`). A sticker whose file is not here draws nothing.
   */
  setStickerPictures(pictures: ReadonlyMap<string, StickerPicture>): void {
    if (this.pictures === pictures) return;
    this.pictures = pictures;
    if (this.lastState) this.draw(this.lastState, true);
  }

  update(state: FrameState, _update: LayerUpdate): void {
    this.lastState = state;
    this.draw(state, false);
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const node of this.pictureNodes.values()) node.remove();
    this.pictureNodes.clear();
    for (const node of this.badgeNodes.values()) node.remove();
    this.badgeNodes.clear();
    this.badgeMemos.clear();
    for (const frames of this.frames.values()) frames?.close();
    this.frames.clear();
    this.loadingFrames.clear();
    this.canvasBox?.remove();
    this.canvasBox = null;
    this.nodes.clear();
    this.heights.clear();
    this.host = null;
    this.lastState = null;
  }

  /** Each visible text's height in canvas pixels, as last measured. */
  get measured(): ReadonlyMap<string, number> {
    return this.heights;
  }

  private fitToHost(): void {
    const host = this.host;
    const box = this.canvasBox;
    if (!host || !box || this.canvas.width <= 0) return;
    const scale = host.clientWidth / this.canvas.width;
    box.style.transform = `scale(${Number.isFinite(scale) && scale > 0 ? scale : 1})`;
  }

  private draw(state: FrameState, force: boolean): void {
    const box = this.canvasBox;
    if (!box) return;
    if (state.canvas.width !== this.canvas.width || state.canvas.height !== this.canvas.height) {
      this.canvas = { width: state.canvas.width, height: state.canvas.height };
      box.style.width = `${this.canvas.width}px`;
      box.style.height = `${this.canvas.height}px`;
      this.fitToHost();
      force = true;
    }

    /** Text nodes on screen (items and badge lines). */
    const seen = new Set<string>();
    /** The items' own texts, which the handles measure (not a badge's lines). */
    const seenTexts = new Set<string>();
    const changed = new Set<string>();
    const seenPictures = new Set<string>();
    const seenBadges = new Set<string>();
    const pictureCount = state.overlays.filter(
      (overlay) => overlay.item.type === 'sticker' && !('badge' in overlay.item.ref),
    ).length;
    let pictureOrder = 0;
    // Texts and badges in track order, as the ASS layers are.
    let order = 0;
    const placeText = (node: TextNode) => {
      const z = String(order);
      if (node.box.style.zIndex !== z) node.box.style.zIndex = z;
      order += 1;
    };
    // The clip's fade is the stage's: one opacity over the finished frame, as the export
    // fades after the overlays (Module 13). Each item carries only its own opacity here.
    for (const overlay of state.overlays) {
      const item = overlay.item;
      if (item.type === 'text') {
        seen.add(overlay.id);
        seenTexts.add(overlay.id);
        const node = this.nodeFor(overlay.id);
        placeText(node);
        if (this.drawText(node, overlay, force)) changed.add(overlay.id);
      } else if ('badge' in item.ref) {
        seenBadges.add(overlay.id);
        const layout = this.badgeFor(item, overlay.opacity);
        let shapes = this.badgeNodes.get(overlay.id);
        if (!shapes) {
          shapes = new BadgeShapesNode(box.ownerDocument, box, overlay.id);
          this.badgeNodes.set(overlay.id, shapes);
        }
        order = shapes.update(layout.shapes, order);
        for (const line of layout.texts) {
          seen.add(line.id);
          const node = this.nodeFor(line.id);
          placeText(node);
          // The line's opacity already holds the badge's own fade.
          const lineState = {
            ...overlay,
            id: line.id,
            type: 'text' as const,
            item: line,
            opacity: line.transform.opacity,
          };
          this.drawText(node, lineState, force);
        }
      } else {
        seenPictures.add(overlay.id);
        const node = this.pictureNodeFor(overlay.id);
        const key = stickerRefKey(item.ref);
        const picture = (key && this.pictures.get(key)) || null;
        const frames = picture?.animated ? this.framesFor(picture.fileUrl) : null;
        node.update(
          overlay,
          picture,
          frames,
          overlay.opacity,
          this.canvas,
          force,
        );
        // Under every text, bottom first.
        const z = String(pictureOrder - pictureCount);
        if (node.box.style.zIndex !== z) node.box.style.zIndex = z;
        pictureOrder += 1;
      }
    }
    // Anything off screen loses its node; it is made again when it shows.
    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) {
        node.box.remove();
        this.nodes.delete(id);
      }
    }
    for (const [id, node] of this.pictureNodes) {
      if (!seenPictures.has(id)) {
        node.remove();
        this.pictureNodes.delete(id);
      }
    }
    for (const [id, node] of this.badgeNodes) {
      if (!seenBadges.has(id)) {
        node.remove();
        this.badgeNodes.delete(id);
        this.badgeMemos.delete(id);
      }
    }
    this.measure(seenTexts, changed);
  }

  /** The picture sticker node on screen, for tests (null when the item is not showing). */
  stickerNode(id: string): PictureStickerNode | null {
    return this.pictureNodes.get(id) ?? null;
  }

  private pictureNodeFor(id: string): PictureStickerNode {
    const existing = this.pictureNodes.get(id);
    if (existing) return existing;
    const box = this.canvasBox as HTMLDivElement;
    const node = new PictureStickerNode(box.ownerDocument, id);
    box.appendChild(node.box);
    this.pictureNodes.set(id, node);
    return node;
  }

  /** The badge's shapes and lines, worked out again only when it changed (so its lines are not restyled every frame). */
  private badgeFor(item: StickerItem, opacity: number): BadgeLayout {
    const memo = this.badgeMemos.get(item.id);
    if (
      memo &&
      memo.item === item &&
      memo.opacity === opacity &&
      memo.canvasWidth === this.canvas.width &&
      memo.canvasHeight === this.canvas.height
    ) {
      return memo.layout;
    }
    const layout = badgeLayout(item, this.canvas, opacity);
    this.badgeMemos.set(item.id, {
      item,
      opacity,
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
      layout,
    });
    return layout;
  }

  /** A moving picture's decoded frames, once known; starts decoding it the first time it is asked for. */
  private framesFor(url: string): StickerFrames | null {
    if (this.frames.has(url)) return this.frames.get(url) ?? null;
    if (!this.loadingFrames.has(url)) {
      this.loadingFrames.add(url);
      const settle = (frames: StickerFrames | null) => {
        if (!this.loadingFrames.delete(url)) {
          // The layer was destroyed while this was decoding.
          frames?.close();
          return;
        }
        this.frames.set(url, frames);
        if (frames && this.lastState) this.draw(this.lastState, true);
      };
      this.loadFrames(url).then(settle, () => settle(null));
    }
    return null;
  }

  private nodeFor(id: string): TextNode {
    const existing = this.nodes.get(id);
    if (existing) return existing;
    const doc = (this.canvasBox as HTMLDivElement).ownerDocument;
    const box = doc.createElement('div');
    box.dataset.clipText = id;
    box.style.position = 'absolute';
    box.style.transformOrigin = '50% 50%';
    box.style.whiteSpace = 'pre-wrap';
    box.style.overflowWrap = 'normal';
    box.style.wordBreak = 'normal';
    box.dir = 'auto';
    const words = doc.createElement('span');
    words.style.setProperty('-webkit-box-decoration-break', 'clone');
    words.style.setProperty('box-decoration-break', 'clone');
    box.appendChild(words);
    (this.canvasBox as HTMLDivElement).appendChild(box);
    const node: TextNode = { box, words, item: null, opacity: -1, hidden: null, fontKey: '' };
    this.nodes.set(id, node);
    return node;
  }

  /** Draws one text; true when its layout may have changed (it needs measuring). */
  private drawText(node: TextNode, overlay: OverlayState, force: boolean): boolean {
    const item = overlay.item as TextItem;
    const opacity = overlay.opacity;
    const weight = drawnWeight(this.manifest, item);
    const fontKey = `${weight} ${item.style.italic ? 'italic' : 'normal'} ${item.style.font}`;
    const fontReady = this.ensureFont(fontKey, item.style.font, weight, item.style.italic);
    const hidden = this.hiddenId === item.id || !fontReady;

    let restyled = false;
    if (force || node.item !== item || node.fontKey !== fontKey) {
      this.style(node, item);
      node.item = item;
      node.fontKey = fontKey;
      restyled = true;
    }
    if (force || node.opacity !== opacity) {
      node.box.style.opacity = String(Math.max(0, Math.min(1, opacity)));
      node.opacity = opacity;
    }
    if (node.hidden !== hidden) {
      node.box.style.visibility = hidden ? 'hidden' : 'visible';
      node.hidden = hidden;
    }
    return restyled;
  }

  private style(node: TextNode, item: TextItem): void {
    const css = textCss(item, this.canvas, this.manifest, this.fontFamily);
    for (const [name, value] of Object.entries(css.box)) node.box.style.setProperty(name, value);
    for (const [name, value] of Object.entries(css.words)) {
      if (value === '') node.words.style.removeProperty(name);
      else node.words.style.setProperty(name, value);
    }
    node.words.textContent = displayText(item);
  }

  /** True when the face is ready to draw; otherwise starts loading it and redraws when it lands. */
  private ensureFont(key: string, family: string, weight: number, italic: boolean): boolean {
    if (this.loadedFonts.has(key)) return true;
    const doc = this.host?.ownerDocument;
    const fonts = doc?.fonts;
    if (!fonts || typeof fonts.load !== 'function') {
      this.loadedFonts.add(key);
      return true;
    }
    const spec = `${italic ? 'italic ' : ''}${weight} 64px ${this.fontFamily(family)}`;
    if (fonts.check?.(spec)) {
      this.loadedFonts.add(key);
      return true;
    }
    if (!this.loadingFonts.has(key)) {
      this.loadingFonts.add(key);
      const done = () => {
        this.loadingFonts.delete(key);
        this.loadedFonts.add(key);
        if (this.lastState) this.draw(this.lastState, true);
      };
      // A font that fails to load still shows, in the browser's fallback, rather than never.
      fonts.load(spec).then(done, done);
    }
    return false;
  }

  /** Reads the heights of texts that changed (layout is read only then, never every frame). */
  private measure(visible: ReadonlySet<string>, restyled: ReadonlySet<string>): void {
    let changed = false;
    for (const id of [...this.heights.keys()]) {
      if (!visible.has(id)) {
        this.heights.delete(id);
        changed = true;
      }
    }
    for (const id of restyled) {
      const node = this.nodes.get(id);
      if (!node) continue;
      const height = node.box.offsetHeight;
      if (this.heights.get(id) !== height) {
        this.heights.set(id, height);
        changed = true;
      }
    }
    if (changed) this.onMeasure?.(new Map(this.heights));
  }
}
