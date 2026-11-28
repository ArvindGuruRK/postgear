/**
 * The stage: the DOM the preview draws into, built once inside the editor's
 * container and redrawn from a frame state.
 *
 * ```
 * root (fills the container, which has the canvas's shape; black)
 *   frame              the clip's fade: one opacity over everything below
 *     looks wrapper    the look: an SVG colour matrix (`filter: url(#...)`)
 *       zoom wrapper   the zoom: one CSS `scale` about the focus point
 *         base         the canvas colour, or the blurred copy of the video
 *         areas        one <canvas> per layout area
         mix          a Fade join's other picture (Module 11), hidden otherwise
 *     vignette         a black radial gradient over the looked picture
 *     overlays         text and stickers (Modules 11 and 12)
 *   svg                the look's filter definition (no size)
 *   media              the two <video> elements, 1 px and invisible
 * ```
 *
 * The order is the export's (Module 13): zoom the joined picture, colour it,
 * darken the edges, then draw the overlays, and fade the finished frame to
 * black. So no overlay ever zooms or takes the look, and a solid sticker
 * fades as one with the picture under it.
 * - **Zoom.** `scale(z)` about the focus is `F + (p - F) z`, the export's
 *   `perspective`; `z` is `frameState`'s, read at the exact moment.
 * - **Look.** One `feColorMatrix` in sRGB with the matrix and offset of
 *   `lookMatrix`: the same sum and the same single clamp as the export's
 *   `colorchannelmixer`, so the two agree to within the video's rounding.
 * - **Vignette.** `vignetteCss` draws `cos(angle x d)^4` as a gradient of
 *   black, which multiplies by the same factor as the export's `vignette`.
 *
 * - **Areas.** Each area is a `<canvas>` whose pixels are its rectangle in
 *   canvas pixels (a Fullscreen area of a Vertical clip is 1080 by 1920),
 *   placed and scaled by CSS percentages, and filled by one `drawImage` of
 *   the area's crop from the playing `<video>`. One decode serves every
 *   area, and the crop is exact at the video's own resolution. Rounded
 *   areas get a CSS `border-radius` of the same radius in canvas pixels,
 *   written as percentages of the area so it scales with the stage.
 * - **The Blurred base** is one small canvas, a tenth of the clip's size,
 *   drawn from the video and stretched over the stage with a CSS blur and a
 *   slight darkening: the export's `gblur=sigma=3` on a tenth-size copy,
 *   approximated (Preview Export shows the exact one). The blur is set in
 *   CSS pixels from the stage's width, kept by a `ResizeObserver`.
 * - **A Fade join** (Module 11's montage) is a quick mix: inside the
 *   overlap the other side's picture is drawn on one half-size canvas over
 *   the areas (its background colour, then its areas, square corners), at
 *   the join's share as its CSS opacity. An approximation: Preview Export
 *   shows the export's exact `xfade`.
 * - **The videos stay in the document** (never `display: none`), so the
 *   browser keeps decoding them and keeps calling their frame callbacks.
 */
import {
  type AreaState,
  type BlurRect,
  blurInto,
  type FrameState,
  lookSvgValues,
  vignetteCss,
} from '@postgear/video-engine';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Every stage's filter gets its own id, so two previews on a page never share one. */
let nextStageId = 0;

/** The Blurred base is drawn at a tenth of the clip's size, as the export's base is. */
const BLUR_DOWNSCALE = 10;
/** The export blurs the tenth-size copy with `gblur=sigma=3`. */
const BLUR_RADIUS_SMALL_PX = 3;
/** The base overhangs the stage a little, so the blur's soft edge falls outside it. */
const BLUR_OVERHANG = 0.04;
const BLUR_BRIGHTNESS = 0.85;

interface AreaCanvas {
  canvas: HTMLCanvasElement;
  /** Null when the browser gave no 2D context (asked once). */
  context: CanvasRenderingContext2D | null;
  layoutKey: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function percent(fraction: number): string {
  return `${fraction * 100}%`;
}

function fill(element: HTMLElement): void {
  element.style.position = 'absolute';
  element.style.inset = '0';
}

function contextOf(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D | null;
  } catch {
    return null;
  }
}

