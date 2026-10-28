'use client';

/**
 * One slide, drawn.
 *
 * This component is the whole reason `design-engine` exists as a package. The
 * editor's canvas, the gallery's thumbnails, the platform preview, the share
 * page and the server-side export all render *this*, at different sizes, so
 * "what you edit is what you get" is a property of the code rather than a
 * thing two implementations try to agree on.
 *
 * ## How it sizes
 *
 * The slide is always laid out at the format's **native pixels** (1080 x 1350
 * and so on). `ScaledSlide` shows it smaller with a `transform: scale()`,
 * which is a paint-time operation: the layout, the line breaks and the font
 * sizes are identical at every scale, and so is the screenshot. Positions are
 * percentages of the canvas, type is pixels and everything inside a text slot
 * is `em`, so nothing is recomputed per size.
 *
 * ## The three modes
 *
 * - `edit`: empty pictures and logos show a placeholder, an empty text slot
 *   shows its name faintly, and one text slot at a time can be typed into.
 *   Selection rings, region outlines and hit areas are *not* drawn here: the
 *   editor draws them over the scaled canvas in screen pixels, where a ring
 *   stays crisp at any zoom.
 * - `preview`: the finished slide. Thumbnails, the platform frames and the
 *   share page use it.
 * - `export`: the finished slide as static markup. No effect runs, because
 *   `react-dom/server` renders it; the page's own script fits the text.
 *
 * Text fitting is done by `fit-runtime.ts`, after the slide is in the page: in
 * the browser by the effect below, at export by the script the export page
 * carries. This component puts every box in place and hands the fitter a base
 * size.
 *
 * ## The layers
 *
 * The canvas's own colour is the ground. Over it sits either a photo and its
 * overlay or the design's background art (never both: art is for slides that
 * are not photos), then the layout's painted blocks, then the slots. Text is
 * set in the theme's type with the user's font choices resolved
 * (`typography.ts`).
 */
import { type CSSProperties, type ReactNode, type RefObject, useLayoutEffect, useRef } from 'react';
import { artById, artColors, artDataUri, artSvg } from '../art';
import { isTypeable, slotText } from '../bindings';
import { photoGround, photoOverlayColor, slideGround } from '../brand';
import { rgba } from '../color';
import { baseFontSize, MIN_FIT_SCALE } from '../fit';
import { fontStack, resolveWeight } from '../fonts';
import { formatSpec, shortEdge } from '../formats';
import { regionGround, slidePalette, slotInk } from '../ink';
import { decorRect, findLayout, slotFrame } from '../layouts';
import { themeById } from '../themes';
import {
  type Align,
  type DesignDocument,
  type ElementState,
  type ListMarker,
  MAX_BRAND_NAME_LENGTH,
  MAX_HANDLE_LENGTH,
  MAX_TEXT_LENGTH,
  type Palette,
  type Rect,
  type RegionId,
  type SlotDef,
  type SlotId,
  type Theme,
  type TypeRole,
  type TypeStyle,
} from '../types';
import { resolveTypeStyle } from '../typography';
import { EditableText } from './EditableText';
import { fitSlots } from './fit-runtime';

export type SlideMode = 'edit' | 'preview' | 'export';

export interface SlideViewProps {
  design: DesignDocument;
  /** Zero-based. */
  index: number;
  mode?: SlideMode;
  /**
   * Turns a media id into something `<img src>` can load: a URL in the
   * browser, a `data:` URI at export. Null draws the empty placeholder, which
   * is what a deleted picture must look like.
   */
  resolveMedia?: (mediaId: string) => string | null;
  /** Edit mode: the text slot being typed into. */
  editing?: SlotId | null;
  /** Edit mode: every change to the slot being typed into. */
  onTextInput?: (slot: SlotId, text: string) => void;
  /** Edit mode: typing ended (Escape, a click elsewhere, Enter on one line). */
  onTextCommit?: (slot: SlotId, text: string) => void;
  /**
   * After a fit, the slots whose text is too long even at the smallest size.
   * Called when that list changes, not after every render, so a parent can
   * keep it in state without looping.
   */
  onFit?: (overflowing: SlotId[]) => void;
}

