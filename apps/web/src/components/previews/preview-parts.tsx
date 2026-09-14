'use client';

/**
 * The pieces every platform preview is built from.
 *
 * ## Text is rendered as text
 *
 * Every preview shows the output of `renderPlainText` — the exact string the
 * platform will receive — as React text nodes, with `white-space: pre-wrap` for
 * line breaks. The reference renders each preview through
 * `dangerouslySetInnerHTML` from the editor's HTML, which both makes the post
 * body an XSS surface and shows formatting the platform will never display.
 * Here, nothing a person types can become markup, and what the preview shows is
 * what gets posted, down to the Unicode-styled bold.
 *
 * ## Overflow is shown, not just counted
 *
 * Text past the platform's limit is marked in place, so the problem is visible
 * where it is rather than only as a number.
 */
import { type LengthMethod, overflowIndex } from '@postgear/social-core/composer';
import { Avatar, AvatarFallback, AvatarImage, cn } from '@postgear/ui';
import { ImageOff } from 'lucide-react';
import { useState } from 'react';
import type { MediaItem } from '@/types/media';

export interface PreviewChannel {
  name: string;
  /** Handle without the @, when the platform has one. */
  profile: string | null;
  picture: string | null;
}

export interface PreviewPart {
  key: string;
  text: string;
  media: MediaItem[];
}

export interface PlatformPreviewProps {
  channel: PreviewChannel;
  parts: PreviewPart[];
  maxLength: number;
  lengthMethod: LengthMethod;
  /** When it is scheduled — shown where the platform shows a timestamp. */
  publishAt: Date | null;
}

export function ChannelAvatar({
  channel,
  size = 'md',
  className,
}: {
  channel: PreviewChannel;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <Avatar size={size} className={className}>
      {channel.picture ? <AvatarImage src={channel.picture} alt="" /> : null}
      <AvatarFallback>{channel.name.slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

/**
 * Post text with an overflow mark and, optionally, the platform's own fold.
 *
 * `foldAfter` reproduces where a feed truncates with "…see more" — LinkedIn and
 * Instagram hide most of a long post behind it, which is worth knowing when the
 * first line is doing all the work.
 */
export function PreviewText({
  text,
  maxLength,
  lengthMethod,
  foldAfter,
  moreLabel = '…see more',
  prefix,
  className,
}: {
  text: string;
  /** Rendered before the text, outside the count — Instagram's bold handle. */
  prefix?: React.ReactNode;
  maxLength: number;
  lengthMethod: LengthMethod;
  foldAfter?: number;
  moreLabel?: string;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!text) {
    return null;
  }

  const cut = overflowIndex(text, maxLength, lengthMethod);
  const fits = cut === null ? text : text.slice(0, cut);
  const over = cut === null ? '' : text.slice(cut);
  // Text over the limit is never folded: the fold would hide the very mark
  // that shows what needs cutting.
  const folded =
    foldAfter !== undefined && !expanded && cut === null && Array.from(fits).length > foldAfter;

  return (
    <p className={cn('m-0 whitespace-pre-wrap break-words', className)}>
      {prefix}
      {folded ? (
        <>
          {Array.from(fits).slice(0, foldAfter).join('').trimEnd()}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="ms-1 font-semibold opacity-70 outline-none hover:underline focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
          >
            {moreLabel}
          </button>
        </>
      ) : (
        <>
          {fits}
          {over ? (
            <mark
              className="rounded-sm bg-actionDanger text-onActionLight"
              title={`Past the ${maxLength.toLocaleString('en-US')}-character limit — this will not be accepted`}
            >
              {over}
            </mark>
          ) : null}
        </>
      )}
    </p>
  );
}

/**
 * Attached media, laid out the way feeds lay it out.
 *
 * One item fills the width; two sit side by side; three put one large beside
 * two stacked; four and more form a two-by-two grid with the remainder counted
 * on the last tile. That is X's and Facebook's layout and close enough to
 * LinkedIn's that one component serves all three.
 */
export function PreviewMediaGrid({
  media,
  className,
  rounded = 'rounded-2xl',
}: {
  media: MediaItem[];
  className?: string;
  rounded?: string;
}) {
  if (media.length === 0) {
    return null;
  }

  const shown = media.slice(0, 4);
  const hidden = media.length - shown.length;

  if (shown.length === 1) {
    return (
      <div className={cn('overflow-hidden border border-outline/20', rounded, className)}>
        <PreviewMediaItem item={shown[0]} className="max-h-[32rem] w-full object-cover" natural />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'grid aspect-video gap-0.5 overflow-hidden border border-outline/20',
        rounded,
        shown.length === 2 ? 'grid-cols-2' : 'grid-cols-2 grid-rows-2',
        className,
      )}
    >
      {shown.map((item, index) => (
        <div
          key={item.id}
          className={cn(
            'relative min-h-0 overflow-hidden',
            shown.length === 3 && index === 0 && 'row-span-2',
          )}
        >
          <PreviewMediaItem item={item} className="h-full w-full object-cover" />
          {hidden > 0 && index === shown.length - 1 ? (
            <span className="absolute inset-0 flex items-center justify-center bg-plate/60 font-sans text-2xl font-bold text-onPlate">
              +{hidden}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function PreviewMediaItem({
  item,
  className,
  natural,
}: {
  item: MediaItem;
  className?: string;
  natural?: boolean;
}) {
  if (item.type === 'video') {
    return (
      <video
        src={item.url}
        className={className}
        controls
        muted
        playsInline
        preload="metadata"
        aria-label={item.name}
      />
    );
  }

  return (
    // biome-ignore lint/performance/noImgElement: previews show the stored file exactly, not an optimized derivative of it
    <img
      src={natural ? item.url : (item.thumbnailUrl ?? item.url)}
      alt={item.name}
      className={className}
      width={item.width ?? undefined}
      height={item.height ?? undefined}
    />
  );
}

/** Shown where a platform needs media the post does not have yet. */
export function MissingMedia({ label, className }: { label: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 border-2 border-dashed border-outline/40 p-6 text-center font-sans text-sm opacity-70',
        className,
      )}
    >
      <ImageOff className="h-6 w-6" strokeWidth={2.5} />
      {label}
    </div>
  );
}

/** "Oct 1" — or "Now" for an unscheduled post. */
export function shortDate(date: Date | null): string {
  return date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Now';
}

export function handleOf(channel: PreviewChannel): string {
  return channel.profile ? `@${channel.profile}` : channel.name;
}