/** Draws a fraction of the video onto the whole of a canvas. Returns whether it drew. */
function drawCrop(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  crop: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): boolean {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const sx = clamp(crop.x * vw, 0, vw);
  const sy = clamp(crop.y * vh, 0, vh);
  const sw = Math.min(crop.w * vw, vw - sx);
  const sh = Math.min(crop.h * vh, vh - sy);
  if (!(sw >= 1 && sh >= 1)) {
    return false;
  }
  context.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
  return true;
}

/**
 * Module 17 item 18: each blurred box that falls inside `crop`, drawn again
 * over the area through a CSS blur, clipped to the box. The source is read a
 * little wider than the box so its edge does not fade to clear. The radius
 * is a sixth of the box's short side, as the export's `boxblur`.
 */
function drawBlurs(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  crop: { x: number; y: number; w: number; h: number },
  blurs: readonly BlurRect[],
  width: number,
  height: number,
): void {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  for (const blur of blurs) {
    const into = blurInto(blur, crop);
    if (!into) continue;
    const dx = into.x * width;
    const dy = into.y * height;
    const dw = into.w * width;
    const dh = into.h * height;
    const radius = Math.max(1, Math.min(dw, dh) / 6);
    const scaleX = (crop.w * vw) / width;
    const scaleY = (crop.h * vh) / height;
    context.save();
    context.beginPath();
    context.rect(dx, dy, dw, dh);
    context.clip();
    context.filter = `blur(${radius.toFixed(1)}px)`;
    context.drawImage(
      video,
      (crop.x + into.x * crop.w) * vw - radius * scaleX,
      (crop.y + into.y * crop.h) * vh - radius * scaleY,
      into.w * crop.w * vw + 2 * radius * scaleX,
      into.h * crop.h * vh + 2 * radius * scaleY,
      dx - radius,
      dy - radius,
      dw + 2 * radius,
      dh + 2 * radius,
    );
    context.restore();
  }
}

/** Draws a fraction of the video into the rectangle `into` (a fraction of the canvas) of a canvas. */
function drawCropAt(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  crop: { x: number; y: number; w: number; h: number },
  into: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): boolean {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const sx = clamp(crop.x * vw, 0, vw);
  const sy = clamp(crop.y * vh, 0, vh);
  const sw = Math.min(crop.w * vw, vw - sx);
  const sh = Math.min(crop.h * vh, vh - sy);
  const dw = into.w * width;
  const dh = into.h * height;
  if (!(sw >= 1 && sh >= 1 && dw > 0 && dh > 0)) {
    return false;
  }
  context.drawImage(video, sx, sy, sw, sh, into.x * width, into.y * height, dw, dh);
  return true;
}

export class PreviewStage {
  readonly root: HTMLDivElement;
  /** The clip's fade: one opacity over the picture, the vignette and the overlays. */
  readonly frame: HTMLDivElement;
  /** The look: `filter: url(#...)` to the stage's own colour matrix. */
  readonly looks: HTMLDivElement;
  /** The zoom: CSS `transform` and `transform-origin`. */
  readonly zoom: HTMLDivElement;
  readonly vignette: HTMLDivElement;
  readonly overlayHost: HTMLDivElement;
  readonly mediaHost: HTMLDivElement;
  /** The id of the stage's look filter. */
  readonly lookFilterId: string;
  private readonly lookMatrix: SVGFEColorMatrixElement;
  private lookKey = '';
  private vignetteKey = -1;
  private readonly base: HTMLDivElement;
  private readonly blurCanvas: HTMLCanvasElement;
  private blurContext: CanvasRenderingContext2D | null | undefined;
  private readonly areasHost: HTMLDivElement;
  private readonly areas = new Map<string, AreaCanvas>();
  /** A Fade join's other picture (Module 11): one canvas over the areas, hidden outside a join. */
  readonly mixCanvas: HTMLCanvasElement;
  private mixContext: CanvasRenderingContext2D | null | undefined;
  private mixShown = false;
  private resizeObserver: ResizeObserver | null = null;
  private stageWidth = 0;
  private blurKey = '';