export function SlideView({
  design,
  index,
  mode = 'preview',
  resolveMedia,
  editing = null,
  onTextInput,
  onTextCommit,
  onFit,
}: SlideViewProps) {
  const root = useRef<HTMLDivElement>(null);
  useFit(root, mode, onFit);

  const spec = formatSpec(design.format);
  const slide = design.slides[index];
  const layout = slide ? findLayout(slide.layoutId) : null;

  if (!slide || !layout) {
    // The schema refuses an unknown layout on every save, so this is a row
    // from a future release or a bug. Saying so beats an empty square.
    return (
      <div ref={root} style={{ ...canvasStyle(spec.width, spec.height), background: '#F2F2F0' }}>
        <p
          style={{ padding: '6%', font: `500 ${spec.width * 0.03}px system-ui`, color: '#111111' }}
        >
          This slide uses a layout that is no longer available.
        </p>
      </div>
    );
  }

  const theme = themeById(design.themeId);
  const palette = slidePalette(design, slide);
  const short = shortEdge(design.format);
  const background = slide.background;
  const photo = background.kind === 'media' ? (resolveMedia?.(background.mediaId) ?? null) : null;

  const grounds = new Map<RegionId, string>();
  const groundOf = (region: RegionId) => {
    let ground = grounds.get(region);
    if (ground === undefined) {
      ground = regionGround(layout, design.format, palette, slide, region);
      grounds.set(region, ground);
    }
    return ground;
  };

  // A photo that cannot be drawn shows the ground its overlay promises (the
  // lightest a dark tint allows, the darkest a light one does), so the text
  // the slide was set in still reads.
  const canvasGround =
    background.kind === 'media' && !photo
      ? photoGround(background.overlay, background.tint)
      : slideGround(palette, slide);

  const art =
    background.kind === 'media'
      ? null
      : artSource(design.art, theme, palette, canvasGround, spec.width, spec.height);

  return (
    <div
      ref={root}
      data-slide={slide.id}
      style={{
        ...canvasStyle(spec.width, spec.height),
        background: canvasGround,
        color: palette.text,
      }}
    >
      {background.kind === 'media' && photo ? (
        <>
          <img src={photo} alt="" style={fill({ objectFit: 'cover' })} />
          <div
            style={fill({
              background: rgba(photoOverlayColor(background.tint), background.overlay),
            })}
          />
        </>
      ) : null}

      {art ? (
        <img data-art={art.id} src={art.src} alt="" style={fill({ objectFit: 'cover' })} />
      ) : null}

      {layout.decor?.map((decor, decorIndex) => {
        const box = decorRect(layout, decor, design.format);
        if (!box) return null;

        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: a layout's decor is a fixed list.
            key={decorIndex}
            style={{
              ...at(box),
              background: palette[decor.colorRole],
              opacity: decor.opacity,
              borderRadius: decor.radius ? (decor.radius / 100) * short : undefined,
            }}
          />
        );
      })}

      {layout.slots.map((slot) => {
        const state = slide.elements[slot.id];
        if (state?.hidden) return null;

        const frame = slotFrame(layout, slot, design.format, state);
        if (!frame) return null;

        if (slot.kind === 'image' || slot.kind === 'logo') {
          return (
            <PictureSlot
              key={slot.id}
              slot={slot}
              state={state}
              rect={frame.rect}
              align={frame.align}
              logoMediaId={design.brand.logoMediaId}
              palette={palette}
              short={short}
              mode={mode}
              resolveMedia={resolveMedia}
            />
          );
        }

        const ink = slotInk(palette, slot, state, groundOf(frame.region.id));
        const typing = mode === 'edit' && editing === slot.id && isTypeable(slot);

        return (
          <TextSlot
            key={slot.id}
            slot={slot}
            state={state}
            rect={frame.rect}
            align={state?.align ?? frame.align ?? 'start'}
            text={slotText(design, index, slot)}
            color={ink.color}
            typeStyle={resolveTypeStyle(theme, slot.type ?? 'body', design, state)}
            short={short}
            mode={mode}
            typing={typing}
            onTextInput={onTextInput}
            onTextCommit={onTextCommit}
          />
        );
      })}
    </div>
  );
}

