/**
 * Stickers in the overlay layer (Module 12), drawn from the same numbers the
 * export's overlays and ASS shapes come from.
 *
 * - A picture sticker is a box `widthPx x scale` by `heightPx x scale`
 *   canvas pixels centred on the item, flipped and then turned (the
 *   export's `hflip` then `rotate`), at the item's opacity. The picture
 *   fills the box, as the export scales it to the box.
 * - A still picture is an `<img>`. A moving one is a `<canvas>` showing
 *   frame `stickerFrameAt(localMs)`, decoded with `ImageDecoder`, so it
 *   follows scrubbing and pausing exactly like the export. Until its frames
 *   are decoded, or where the browser cannot decode APNG, it is an `<img>`
 *   that plays by itself from when the playhead entered the item (the
 *   documented preview difference).
 * - The Follow Badge is the three plain shapes `badgeLayout` gives (a round
 *   pill, a disc, a play mark), drawn as `div`s; its two lines are ordinary
 *   texts drawn by the text code.
 */
import {
  type BadgeShape,
  type OverlayState,
  type StickerItem,
  stickerFrameAt,
} from '@postgear/video-engine';

/** One sticker file as the editor has it (from `GET /clips/stickers/files`). */
export interface StickerPicture {
  /** A PNG or APNG anyone may read (no cookie is sent). */
  fileUrl: string;
  animated: boolean;
  /** The picture's own pixel size. */
  width: number;
  height: number;
  /** A moving picture's constant frame rate and frame count; null for a still one. */
  fps: number | null;
  frames: number | null;
}

/** A moving picture's frames, decoded one at a time. */
export interface StickerFrames {
  readonly frameCount: number;
  /** Draws frame `index` onto the canvas, filling it. */
  draw(index: number, canvas: HTMLCanvasElement): Promise<void>;
  close(): void;
}

/** Decodes one moving picture; null when this browser cannot (the `<img>` stays). */
export type StickerFramesLoader = (url: string) => Promise<StickerFrames | null>;

/** The MIME types tried for an APNG, in order (some builds know only `image/png`). */
const APNG_TYPES = ['image/apng', 'image/png'] as const;

/**
 * The real loader: fetches the file once (no cookie: library files are
 * public, uploads are signed addresses) and decodes it with `ImageDecoder`.
 */
export const imageDecoderFrames: StickerFramesLoader = async (url) => {
  if (typeof ImageDecoder === 'undefined') return null;
  let type: string | null = null;
  for (const candidate of APNG_TYPES) {
    if (await ImageDecoder.isTypeSupported(candidate)) {
      type = candidate;
      break;
    }
  }
  if (!type) return null;
  const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!response.ok) return null;
  const decoder = new ImageDecoder({ data: await response.arrayBuffer(), type });
  try {
    await decoder.tracks.ready;
  } catch {
    decoder.close();
    return null;
  }
  const frameCount = Math.max(1, decoder.tracks.selectedTrack?.frameCount ?? 1);
  return {
    frameCount,
    async draw(index, canvas) {
      const { image } = await decoder.decode({ frameIndex: index, completeFramesOnly: true });
      try {
        const context = canvas.getContext('2d');
        if (!context) return;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      } finally {
        image.close();
      }
    },
    close() {
      decoder.close();
    },
  };
};

/**
 * The CSS that places one picture sticker, in canvas pixels. Pure, so the
 * editor's handles use the same box.
 */
export function stickerBoxCss(
  overlay: Pick<OverlayState, 'item' | 'centre' | 'scale' | 'rotationDeg' | 'flipX'>,
  canvas: { width: number; height: number },
): Record<string, string> {
  const item = overlay.item as StickerItem;
  const width = item.widthPx * overlay.scale;
  const height = item.heightPx * overlay.scale;
  // CSS applies the right-most function first: flip, then turn, as the export does.
  const turn = `rotate(${overlay.rotationDeg}deg)`;
  return {
    left: `${overlay.centre.x * canvas.width - width / 2}px`,
    top: `${overlay.centre.y * canvas.height - height / 2}px`,
    width: `${width}px`,
    height: `${height}px`,
    transform: overlay.flipX ? `${turn} scaleX(-1)` : turn,
  };
}

/** The CSS for one Follow Badge shape: the pill and the disc round, the mark a triangle. */
export function badgeShapeCss(shape: BadgeShape): Record<string, string> {
  return {
    left: `${shape.cx - shape.width / 2}px`,
    top: `${shape.cy - shape.height / 2}px`,
    width: `${shape.width}px`,
    height: `${shape.height}px`,
    background: shape.colour,
    opacity: String(Math.max(0, Math.min(1, shape.opacity))),
    'border-radius': shape.kind === 'mark' ? '' : `${shape.radius}px`,
    // The same triangle as the ASS drawing: the left edge, then the point at the right middle.
    'clip-path': shape.kind === 'mark' ? 'polygon(0 0, 100% 50%, 0 100%)' : '',
    transform: shape.rotationDeg === 0 ? '' : `rotate(${shape.rotationDeg}deg)`,
  };
}

function applyCss(element: HTMLElement, css: Record<string, string>): void {
  for (const [name, value] of Object.entries(css)) {
    if (value === '') element.style.removeProperty(name);
    else element.style.setProperty(name, value);
  }
}

/** One picture sticker on the stage: a placed box holding an `<img>` or a `<canvas>`. */
export class PictureStickerNode {
  readonly box: HTMLDivElement;
  private img: HTMLImageElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private frames: StickerFrames | null = null;
  private url = '';
  private placed = '';
  private opacity = -1;
  private wanted = -1;
  private drawn = -1;
  private busy = false;
  private closed = false;
  /** A frame would not decode: this file shows as an `<img>` from now on. */
  private failed = false;

