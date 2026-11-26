'use client';

/**
 * A clip on the Clips tab's grid and in Recent Clips (Module 07, section 5;
 * blueprint section 4): the poster in the clip's own shape, a muted preview
 * of the clip's part on hover, the name (renamed in place), "0:42, 9:16",
 * the state, the video it came from, **Edit** and the menu. A Find Clips
 * pick (Module 16) also shows its score and its first reason.
 *
 * The poster is one filmstrip tile cut out of its sheet with CSS only (no new
 * file): a frame in the tile's shape covers the clip's shape, and the sheet
 * sits inside it at the tile's place. The hover preview plays the clip's part
 * of the light copy, silent, and never when the person asked for less motion
 * or the address has expired.
 */
import { Badge, cn } from '@postgear/ui';
import { Film } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ClipListItem, ClipPoster, ClipPreview } from '@/types/clips';
import { ExportRing } from '../export-ring';
import { PrimaryLink } from '../button-link';
import { PLATFORM_LABELS } from '../home/home-model';
import { reasonLabels, scoreText } from '../video/find-clips-model';
import { clipEditHref, clipFacts } from '../video/video-clip-list';
import {
  CLIP_STATE_BADGE,
  CLIP_STATE_NAMES,
  type ClipActions,
  ClipMenu,
  RenameField,
} from './clip-actions';
import { isAiOrigin } from '@/types/clips';

/** "9:16" to 0.5625; anything unreadable is 9:16, the default shape. */
export function ratioValue(ratio: string): number {
  const [w, h] = ratio.split(':').map(Number);
  return w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h) ? w / h : 9 / 16;
}

/** The tile cut out of its sheet, covering a box of `boxRatio` (width over height). */
export function posterLayout(poster: ClipPoster, boxRatio: number) {
  const tileRatio = poster.width / Math.max(1, poster.height);
  // The tile frame covers the box: as tall as the box when the tile is wider, else as wide.
  const frame =
    tileRatio >= boxRatio
      ? { height: '100%', width: `${(tileRatio / boxRatio) * 100}%` }
      : { width: '100%', height: `${(boxRatio / tileRatio) * 100}%` };
  const image = {
    width: `${(poster.sheetWidth / poster.width) * 100}%`,
    height: `${(poster.sheetHeight / poster.height) * 100}%`,
    left: `${(-poster.x / poster.width) * 100}%`,
    top: `${(-poster.y / poster.height) * 100}%`,
  };
  return { frame, image };
}

function prefersLessMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

function usable(preview: ClipPreview | null): preview is ClipPreview {
  if (!preview || !(preview.toMs > preview.fromMs)) return false;
  const expires = Date.parse(preview.expiresAt);
  return Number.isNaN(expires) || expires > Date.now() + 5_000;
}

/** The clip's part of the light copy, silent, looping while the pointer stays. */
function HoverPreview({ preview }: { preview: ClipPreview }) {
  const video = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const node = video.current;
    if (!node) return;
    const start = preview.fromMs / 1000;
    const end = preview.toMs / 1000;
    const onMeta = () => {
      node.currentTime = start;
      void node.play().catch(() => undefined);
    };
    const onTime = () => {
      if (node.currentTime >= end) node.currentTime = start;
    };
    node.addEventListener('loadedmetadata', onMeta);
    node.addEventListener('timeupdate', onTime);
    return () => {
      node.removeEventListener('loadedmetadata', onMeta);
      node.removeEventListener('timeupdate', onTime);
      node.pause();
      node.removeAttribute('src');
      node.load();
    };
  }, [preview]);
  return (
    // Drawn, not read: hidden from screen readers by its wrapper, which makes no box of its own.
    <span aria-hidden="true" className="contents">
      <video
        ref={video}
        src={preview.url}
        muted
        playsInline
        preload="metadata"
        className="absolute inset-0 h-full w-full object-cover"
      />
    </span>
  );
}

