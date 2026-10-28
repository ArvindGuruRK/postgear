'use client';

/**
 * The platform frames (Sprint 9: Screen 5, DS-7.1 and DS-7.2, and the share
 * page, DS-9.2): a design's slides and caption as an Instagram, Facebook,
 * LinkedIn or X post would show them. The editor's Preview and the public
 * share page draw the very same frames, so what a reviewer sees on their
 * phone is what the designer saw.
 *
 * - **The composer previews' look**: each platform's colours, and
 *   `PreviewText` for a caption read the way the feed folds it. The slides
 *   are drawn by the real renderer at full quality, never as thumbnails.
 * - **Honest status** (UX rule 5): like, comment and share icons carry no
 *   numbers, there is no time, and a Preview badge sits where the platform
 *   puts its menu, so nothing reads as a live post with engagement.
 * - **The carousel** swipes by touch, pen or mouse, steps with its arrows,
 *   its dots and the left and right arrow keys (Home and End too), and holds
 *   still under reduced motion. A screen reader hears "Slide 2 of 5" as it
 *   turns, and each slide's words, since the slide itself is a picture.
 * - **The caption** is a field in the editor, counted the platform's way and
 *   red with a sentence once past its limit, and read-only text on the share
 *   page. Typing it never redraws a slide: the renderer fits a slide's text
 *   after every render, so the slides are kept while only the caption
 *   changes, and each slide is memoised.
 */
import { ChevronLeftIcon } from '@animateicons/react/lucide/chevron-left-icon';
import { ChevronRightIcon } from '@animateicons/react/lucide/chevron-right-icon';
import {
  type DesignDocument,
  FORMATS,
  type FormatId,
  MAX_CAPTION_LENGTH,
} from '@postgear/design-engine';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  cn,
  FormErrorMessage,
  FormHelperText,
  Label,
  MotionIcon,
  pressSm,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@postgear/ui';