  constructor(private readonly ownerDocument: Document) {
    const make = () => ownerDocument.createElement('div');
    this.root = make();
    this.root.dataset.previewStage = '';
    this.root.style.position = 'relative';
    this.root.style.width = '100%';
    this.root.style.height = '100%';
    this.root.style.overflow = 'hidden';
    // Black under everything, as the export's fades fade to black.
    this.root.style.background = '#000000';

    this.frame = make();
    this.frame.dataset.previewLayer = 'frame';
    fill(this.frame);

    this.looks = make();
    this.looks.dataset.previewLayer = 'looks';
    fill(this.looks);

    this.zoom = make();
    this.zoom.dataset.previewLayer = 'zoom';
    fill(this.zoom);
    this.zoom.style.transformOrigin = '50% 50%';

    this.base = make();
    this.base.dataset.previewLayer = 'base';
    fill(this.base);
    this.base.style.overflow = 'hidden';

    this.blurCanvas = ownerDocument.createElement('canvas');
    this.blurCanvas.dataset.previewBlur = '';
    this.blurCanvas.style.position = 'absolute';
    this.blurCanvas.style.left = percent(-BLUR_OVERHANG);
    this.blurCanvas.style.top = percent(-BLUR_OVERHANG);
    this.blurCanvas.style.width = percent(1 + 2 * BLUR_OVERHANG);
    this.blurCanvas.style.height = percent(1 + 2 * BLUR_OVERHANG);
    this.blurCanvas.style.display = 'none';
    this.base.appendChild(this.blurCanvas);

    this.areasHost = make();
    this.areasHost.dataset.previewLayer = 'areas';
    fill(this.areasHost);

    this.mixCanvas = ownerDocument.createElement('canvas');
    this.mixCanvas.dataset.previewLayer = 'mix';
    this.mixCanvas.style.position = 'absolute';
    this.mixCanvas.style.left = '0';
    this.mixCanvas.style.top = '0';
    this.mixCanvas.style.width = '100%';
    this.mixCanvas.style.height = '100%';
    this.mixCanvas.style.display = 'none';
    this.mixCanvas.style.pointerEvents = 'none';

    this.overlayHost = make();
    this.overlayHost.dataset.previewLayer = 'overlays';
    fill(this.overlayHost);
    this.overlayHost.style.pointerEvents = 'none';

    this.mediaHost = make();
    this.mediaHost.dataset.previewLayer = 'media';
    this.mediaHost.setAttribute('aria-hidden', 'true');
    this.mediaHost.style.position = 'absolute';
    this.mediaHost.style.left = '0';
    this.mediaHost.style.top = '0';
    this.mediaHost.style.width = '1px';
    this.mediaHost.style.height = '1px';
    this.mediaHost.style.overflow = 'hidden';
    this.mediaHost.style.opacity = '0';
    this.mediaHost.style.pointerEvents = 'none';

    this.vignette = make();
    this.vignette.dataset.previewLayer = 'vignette';
    fill(this.vignette);
    this.vignette.style.pointerEvents = 'none';
    this.vignette.style.display = 'none';

    // The look's filter: a colour matrix in sRGB, as the export's mixer works.
    nextStageId += 1;
    this.lookFilterId = `pg-clip-look-${nextStageId}`;
    const svg = ownerDocument.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.style.width = '0';
    svg.style.height = '0';
    const filter = ownerDocument.createElementNS(SVG_NS, 'filter');
    filter.setAttribute('id', this.lookFilterId);
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    filter.setAttribute('x', '0');
    filter.setAttribute('y', '0');
    filter.setAttribute('width', '1');
    filter.setAttribute('height', '1');
    this.lookMatrix = ownerDocument.createElementNS(
      SVG_NS,
      'feColorMatrix',
    ) as SVGFEColorMatrixElement;
    this.lookMatrix.setAttribute('type', 'matrix');
    filter.appendChild(this.lookMatrix);
    svg.appendChild(filter);

    this.zoom.append(this.base, this.areasHost, this.mixCanvas);
    this.looks.append(this.zoom);
    this.frame.append(this.looks, this.vignette, this.overlayHost);
    this.root.append(this.frame, svg, this.mediaHost);
  }

  /** Puts the stage into the editor's container (moving it out of any earlier one). */
  mount(container: HTMLElement): void {
    container.appendChild(this.root);
    this.stageWidth = this.root.clientWidth;
    this.resizeObserver?.disconnect();
    const Observer = this.ownerDocument.defaultView?.ResizeObserver;
    if (Observer) {
      this.resizeObserver = new Observer((entries) => {
        const width = entries[0]?.contentRect.width ?? this.root.clientWidth;
        if (width !== this.stageWidth) {
          this.stageWidth = width;
          this.blurKey = '';
        }
      });
      this.resizeObserver.observe(this.root);
    }
  }