export function ClipPosterBox({
  clip,
  previewing,
  className,
}: {
  clip: Pick<ClipListItem, 'ratio' | 'poster' | 'preview'>;
  previewing: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const ratio = ratioValue(clip.ratio);
  const poster = clip.poster && !failed ? clip.poster : null;
  const layout = poster ? posterLayout(poster, ratio) : null;

  return (
    <div
      className={cn(
        'relative flex items-center justify-center overflow-hidden rounded-sm border-2 border-outline bg-secondary',
        className,
      )}
      // The largest box of the clip's shape that fits its area (a size container).
      style={{ aspectRatio: `${ratio}`, width: `min(100cqw, ${ratio * 100}cqh)` }}
    >
      {poster && layout ? (
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden"
          style={layout.frame}
        >
          {/* biome-ignore lint/performance/noImgElement: a signed sprite sheet cut with CSS, never optimised through our server */}
          <img
            src={poster.url}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setFailed(true)}
            className="absolute max-w-none"
            style={layout.image}
          />
        </div>
      ) : (
        <Film className="h-6 w-6 text-ink" strokeWidth={2.5} aria-hidden="true" />
      )}
      {previewing && usable(clip.preview) ? <HoverPreview preview={clip.preview} /> : null}
    </div>
  );
}

export function ClipCard({
  clip,
  orgId,
  actions,
  className,
}: {
  clip: ClipListItem;
  orgId: string;
  actions: ClipActions;
  className?: string;
}) {
  const [renaming, setRenaming] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const isAi = isAiOrigin(clip.origin);
  const score = isAi ? scoreText(clip.score) : null;
  const firstReason = isAi ? (reasonLabels(clip.reasons ?? [])[0] ?? null) : null;

  return (
    <li
      data-testid="clip-card"
      data-state={clip.state}
      className={cn(
        'flex min-w-0 animate-fadeIn flex-col overflow-hidden rounded-card border-2 border-outline bg-secondary shadow-surfaceSm motion-reduce:animate-none',
        clip.state === 'hidden' && 'border-dashed',
        className,
      )}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse' && !prefersLessMotion()) setPreviewing(true);
      }}
      onPointerLeave={() => setPreviewing(false)}
    >
      <div className="relative border-b-2 border-outline bg-inset p-3">
        <div className="flex h-50 items-center justify-center" style={{ containerType: 'size' }}>
          <ClipPosterBox clip={clip} previewing={previewing} />
        </div>
        {clip.exportProgress !== null ? (
          <span
            role="img"
            aria-label={`Exporting, ${Math.round(clip.exportProgress)}% done`}
            title={`Exporting, ${Math.round(clip.exportProgress)}% done`}
            data-testid="clip-card-exporting"
            className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-outline bg-secondary text-ink"
          >
            <ExportRing progress={clip.exportProgress} className="h-5 w-5 -rotate-90" />
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        {renaming ? (
          <RenameField
            title={clip.title}
            onSave={(title) => actions.rename(clip, title)}
            onDone={() => setRenaming(false)}
          />
        ) : (
          <p className="m-0 line-clamp-2 font-sans text-sm text-ink type-ui" title={clip.title}>
            {clip.title}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {score !== null ? (
            <Badge variant="outline" data-testid="clip-score">
              <span className="sr-only">Score </span>
              {score}
            </Badge>
          ) : null}
          <span className="font-sans text-xs text-ink tabular-nums type-muted">
            {clipFacts(clip)}
          </span>
          <Badge variant={CLIP_STATE_BADGE[clip.state]}>{CLIP_STATE_NAMES[clip.state]}</Badge>
        </div>
        {firstReason ? (
          <p className="m-0 font-sans text-xs text-ink type-muted" data-testid="clip-reason">
            {firstReason}
          </p>
        ) : null}
        <p className="m-0 truncate font-sans text-xs text-ink type-muted" title={clip.videoTitle}>
          {PLATFORM_LABELS[clip.platform]}, {clip.videoTitle}
        </p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <PrimaryLink href={clipEditHref(orgId, clip.id)}>Edit</PrimaryLink>
          <ClipMenu clip={clip} actions={actions} onStartRename={() => setRenaming(true)} />
        </div>
      </div>
    </li>
  );
}