  constructor(
    private readonly owner: Document,
    id: string,
  ) {
    const box = owner.createElement('div');
    box.dataset.clipSticker = id;
    box.style.position = 'absolute';
    box.style.transformOrigin = '50% 50%';
    this.box = box;
  }

  /**
   * Draws the sticker at this moment. `picture` is null while its file is
   * not known yet (or is gone): nothing shows. `frames` is null until a
   * moving picture is decoded (the `<img>` plays meanwhile).
   */
  update(
    overlay: OverlayState,
    picture: StickerPicture | null,
    frames: StickerFrames | null,
    opacity: number,
    canvas: { width: number; height: number },
    force: boolean,
  ): void {
    const css = stickerBoxCss(overlay, canvas);
    const placed = JSON.stringify(css);
    if (force || placed !== this.placed) {
      applyCss(this.box, css);
      this.placed = placed;
    }
    if (force || opacity !== this.opacity) {
      this.box.style.opacity = String(Math.max(0, Math.min(1, opacity)));
      this.opacity = opacity;
    }
    if (!picture) {
      this.clear();
      this.box.style.visibility = 'hidden';
      return;
    }
    this.box.style.visibility = 'visible';
    if (picture.fileUrl !== this.url) {
      this.clear();
      this.url = picture.fileUrl;
    }
    const item = overlay.item as StickerItem;
    if (picture.animated && frames && !this.failed && picture.fps && picture.frames) {
      this.drawOnCanvas(picture, frames);
      const count = Math.min(picture.frames, frames.frameCount);
      this.show(stickerFrameAt(overlay.localMs, { fps: picture.fps, frames: count }, item.loop));
    } else {
      this.drawAsImage(picture.fileUrl);
    }
  }

  /** The frame a moving sticker shows now (-1 when it is not on its canvas yet), for tests. */
  get frameShown(): number {
    return this.drawn;
  }

  remove(): void {
    this.closed = true;
    this.box.remove();
  }

  private clear(): void {
    this.img?.remove();
    this.img = null;
    this.canvas?.remove();
    this.canvas = null;
    this.frames = null;
    this.url = '';
    this.wanted = -1;
    this.drawn = -1;
    this.failed = false;
  }

  private fill(element: HTMLElement): void {
    element.style.position = 'absolute';
    element.style.inset = '0';
    element.style.width = '100%';
    element.style.height = '100%';
    element.style.display = 'block';
  }

  private drawAsImage(url: string): void {
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
      this.frames = null;
      this.drawn = -1;
    }
    if (this.img) return;
    const img = this.owner.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    this.fill(img);
    img.src = url;
    this.box.appendChild(img);
    this.img = img;
  }

  private drawOnCanvas(picture: StickerPicture, frames: StickerFrames): void {
    if (this.canvas && this.frames === frames) return;
    const canvas = this.owner.createElement('canvas');
    canvas.width = picture.width;
    canvas.height = picture.height;
    this.fill(canvas);
    // The <img> stays until the first frame is on the canvas, so the sticker never blinks.
    canvas.style.visibility = 'hidden';
    this.canvas?.remove();
    this.box.appendChild(canvas);
    this.canvas = canvas;
    this.frames = frames;
    this.drawn = -1;
  }

  /** Asks for a frame; the newest asked wins, frames in between are skipped. */
  private show(index: number): void {
    this.wanted = index;
    if (this.busy || this.drawn === index) return;
    void this.drawLoop();
  }

  private async drawLoop(): Promise<void> {
    this.busy = true;
    try {
      while (!this.closed && this.canvas && this.frames && this.wanted !== this.drawn) {
        const target = this.wanted;
        const canvas = this.canvas;
        const frames = this.frames;
        await frames.draw(target, canvas);
        if (this.canvas !== canvas) continue;
        this.drawn = target;
        if (canvas.style.visibility === 'hidden') {
          canvas.style.visibility = 'visible';
          this.img?.remove();
          this.img = null;
        }
      }
    } catch {
      // A frame that will not decode: the next update shows the <img> instead, and stays with it.
      this.failed = true;
    } finally {
      this.busy = false;
    }
  }
}

/** One Follow Badge's three shapes on the stage. */
export class BadgeShapesNode {
  private readonly parts = new Map<string, { element: HTMLDivElement; css: string }>();

  constructor(
    private readonly owner: Document,
    private readonly parent: HTMLElement,
    private readonly id: string,
  ) {}

  /** Draws the shapes, bottom first, from z-index `firstZ`; answers the next free z-index. */
  update(shapes: readonly BadgeShape[], firstZ: number): number {
    let z = firstZ;
    for (const shape of shapes) {
      let part = this.parts.get(shape.kind);
      if (!part) {
        const element = this.owner.createElement('div');
        element.dataset.clipBadge = this.id;
        element.dataset.badgePart = shape.kind;
        element.style.position = 'absolute';
        element.style.transformOrigin = '50% 50%';
        this.parent.appendChild(element);
        part = { element, css: '' };
        this.parts.set(shape.kind, part);
      }
      const css = badgeShapeCss(shape);
      const key = JSON.stringify(css);
      if (key !== part.css) {
        applyCss(part.element, css);
        part.css = key;
      }
      const zIndex = String(z);
      if (part.element.style.zIndex !== zIndex) part.element.style.zIndex = zIndex;
      z += 1;
    }
    return z;
  }

  remove(): void {
    for (const part of this.parts.values()) part.element.remove();
    this.parts.clear();
  }
}