  unmount(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.root.remove();
  }

  /** The canvas element of an area, for tests and the cost spike. */
  areaCanvas(areaId: string): HTMLCanvasElement | null {
    return this.areas.get(areaId)?.canvas ?? null;
  }

  get areaCount(): number {
    return this.areas.size;
  }

  /**
   * Draws the moment `state` describes from `video`. Returns false (and
   * leaves the last picture in place) when the video has no frame yet.
   */
  render(state: FrameState, video: HTMLVideoElement, drawPixels = true): boolean {
    this.syncAreas(state);
    this.syncBase(state);
    this.syncEffects(state);
    if (!drawPixels || !(video.videoWidth > 0 && video.videoHeight > 0) || video.readyState < 2) {
      return false;
    }
    let drew = false;
    for (const area of state.areas) {
      const entry = this.areas.get(area.id);
      if (entry?.context) {
        drew =
          drawCrop(
            entry.context,
            video,
            area.visibleCrop,
            entry.canvas.width,
            entry.canvas.height,
          ) || drew;
        if (state.blurs.length > 0) {
          drawBlurs(
            entry.context,
            video,
            area.visibleCrop,
            state.blurs,
            entry.canvas.width,
            entry.canvas.height,
          );
        }
      }
    }
    if (state.background.kind === 'blurred') {
      if (this.blurContext === undefined) {
        this.blurContext = contextOf(this.blurCanvas);
      }
      if (this.blurContext) {
        drawCrop(
          this.blurContext,
          video,
          state.background.crop,
          this.blurCanvas.width,
          this.blurCanvas.height,
        );
      }
    }
    return drew;
  }

  /**
   * A Fade join's other side (Module 11): `state`'s picture from `video`,
   * drawn over the areas at `opacity` (0 to 1). Drawn at half the clip's
   * size, its background a flat colour (a Blurred base is drawn unblurred
   * and dimmed), its corners square: the quick mix the editor needs while
   * it plays. Returns whether it drew.
   */
  renderMix(state: FrameState, video: HTMLVideoElement, opacity: number): boolean {
    const share = clamp(Number.isFinite(opacity) ? opacity : 0, 0, 1);
    if (share <= 0 || !(video.videoWidth > 0 && video.videoHeight > 0) || video.readyState < 2) {
      this.clearMix();
      return false;
    }
    const width = Math.max(2, Math.round(state.canvas.width / 2));
    const height = Math.max(2, Math.round(state.canvas.height / 2));
    if (this.mixCanvas.width !== width) this.mixCanvas.width = width;
    if (this.mixCanvas.height !== height) this.mixCanvas.height = height;
    if (this.mixContext === undefined) {
      this.mixContext = contextOf(this.mixCanvas);
    }
    const context = this.mixContext;
    if (!context) return false;
    context.fillStyle = state.canvas.background;
    context.fillRect(0, 0, width, height);
    if (state.background.kind === 'blurred') {
      drawCropAt(context, video, state.background.crop, { x: 0, y: 0, w: 1, h: 1 }, width, height);
      context.fillStyle = 'rgba(0, 0, 0, 0.15)';
      context.fillRect(0, 0, width, height);
    }
    for (const area of state.areas) {
      drawCropAt(context, video, area.visibleCrop, area.content, width, height);
    }
    const value = share.toFixed(3);
    if (this.mixCanvas.style.opacity !== value) this.mixCanvas.style.opacity = value;
    if (!this.mixShown) {
      this.mixCanvas.style.display = 'block';
      this.mixShown = true;
    }
    return true;
  }

  /** Hides a Fade join's other picture. */
  clearMix(): void {
    if (!this.mixShown) return;
    this.mixCanvas.style.display = 'none';
    this.mixShown = false;
  }

  /** Whether a Fade join's other picture is showing (tests). */
  get mixing(): boolean {
    return this.mixShown;
  }