/**
 * The design's background art as an `<img>` source, drawn in this slide's
 * colours (`artColors`): a hand-made original's own colours on its home
 * ground, the theme's pinned colours on the theme's own background, and
 * colours derived from the ground and the accent anywhere else, which is how
 * a brand kit recolours the art. Null for no art, or an id the library does
 * not have.
 */
function artSource(
  id: string | null,
  theme: Theme,
  palette: Palette,
  ground: string,
  width: number,
  height: number,
): { id: string; src: string } | null {
  const art = artById(id);
  if (!art) return null;

  const svg = artSvg(
    art.id,
    artColors({
      ground,
      accent: palette.accent,
      pinned: theme.art ? { background: theme.colors.background, ...theme.art } : null,
      home: art.home ?? null,
    }),
    width,
    height,
  );

  return svg ? { id: art.id, src: artDataUri(svg) } : null;
}

/**
 * Runs the fitter after every render in the browser, and again whenever a
 * font finishes loading: until the real face has arrived, every measurement
 * is of the fallback, which is a different width.
 */
function useFit(
  root: RefObject<HTMLDivElement | null>,
  mode: SlideMode,
  onFit: SlideViewProps['onFit'],
) {
  const reported = useRef<string | null>(null);
  const callback = useRef(onFit);

  useLayoutEffect(() => {
    callback.current = onFit;
  });

  useLayoutEffect(() => {
    const element = root.current;
    if (mode === 'export' || !element) return;

    let active = true;

    const run = () => {
      if (!active) return;

      const overflowing = fitSlots(element) as SlotId[];
      const key = overflowing.join(' ');

      if (key !== reported.current) {
        reported.current = key;
        callback.current?.(overflowing);
      }
    };

    run();

    const fonts = element.ownerDocument.fonts;
    if (!fonts) return () => {};

    if (fonts.status !== 'loaded') fonts.ready.then(run, () => {});
    fonts.addEventListener('loadingdone', run);

    return () => {
      active = false;
      fonts.removeEventListener('loadingdone', run);
    };
  });
}

// ---------------------------------------------------------------------------
// Pictures and logos
// ---------------------------------------------------------------------------

interface PictureSlotProps {
  slot: SlotDef;
  state: ElementState | undefined;
  rect: Rect;
  align: Align | undefined;
  logoMediaId: string | null;
  palette: Palette;
  short: number;
  mode: SlideMode;
  resolveMedia: SlideViewProps['resolveMedia'];
}