import {
  BarChart2,
  Bookmark,
  Heart,
  type LucideIcon,
  MessageCircle,
  MessageSquare,
  Repeat2,
  Send,
  Share,
  Share2,
  ThumbsUp,
} from 'lucide-react';
import {
  type KeyboardEvent,
  memo,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { initialsOf } from '@/lib/avatars';
import type { PreviewPlatform, PreviewPlatformId, StudioMediaRef } from '@/types/studio';
import { SEGMENTED_LIST, SEGMENTED_TRIGGER } from '../analytics/analytics-ui';
import { PlatformIcon } from '../platforms/platform-icon';
import { PreviewText } from '../previews/preview-parts';
import { FOCUS } from './design-card';
import {
  CAPTION_FOLDS,
  CAPTION_HINT,
  captionCount,
  captionTooLong,
  clampIndex,
  dragOffset,
  drawnAround,
  frameWidth,
  NO_FRAME_MESSAGE,
  type SwipeAxis,
  sameSlides,
  slideWords,
  swipeAxis,
  swipeTarget,
} from './preview-model';
import { SlideFrame } from './slide-frame';
import { INSET } from './studio-ui';
import { mediaResolver } from './studio-view-model';

/** Who the post is from: the workspace, as the editor and the share page know it. */
export interface PreviewAccount {
  name: string;
  /** A picture to show instead of initials. Workspaces have none yet. */
  picture?: string | null;
}

export interface PlatformPreviewProps {
  design: DesignDocument;
  /** The caption to show: the design's own, or the shared one. */
  caption: string;
  /** Makes the caption a field. Without it the caption is read-only text. */
  onCaptionChange?: (caption: string) => void;
  /** Every picture the design draws, by media id. */
  media: Readonly<Record<string, StudioMediaRef>>;
  /** The frames to offer, in the switch's order: the API decides which. */
  platforms: readonly PreviewPlatform[];
  account: PreviewAccount;
  /** The slide to open on, zero-based. */
  startIndex?: number;
  className?: string;
}

/**
 * The platform switch and the frame it picks, for Preview and the share
 * page. The slide on show is kept across a switch, so comparing platforms
 * compares the same slide. With no platform to offer, a sentence says so and
 * the slides are shown in a plain frame, still swipeable and captioned.
 */
export function PlatformPreview({
  design,
  caption,
  onCaptionChange,
  media,
  platforms,
  account,
  startIndex = 0,
  className,
}: PlatformPreviewProps) {
  const slides = useKeptSlides(design);
  const count = slides.slides.length;
  const [chosen, setChosen] = useState<PreviewPlatformId | null>(null);
  const [index, setIndex] = useState(() => clampIndex(startIndex, count));
  const resolveMedia = useMemo(() => mediaResolver(media, 'full'), [media]);
  const active = platforms.find((platform) => platform.id === chosen) ?? platforms[0] ?? null;

  const frame = (platform: PreviewPlatform | null) => (
    <FrameStage format={slides.format}>
      <PlatformFrame
        platform={platform}
        account={account}
        design={slides}
        resolveMedia={resolveMedia}
        index={clampIndex(index, count)}
        onIndexChange={setIndex}
        caption={caption}
        onCaptionChange={onCaptionChange}
      />
    </FrameStage>
  );

  if (!active) {
    return (
      <div className={cn('flex flex-col gap-4', className)}>
        <p className="m-0 font-sans text-sm font-medium text-ink muted-tone">{NO_FRAME_MESSAGE}</p>
        {frame(null)}
      </div>
    );
  }

  return (
    <Tabs
      value={active.id}
      onValueChange={(value) => setChosen(value as PreviewPlatformId)}
      className={cn('flex flex-col gap-4', className)}
    >
      <TabsList aria-label="Platform" className={cn(SEGMENTED_LIST, 'max-w-full self-center')}>
        {platforms.map((platform) => (
          <TabsTrigger
            key={platform.id}
            value={platform.id}
            data-testid={`preview-platform-${platform.id}`}
            className={cn(SEGMENTED_TRIGGER, 'gap-2')}
          >
            <PlatformIcon platform={platform.id} />
            {/* Logos alone on a phone, so four platforms fit on one row. */}
            <span className="sr-only sm:not-sr-only">{platform.name}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      {platforms.map((platform) => (
        <TabsContent key={platform.id} value={platform.id} className="mt-0">
          {frame(platform)}
        </TabsContent>
      ))}
    </Tabs>
  );
}

/**
 * The design the slides are drawn from: the same object for as long as only
 * the caption changes, so typing the caption leaves every slide alone.
 */
function useKeptSlides(design: DesignDocument): DesignDocument {
  const [kept, setKept] = useState(design);
  const same = sameSlides(kept, design);
  if (!same) setKept(design);
  return same ? kept : design;
}

/** The inset box a frame stands in, the width of a phone's feed. */
function FrameStage({ format, children }: { format: FormatId; children: ReactNode }) {
  return (
    <div className={cn(INSET, 'flex justify-center bg-halftone p-2 sm:p-6')}>
      <div className="min-w-0" style={{ width: frameWidth(format) }}>
        {children}
      </div>
    </div>
  );
}

export interface PlatformFrameProps {
  /** Null draws a plain frame, for a design no platform's feed takes. */
  platform: PreviewPlatform | null;
  account: PreviewAccount;
  /** The design whose slides are drawn. */
  design: DesignDocument;
  resolveMedia: (mediaId: string) => string | null;
  /** The slide on show, zero-based. */
  index: number;
  onIndexChange: (index: number) => void;
  caption: string;
  /** Makes the caption a field. Without it the caption is read-only text. */
  onCaptionChange?: (caption: string) => void;
}

/** One post as one platform shows it: the account, the slides, the caption and the icons. */
export function PlatformFrame({
  platform,
  account,
  design,
  resolveMedia,
  index,
  onIndexChange,
  caption,
  onCaptionChange,
}: PlatformFrameProps) {
  const slides = (mediaClassName?: string) => (
    <SlideCarousel
      design={design}
      resolveMedia={resolveMedia}
      index={index}
      onIndexChange={onIndexChange}
      mediaClassName={mediaClassName}
    />
  );
  const words = onCaptionChange ? (
    <CaptionField platform={platform} caption={caption} onCaptionChange={onCaptionChange} />
  ) : (
    <CaptionText platform={platform} account={account} caption={caption} />
  );

  return (
    <div
      data-testid={`preview-frame-${platform?.id ?? 'plain'}`}
      className="@container overflow-hidden rounded-lg border-2 border-outline shadow-surfaceMd"
    >
      <FrameBody id={platform?.id ?? null} account={account} slides={slides} words={words} />
    </div>
  );
}

const FACEBOOK_ACTIONS: ReadonlyArray<{ icon: LucideIcon; label: string }> = [
  { icon: ThumbsUp, label: 'Like' },
  { icon: MessageCircle, label: 'Comment' },
  { icon: Share2, label: 'Share' },
];

const LINKEDIN_ACTIONS: ReadonlyArray<{ icon: LucideIcon; label: string }> = [
  { icon: ThumbsUp, label: 'Like' },
  { icon: MessageSquare, label: 'Comment' },
  { icon: Repeat2, label: 'Repost' },
  { icon: Send, label: 'Send' },
];

/** Each platform's layout: where the caption, the slides and the icons go. */
function FrameBody({
  id,
  account,
  slides,
  words,
}: {
  id: PreviewPlatformId | null;
  account: PreviewAccount;
  slides: (mediaClassName?: string) => ReactNode;
  words: ReactNode;
}) {
  switch (id) {
    case 'instagram':
      return (
        <article className="bg-bgInstagram font-sans text-sm leading-[18px] text-ink">
          <FrameHeader
            account={account}
            size="sm"
            className="px-3 py-2"
            avatarClassName="ring-2 ring-actionAccent ring-offset-1 ring-offset-bgInstagram"
          />
          {slides()}
          <div aria-hidden="true" className="flex items-center gap-4 px-3 pt-2">
            <Heart className="h-6 w-6" strokeWidth={2} />
            <MessageCircle className="h-6 w-6" strokeWidth={2} />
            <Send className="h-6 w-6" strokeWidth={2} />
            <Bookmark className="ms-auto h-6 w-6" strokeWidth={2} />
          </div>
          <div className="px-3 pt-2 pb-3">{words}</div>
        </article>
      );

    case 'facebook':
      return (
        <article className="bg-bgFacebook font-sans text-[15px] leading-5 text-ink">
          <FrameHeader account={account} className="px-4 pt-3" />
          <div className="px-4 pt-2">{words}</div>
          <div className="mt-3">{slides()}</div>
          <LabelledActions
            actions={FACEBOOK_ACTIONS}
            className="mx-4 mt-1 border-t border-outline/15 py-1 opacity-70"
          />
        </article>
      );

    case 'linkedin':
      return (
        <article className="bg-bgLinkedin font-sans text-sm leading-5 text-ink">
          <FrameHeader account={account} className="px-4 pt-3" />
          <div className="px-4 pt-2">{words}</div>
          <div className="mt-2">{slides()}</div>
          <LabelledActions
            actions={LINKEDIN_ACTIONS}
            className="mx-4 mt-1 border-t border-borderLinkedin py-1 text-textLinkedin"
          />
        </article>
      );

    case 'x':
      return (
        <article className="flex gap-3 bg-secondary px-4 py-3 font-sans text-[15px] leading-5 text-ink">
          <AccountAvatar account={account} />
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-bold">{account.name}</span>
              <PreviewBadge />
            </div>
            <div className="mt-1">{words}</div>
            <div className="mt-3">
              {slides('overflow-hidden rounded-2xl border border-outline/20')}
            </div>
            <div aria-hidden="true" className="mt-2 flex justify-between opacity-60">
              <MessageCircle className="h-4 w-4" strokeWidth={2} />
              <Repeat2 className="h-4 w-4" strokeWidth={2} />
              <Heart className="h-4 w-4" strokeWidth={2} />
              <BarChart2 className="h-4 w-4" strokeWidth={2} />
              <Bookmark className="h-4 w-4" strokeWidth={2} />
              <Share className="h-4 w-4" strokeWidth={2} />
            </div>
          </div>
        </article>
      );

    default:
      return (
        <article className="bg-secondary font-sans text-sm leading-5 text-ink">
          <FrameHeader account={account} size="sm" className="px-3 py-2" />
          {slides()}
          <div className="px-3 pt-2 pb-3">{words}</div>
        </article>
      );
  }
}

/** The account's picture and name, and the Preview badge where the platform's menu would be. */
function FrameHeader({
  account,
  size = 'md',
  className,
  avatarClassName,
}: {
  account: PreviewAccount;
  size?: 'sm' | 'md';
  className?: string;
  avatarClassName?: string;
}) {
  return (
    <header className={cn('flex min-w-0 items-center gap-2', className)}>
      <AccountAvatar account={account} size={size} className={avatarClassName} />
      <span className="min-w-0 flex-1 truncate font-bold">{account.name}</span>
      <PreviewBadge />
    </header>
  );
}

/** Always on the frame (DS-7.1): this is a preview, not a live post. */
function PreviewBadge() {
  return <Badge className="shrink-0">Preview</Badge>;
}

/** Decorative: the name beside it says whose post it is. */
function AccountAvatar({
  account,
  size = 'md',
  className,
}: {
  account: PreviewAccount;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <Avatar aria-hidden="true" size={size} className={className}>
      {account.picture ? <AvatarImage src={account.picture} alt="" /> : null}
      <AvatarFallback colorSeed={account.name}>{initialsOf(account.name)}</AvatarFallback>
    </Avatar>
  );
}

/** A feed's row of named actions, with no counts. Names show once the frame has room. */
function LabelledActions({
  actions,
  className,
}: {
  actions: ReadonlyArray<{ icon: LucideIcon; label: string }>;
  className?: string;
}) {
  return (
    <div aria-hidden="true" className={cn('flex justify-around', className)}>
      {actions.map(({ icon: Icon, label }) => (
        <span key={label} className="flex items-center gap-1.5 px-2 py-2 text-xs font-bold">
          <Icon className="h-4 w-4" strokeWidth={2} />
          <span className="hidden @sm:inline">{label}</span>
        </span>
      ))}
    </div>
  );
}

/** The caption as the share page shows it: read-only, folded where the feed folds it. */
function CaptionText({
  platform,
  account,
  caption,
}: {
  platform: PreviewPlatform | null;
  account: PreviewAccount;
  caption: string;
}) {
  const fold = platform ? CAPTION_FOLDS[platform.id] : undefined;

  return (
    <PreviewText
      text={caption}
      maxLength={platform?.maxLength ?? MAX_CAPTION_LENGTH}
      lengthMethod={platform?.lengthMethod ?? 'utf16'}
      foldAfter={fold?.after}
      moreLabel={fold?.more}
      prefix={
        platform?.id === 'instagram' ? (
          <span className="me-1 font-bold">{account.name}</span>
        ) : undefined
      }
    />
  );
}

/**
 * The caption as Preview edits it (DS-7.2). Each change goes straight to the
 * editor, which keeps it with the design and saves it; Send carries it into
 * the composer.
 */
function CaptionField({
  platform,
  caption,
  onCaptionChange,
}: {
  platform: PreviewPlatform | null;
  caption: string;
  onCaptionChange: (caption: string) => void;
}) {
  const id = useId();
  const count = captionCount(caption, platform);
  const tooLong = count.over && platform ? captionTooLong(platform.name, count.limit) : null;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs">
        Caption
      </Label>
      <Textarea
        id={id}
        value={caption}
        rows={3}
        maxLength={MAX_CAPTION_LENGTH}
        placeholder="Enter your caption"
        variant={tooLong ? 'error' : 'default'}
        aria-invalid={tooLong ? true : undefined}
        aria-describedby={`${id}-count ${id}-hint`}
        // Keeps the browser's own undo while typing: the editor's Undo is for the design.
        data-native-undo=""
        onChange={(event) => onCaptionChange(event.target.value)}
        onKeyDown={(event) => event.stopPropagation()}
        className="max-h-64 min-h-20 resize-y p-3 field-sizing-content"
      />
      <div className="flex items-start justify-between gap-3">
        {tooLong ? (
          <FormErrorMessage id={`${id}-hint`}>{tooLong}</FormErrorMessage>
        ) : (
          <FormHelperText id={`${id}-hint`}>{CAPTION_HINT}</FormHelperText>
        )}
        <span
          id={`${id}-count`}
          className={cn(
            'shrink-0 font-sans text-xs font-bold tabular-nums',
            tooLong ? 'text-dangerInk' : 'text-ink muted-tone',
          )}
        >
          {count.text}
          <span className="sr-only"> characters</span>
        </span>
      </div>
    </div>
  );
}

interface SlideCarouselProps {
  design: DesignDocument;
  resolveMedia: (mediaId: string) => string | null;
  index: number;
  onIndexChange: (index: number) => void;
  /**
   * On the box that clips the slides (X's rounded media box). Never on the
   * arrows' box: on a phone they sit below the slides, where a clip would cut them off.
   */
  mediaClassName?: string;
}

/** A drag in progress: where it started, and which way it turned out to go. */
interface Gesture {
  pointer: number;
  x: number;
  y: number;
  at: number;
  width: number;
  axis: SwipeAxis | null;
}

/**
 * The slides, one at a time, after the WAI-ARIA carousel pattern: a named
 * carousel of slides named "2 of 5", only the one on show reachable, and a
 * polite announcement as it turns. A drag that goes up or down is left to
 * the page to scroll; one that goes sideways follows the finger and turns
 * the slide once it is long or quick enough.
 */
const SlideCarousel = memo(function SlideCarousel({
  design,
  resolveMedia,
  index,
  onIndexChange,
  mediaClassName,
}: SlideCarouselProps) {
  const count = design.slides.length;
  const current = clampIndex(index, count);
  const many = count > 1;
  const [drawn, setDrawn] = useState(() => drawnAround(new Set<number>(), current, count));
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const dots = useRef<HTMLDivElement>(null);
  // Set when an arrow key turned the slide from a dot: focus then follows to the new one.
  const dotFocus = useRef(false);

  const reach = drawnAround(drawn, current, count);
  if (reach !== drawn) setDrawn(reach);

  // Only the dot of the slide on show is in the tab order (a roving tab
  // stop), so twenty slides are not twenty presses of Tab.
  useEffect(() => {
    if (!dotFocus.current) return;
    dotFocus.current = false;
    dots.current?.querySelectorAll<HTMLElement>('[data-slide-dot]')[current]?.focus();
  }, [current]);

  const spec = FORMATS[design.format];
  const ratio = `${spec.width} / ${spec.height}`;
  const go = (target: number) => onIndexChange(clampIndex(target, count));

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!many || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

    const target =
      event.key === 'ArrowLeft'
        ? current - 1
        : event.key === 'ArrowRight'
          ? current + 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? count - 1
              : null;
    if (target === null) return;

    event.preventDefault();
    event.stopPropagation();

    const next = clampIndex(target, count);
    if (next === current) return;
    dotFocus.current =
      event.target instanceof HTMLElement && event.target.hasAttribute('data-slide-dot');
    go(next);
  }

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (!many || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;

    gesture.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      at: event.timeStamp,
      width: event.currentTarget.clientWidth,
      axis: null,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;

    const dx = event.clientX - active.x;
    if (active.axis === null) {
      active.axis = swipeAxis(dx, event.clientY - active.y);
      if (active.axis === null) return;
      if (active.axis === 'y') {
        // Up and down belongs to the page: let it scroll.
        gesture.current = null;
        return;
      }
      try {
        // Sideways is ours: keep following the pointer even off the slide.
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // The pointer is already gone; its pointerup or pointercancel still ends the drag.
      }
      setDragging(true);
    }

    setOffset(dragOffset(dx, current, count, active.width));
  }

  function onPointerEnd(event: PointerEvent<HTMLElement>) {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;

    gesture.current = null;
    if (active.axis !== 'x') return;

    setDragging(false);
    setOffset(0);
    if (event.type === 'pointerup') {
      const elapsed = event.timeStamp - active.at;
      go(swipeTarget(current, count, event.clientX - active.x, elapsed, active.width));
    }
  }

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Slides"
      // Up and down stays the page's scroll, and pinching still zooms in on
      // a slide's small print; sideways is the carousel's.
      className="touch-pan-y touch-pinch-zoom select-none"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      // A mouse drag turns slides; it must not pick up a picture instead.
      onDragStart={(event) => event.preventDefault()}
    >
      <div className="relative">
        <div
          className={cn(
            'overflow-hidden',
            mediaClassName,
            many && 'cursor-grab active:cursor-grabbing',
          )}
        >
          <div
            className={cn(
              'flex',
              !dragging &&
                'transition-transform duration-300 ease-out motion-reduce:transition-none',
            )}
            style={{ transform: `translate3d(calc(${current * -100}% + ${offset}px), 0, 0)` }}
          >
            {design.slides.map((slide, slideIndex) => (
              // biome-ignore lint/a11y/useSemanticElements: a carousel slide is a div[role=group] (the WAI-ARIA carousel pattern), not a form fieldset
              <div
                key={slide.id}
                role="group"
                aria-roledescription="slide"
                aria-label={`${slideIndex + 1} of ${count}`}
                inert={slideIndex !== current}
                className="w-full shrink-0"
              >
                <CarouselSlide
                  design={design}
                  index={slideIndex}
                  resolveMedia={resolveMedia}
                  drawn={reach.has(slideIndex)}
                  ratio={ratio}
                />
              </div>
            ))}
          </div>
        </div>

        {many ? (
          <>
            <StepButton
              direction="previous"
              disabled={current === 0}
              onStep={() => go(current - 1)}
            />
            <StepButton
              direction="next"
              disabled={current === count - 1}
              onStep={() => go(current + 1)}
            />
          </>
        ) : null}
      </div>

      {many ? (
        // On a phone the arrows sit at either end of this row (`StepButton`), so it
        // is as tall as they are and keeps the dots clear of them.
        <div
          ref={dots}
          className="flex min-h-8 flex-wrap items-center justify-center px-9 sm:min-h-0 sm:px-2 sm:pt-1"
        >
          {design.slides.map((slide, slideIndex) => {
            const shown = slideIndex === current;

            return (
              <button
                key={slide.id}
                type="button"
                data-slide-dot=""
                tabIndex={shown ? 0 : -1}
                aria-label={`Go to slide ${slideIndex + 1}`}
                aria-current={shown ? 'true' : undefined}
                onClick={() => go(slideIndex)}
                className={cn('group flex h-6 w-6 items-center justify-center rounded-full', FOCUS)}
              >
                {/* The slide on show is bigger and outlined, not only another colour.
                    Ink, the frame's text colour, reads on its ground in every theme;
                    the outline colour is near-black in dark mode too. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'block rounded-full transition-[width,height] duration-150 motion-reduce:transition-none',
                    shown
                      ? 'h-2.5 w-2.5 border-2 border-ink bg-actionPrimary'
                      : 'h-2 w-2 bg-ink/60 group-hover:bg-ink/85',
                  )}
                />
              </button>
            );
          })}
        </div>
      ) : null}

      {many ? (
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          Slide {current + 1} of {count}
        </p>
      ) : null}
    </section>
  );
});

/**
 * One slide, drawn once it is near the one on show, and left alone while
 * only the caption or a drag changes. Its words follow it for a screen
 * reader, since the slide is drawn as a picture.
 */
const CarouselSlide = memo(function CarouselSlide({
  design,
  index,
  resolveMedia,
  drawn,
  ratio,
}: {
  design: DesignDocument;
  index: number;
  resolveMedia: (mediaId: string) => string | null;
  drawn: boolean;
  /** The format's shape, so an undrawn slide holds its place. */
  ratio: string;
}) {
  const words = useMemo(() => slideWords(design, index), [design, index]);

  return (
    <>
      {drawn ? (
        <SlideFrame design={design} index={index} resolveMedia={resolveMedia} />
      ) : (
        <div className="w-full" style={{ aspectRatio: ratio }} />
      )}
      {words.length > 0 ? (
        <div className="sr-only">
          {words.map((word, wordIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a slide's words are a fixed list in layout order; order is identity.
            <p key={wordIndex}>{word}</p>
          ))}
        </div>
      ) : null}
    </>
  );
});

/**
 * An arrow over the slide, or on a phone below it at either end of the dots,
 * where it does not cover the slide's own edges. At either end of the
 * carousel it stays in place, faded and marked unavailable rather than
 * disabled, so a keyboard user's focus is not dropped when the last slide
 * comes up.
 */
function StepButton({
  direction,
  disabled,
  onStep,
}: {
  direction: 'previous' | 'next';
  disabled: boolean;
  onStep: () => void;
}) {
  const previous = direction === 'previous';

  return (
    <button
      type="button"
      data-slide-step={direction}
      aria-label={previous ? 'Previous slide' : 'Next slide'}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onStep();
      }}
      className={cn(
        // Centred with `top`, not a translate: the press moves the button by `translate`.
        'absolute top-full flex h-8 w-8 items-center justify-center rounded-full border-2 border-outline bg-secondary text-ink sm:top-[calc(50%-1rem)]',
        // Flush with the slide's edges below it, so the narrow X frame keeps five dots on one line.
        previous ? 'start-0 sm:start-2' : 'end-0 sm:end-2',
        // The design system's disabled look: half opacity, and no shadow to press.
        disabled ? 'cursor-default opacity-50' : pressSm,
        FOCUS,
      )}
    >
      <MotionIcon icon={previous ? ChevronLeftIcon : ChevronRightIcon} className="h-4 w-4" />
    </button>
  );
}
