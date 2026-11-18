'use client';

/**
 * The clips cut from this video (Module 07, section 3), in the right
 * column: each with its name (renamed in place), "0:42, 9:16", its state,
 * **Play** (just that part, in the player above, then it stops), **Edit**
 * and the menu. Choosing a clip marks its line on the timeline.
 */
import { PlayIcon } from '@animateicons/react/lucide/play-icon';
import { Badge, Button, cn, MotionIcon, TooltipHint } from '@postgear/ui';
import { formatClipLength } from '@postgear/video-engine';
import { useState } from 'react';
import type { ClipSummary } from '@/types/clips';
import { PrimaryLink } from '../button-link';
import {
  CLIP_STATE_BADGE,
  CLIP_STATE_NAMES,
  type ClipActions,
  ClipMenu,
  RenameField,
} from '../library/clip-actions';

export const NO_CLIPS_YET = 'No clips yet. Mark a part with I and O, then press Create Clip.';

export function clipFacts(clip: Pick<ClipSummary, 'durationMs' | 'ratio'>): string {
  return `${formatClipLength(clip.durationMs)}, ${clip.ratio}`;
}

export function clipEditHref(orgId: string, clipId: string): string {
  return `/${encodeURIComponent(orgId)}/clips/edit/${encodeURIComponent(clipId)}`;
}

export function VideoClipList({
  orgId,
  clips,
  selectedId,
  actions,
  onSelect,
  onPlay,
}: {
  orgId: string;
  clips: readonly ClipSummary[];
  selectedId: string | null;
  actions: ClipActions;
  onSelect: (clip: ClipSummary) => void;
  onPlay: (clip: ClipSummary) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);

  if (clips.length === 0) {
    return <p className="m-0 font-sans text-sm text-ink type-muted">{NO_CLIPS_YET}</p>;
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Clips from this video">
      {clips.map((clip) => {
        const selected = clip.id === selectedId;
        return (
          <li
            key={clip.id}
            data-testid="video-clip-row"
            data-state={clip.state}
            className={cn(
              'flex flex-col gap-1.5 rounded-md border-2 border-outline bg-inset p-2',
              selected && 'ring-2 ring-actionPrimary',
              clip.state === 'hidden' && 'border-dashed',
            )}
          >
            {/* The name has the whole width: clips of one video share the start of their names. */}
            {renaming === clip.id ? (
              <RenameField
                title={clip.title}
                onSave={(title) => actions.rename(clip, title)}
                onDone={() => setRenaming(null)}
              />
            ) : (
              <button
                type="button"
                onClick={() => onSelect(clip)}
                className="line-clamp-2 min-w-0 break-words rounded-sm text-left font-sans text-sm text-ink type-ui outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
                title={clip.title}
              >
                {clip.title}
              </button>
            )}
            <div className="flex items-center gap-2">
              <span className="font-sans text-xs text-ink tabular-nums type-muted">
                {clipFacts(clip)}
              </span>
              <Badge variant={CLIP_STATE_BADGE[clip.state]}>{CLIP_STATE_NAMES[clip.state]}</Badge>
              <span className="flex-1" />
              <TooltipHint label="Play This Part" disabled={!clip.range}>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Play ${clip.title}`}
                  disabled={!clip.range}
                  onClick={() => onPlay(clip)}
                >
                  <MotionIcon icon={PlayIcon} className="h-4 w-4" />
                </Button>
              </TooltipHint>
              <PrimaryLink href={clipEditHref(orgId, clip.id)}>Edit</PrimaryLink>
              <ClipMenu clip={clip} actions={actions} onStartRename={() => setRenaming(clip.id)} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