  /**
   * The zoom, the look, the vignette and the fade for this moment. Each
   * style is written only when it changed, so a still frame costs nothing.
   */
  syncEffects(state: FrameState): void {
    const { scale, focus } = state.zoom;
    const transform = scale > 1 ? `scale(${scale})` : '';
    if (this.zoom.style.transform !== transform) this.zoom.style.transform = transform;
    const origin = `${focus.x * 100}% ${focus.y * 100}%`;
    if (transform && this.zoom.style.transformOrigin !== origin) {
      this.zoom.style.transformOrigin = origin;
    }

    const values = lookSvgValues(state.looks);
    const lookKey = values ?? '';
    if (lookKey !== this.lookKey) {
      this.lookKey = lookKey;
      if (values) this.lookMatrix.setAttribute('values', values);
      this.looks.style.filter = values ? `url(#${this.lookFilterId})` : '';
    }

    const vignette = state.looks.vignette;
    if (vignette !== this.vignetteKey) {
      this.vignetteKey = vignette;
      const gradient = vignetteCss(vignette);
      this.vignette.style.display = gradient ? 'block' : 'none';
      this.vignette.style.background = gradient ?? '';
    }

    const opacity = state.fadeOpacity >= 1 ? '' : String(Math.max(0, state.fadeOpacity));
    if (this.frame.style.opacity !== opacity) this.frame.style.opacity = opacity;
  }

  /** One canvas per area, placed from its rectangle; areas no longer in the layout go. */
  private syncAreas(state: FrameState): void {
    const seen = new Set<string>();
    for (const area of state.areas) {
      seen.add(area.id);
      let entry = this.areas.get(area.id);
      if (!entry) {
        const canvas = this.ownerDocument.createElement('canvas');
        canvas.dataset.areaId = area.id;
        canvas.style.position = 'absolute';
        canvas.style.display = 'block';
        entry = { canvas, context: null, layoutKey: '' };
        this.areas.set(area.id, entry);
        this.areasHost.appendChild(canvas);
        entry.context = contextOf(canvas);
      }
      this.placeArea(entry, area, state.canvas);
    }
    for (const [id, entry] of this.areas) {
      if (!seen.has(id)) {
        entry.canvas.remove();
        this.areas.delete(id);
      }
    }
  }

  private placeArea(
    entry: AreaCanvas,
    area: AreaState,
    canvas: { width: number; height: number },
  ): void {
    const { content, radius } = area;
    const key = `${content.x},${content.y},${content.w},${content.h},${radius},${canvas.width},${canvas.height}`;
    if (key === entry.layoutKey) {
      return;
    }
    entry.layoutKey = key;
    const pixelWidth = Math.max(1, Math.round(content.w * canvas.width));
    const pixelHeight = Math.max(1, Math.round(content.h * canvas.height));
    // Setting a canvas's size clears it, so only when it really changed.
    if (entry.canvas.width !== pixelWidth) entry.canvas.width = pixelWidth;
    if (entry.canvas.height !== pixelHeight) entry.canvas.height = pixelHeight;
    const style = entry.canvas.style;
    style.left = percent(content.x);
    style.top = percent(content.y);
    style.width = percent(content.w);
    style.height = percent(content.h);
    // A radius in canvas pixels, as percentages of the area's own box, so
    // the corner stays round at any stage size.
    style.borderRadius =
      radius > 0
        ? `${Math.min(50, (radius / pixelWidth) * 100)}% / ${Math.min(50, (radius / pixelHeight) * 100)}%`
        : '';
  }

  /** The canvas colour, or the small blurred copy for the Blurred layout. */
  private syncBase(state: FrameState): void {
    this.base.style.background = state.canvas.background;
    if (state.background.kind !== 'blurred') {
      this.blurCanvas.style.display = 'none';
      return;
    }
    const width = Math.max(2, Math.round(state.canvas.width / BLUR_DOWNSCALE));
    const height = Math.max(2, Math.round(state.canvas.height / BLUR_DOWNSCALE));
    const key = `${width}x${height}@${this.stageWidth}`;
    if (key === this.blurKey) {
      return;
    }
    this.blurKey = key;
    this.blurCanvas.style.display = 'block';
    if (this.blurCanvas.width !== width) this.blurCanvas.width = width;
    if (this.blurCanvas.height !== height) this.blurCanvas.height = height;
    // Three pixels of the small copy, in CSS pixels of the stretched canvas.
    const shown = this.stageWidth > 0 ? this.stageWidth * (1 + 2 * BLUR_OVERHANG) : width;
    const blur = (BLUR_RADIUS_SMALL_PX * shown) / width;
    this.blurCanvas.style.filter = `blur(${blur.toFixed(2)}px) brightness(${BLUR_BRIGHTNESS})`;
  }
}