function PictureSlot({
  slot,
  state,
  rect,
  align,
  logoMediaId,
  palette,
  short,
  mode,
  resolveMedia,
}: PictureSlotProps) {
  const isLogo = slot.kind === 'logo';
  // A logo slot with nothing of its own shows the brand kit's logo.
  const mediaId = state?.mediaId ?? (isLogo ? logoMediaId : null);
  const source = mediaId ? (resolveMedia?.(mediaId) ?? null) : null;
  const radius = slot.radius ? (slot.radius / 100) * short : 0;

  let content: ReactNode = null;

  if (source) {
    content = (
      <img
        src={source}
        alt=""
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          objectFit: isLogo ? 'contain' : (slot.fit ?? 'cover'),
          objectPosition: isLogo ? `${horizontal(align)} center` : 'center',
          borderRadius: radius || undefined,
        }}
      />
    );
  } else if (mode === 'edit') {
    // Only the editor marks the gap. An exported slide never shows a dashed
    // box: an empty logo is simply absent, and an empty picture is the
    // surface colour, with the export dialog saying which slide it is on.
    content = (
      <div
        style={{
          ...fill({ background: isLogo ? 'transparent' : palette.surface }),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `${Math.max(2, short * 0.003)}px dashed ${rgba(palette.text, 0.35)}`,
          borderRadius: radius,
          color: rgba(palette.text, 0.6),
          font: `600 ${short * 0.022}px ${fontStack('inter')}`,
        }}
      >
        {isLogo ? 'Logo' : 'Add a picture'}
      </div>
    );
  } else if (!isLogo) {
    content = <div style={fill({ background: palette.surface, borderRadius: radius })} />;
  }

  return (
    <div data-slot={slot.id} style={at(rect)}>
      {content}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text and lists
// ---------------------------------------------------------------------------

/**
 * The roles set as a few short lines, balanced so none ends on a word left
 * alone ("Plan A Month Of Posts In One / Afternoon"). Body copy and lists keep
 * the ordinary break: balanced, every line of a paragraph would come up short.
 * Balancing never adds a line, so it cannot make a slot overflow, and every
 * current browser supports it, so the editor shows the breaks the export
 * makes.
 */
const BALANCED_ROLES: ReadonlySet<TypeRole> = new Set<TypeRole>([
  'eyebrow',
  'headline',
  'subheadline',
  'quote',
  'attribution',
  'statLabel',
  'cta',
  'footer',
]);

interface TextSlotProps {
  slot: SlotDef;
  state: ElementState | undefined;
  rect: Rect;
  align: Align;
  text: string;
  color: string;
  /** The slot's type role, with the user's font choices resolved (`typography.ts`). */
  typeStyle: TypeStyle;
  short: number;
  mode: SlideMode;
  typing: boolean;
  onTextInput: SlideViewProps['onTextInput'];
  onTextCommit: SlideViewProps['onTextCommit'];
}

function TextSlot({
  slot,
  state,
  rect,
  align,
  text,
  color,
  typeStyle: style,
  short,
  mode,
  typing,
  onTextInput,
  onTextCommit,
}: TextSlotProps) {
  const base = baseFontSize(style, short, slot.resizable ? state?.size : undefined);

  const outer: CSSProperties = {
    ...at(rect),
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: flexAlign(slot.valign ?? 'start'),
    fontFamily: fontStack(style.font),
    fontWeight: resolveWeight(style.font, style.weight),
    fontStyle: style.italic ? 'italic' : undefined,
    fontSize: base,
    lineHeight: style.lineHeight,
    letterSpacing: `${style.tracking}em`,
    textTransform: style.uppercase ? 'uppercase' : undefined,
    textAlign: align === 'start' ? 'left' : align === 'end' ? 'right' : 'center',
    color,
  };

  // `break-word` rather than `anywhere`: a long word is broken only when it
  // genuinely does not fit, so ordinary copy keeps its shape.
  const inner: CSSProperties = {
    flex: '0 0 auto',
    whiteSpace: 'pre-wrap',
    // After `whiteSpace`, which in newer browsers also sets how text wraps.
    textWrap: BALANCED_ROLES.has(slot.type ?? 'body') ? 'balance' : undefined,
    overflowWrap: 'break-word',
  };

  let content: ReactNode;

  if (typing) {
    content = (
      <EditableText
        initialText={text}
        maxLength={maxLengthOf(slot)}
        multiline={!slot.bind}
        label={slot.label}
        style={inner}
        onInput={(value) => onTextInput?.(slot.id, value)}
        onCommit={(value) => onTextCommit?.(slot.id, value)}
      />
    );
  } else if (slot.kind === 'list') {
    const items = (state?.items ?? []).filter((item) => item.trim() !== '');

    content =
      items.length === 0 && mode === 'edit' ? (
        <div data-fit-content="" style={{ ...inner, opacity: 0.45 }}>
          {slot.label}
        </div>
      ) : (
        <div
          data-fit-content=""
          style={{ ...inner, display: 'flex', flexDirection: 'column', gap: '0.55em' }}
        >
          {items.map((item, itemIndex) => (
            <ListItem
              // biome-ignore lint/suspicious/noArrayIndexKey: list items have no id; order is identity.
              key={itemIndex}
              text={item}
              index={itemIndex}
              marker={slot.marker ?? 'dot'}
              color={color}
              lineHeight={style.lineHeight}
            />
          ))}
        </div>
      );
  } else if (text.trim() === '' && mode === 'edit' && isTypeable(slot)) {
    // An empty slot is invisible in the finished slide; in the editor its
    // name shows faintly, so there is something to click and type into.
    content = (
      <div data-fit-content="" style={{ ...inner, opacity: 0.45 }}>
        {slot.label}
      </div>
    );
  } else {
    content = (
      <div data-fit-content="" style={inner}>
        {text}
      </div>
    );
  }

  return (
    <div data-slot={slot.id} data-fit={base} data-fit-min={MIN_FIT_SCALE} style={outer}>
      {content}
    </div>
  );
}

function maxLengthOf(slot: SlotDef): number {
  if (slot.bind === 'brandName') return MAX_BRAND_NAME_LENGTH;
  if (slot.bind === 'handle') return MAX_HANDLE_LENGTH;
  return MAX_TEXT_LENGTH;
}

/**
 * One list item. Everything is in `em` so the marker shrinks with the text
 * when the fitter steps the size down.
 */
function ListItem({
  text,
  index,
  marker,
  color,
  lineHeight,
}: {
  text: string;
  index: number;
  marker: ListMarker;
  color: string;
  lineHeight: number;
}) {
  if (marker === 'none') return <div>{text}</div>;

  if (marker === 'rule') {
    return (
      <div style={{ borderTop: `0.07em solid ${rgba(color, 0.4)}`, paddingTop: '0.45em' }}>
        {text}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6em' }}>
      <span
        aria-hidden="true"
        style={{
          flex: '0 0 auto',
          // One line tall, so the marker sits on the first line's centre.
          height: `${lineHeight}em`,
          minWidth: marker === 'number' ? '1.3em' : '0.8em',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {marker === 'number' ? (
          <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{index + 1}.</span>
        ) : marker === 'tick' ? (
          // An SVG, not a glyph: a tick character is outside the Latin
          // subsets the fonts ship with and would draw as a box.
          <svg viewBox="0 0 24 24" width="0.85em" height="0.85em" aria-hidden="true">
            <path
              d="M4 12.5 L9.5 18 L20 6"
              fill="none"
              stroke={color}
              strokeWidth={3.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <span
            style={{
              display: 'block',
              width: '0.34em',
              height: '0.34em',
              borderRadius: '50%',
              background: color,
            }}
          />
        )}
      </span>
      <span style={{ flex: '1 1 auto', minWidth: 0 }}>{text}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scaling
// ---------------------------------------------------------------------------

export interface ScaledSlideProps extends SlideViewProps {
  /** The width to show the slide at, in CSS pixels. */
  width: number;
  className?: string;
}

/**
 * A slide shown at any width, by scaling the native-size canvas. Thumbnails,
 * the editor canvas and the platform frames all use this, so none of them
 * lays text out at a different size from the export.
 */
export function ScaledSlide({ width, className, ...props }: ScaledSlideProps) {
  const spec = formatSpec(props.design.format);
  const scale = width / spec.width;

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width,
        height: spec.height * scale,
        overflow: 'hidden',
        flex: '0 0 auto',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
        }}
      >
        <SlideView {...props} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

function canvasStyle(width: number, height: number): CSSProperties {
  return {
    position: 'relative',
    width,
    height,
    overflow: 'hidden',
    // The canvas is a fixed pixel box whatever the page around it sets.
    fontSize: 16,
    lineHeight: 1,
    textAlign: 'left',
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale',
  };
}

/** Absolute position from a rectangle in percentages of the canvas. */
function at(rect: Rect): CSSProperties {
  return {
    position: 'absolute',
    left: `${rect.x}%`,
    top: `${rect.y}%`,
    width: `${rect.w}%`,
    height: `${rect.h}%`,
  };
}

function fill(extra: CSSProperties): CSSProperties {
  return { position: 'absolute', inset: 0, width: '100%', height: '100%', ...extra };
}

function flexAlign(align: Align): CSSProperties['justifyContent'] {
  return align === 'start' ? 'flex-start' : align === 'end' ? 'flex-end' : 'center';
}

function horizontal(align: Align | undefined): 'left' | 'center' | 'right' {
  return align === 'end' ? 'right' : align === 'center' ? 'center' : 'left';
}
