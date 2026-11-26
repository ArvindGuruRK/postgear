'use client';

/**
 * The clips cut from this video (Module 07, section 3; Module 16), in the
 * right column. Find Clips' picks come first, best first, each with its
 * score and up to three reasons in words; the clips made by hand follow
 * under their own group name. Every row has its name (renamed in place),
 * "0:42, 9:16", its state, **Play** (just that part, in the player above,
 * then it stops), **Edit** and the menu (Rename, Duplicate, Hide, Delete
 * Clip). Choosing a clip marks its line on the timeline.
 */
import { PlayIcon } from '@animateicons/react/lucide/play-icon';
import { Badge, Button, cn, MotionIcon, TooltipHint } from '@postgear/ui';
import { formatClipLength } from '@postgear/video-engine';
import { useId, useState } from 'react';
import { GroupLabel } from '@/components/studio/panel-ui';
import type { ClipSummary } from '@/types/clips';
import { PrimaryLink } from '../button-link';
import {
  CLIP_STATE_BADGE,
  CLIP_STATE_NAMES,
  type ClipActions,
  ClipMenu,
  RenameField,
} from '../library/clip-actions';
import { HAND_MADE_GROUP, orderClips, reasonLabels, scoreText } from './find-clips-model';
import { isAiOrigin } from '@/types/clips';

export const NO_CLIPS_YET = 'No clips yet.';

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
  const handId = useId();

  if (clips.length === 0) {
    return <p className="m-0 font-sans text-sm text-ink type-muted">{NO_CLIPS_YET}</p>;
  }

  const { ai, manual } = orderClips(clips);
  const row = (clip: ClipSummary) => (
    <ClipRow
      key={clip.id}
      orgId={orgId}
      clip={clip}
      selected={clip.id === selectedId}
      renaming={renaming === clip.id}
      actions={actions}
      onSelect={onSelect}
      onPlay={onPlay}
      onStartRename={() => setRenaming(clip.id)}
      onRenameDone={() => setRenaming(null)}
    />
  );

  if (ai.length === 0) {
    return (
      <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Clips from this video">
        {manual.map(row)}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Clips found by AI">
        {ai.map(row)}
      </ul>
      {manual.length > 0 ? (
        <div className="flex flex-col gap-2">
          <GroupLabel id={handId}>{HAND_MADE_GROUP}</GroupLabel>
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-labelledby={handId}>
            {manual.map(row)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ClipRow({
  orgId,
  clip,
  selected,
  renaming,
  actions,
  onSelect,
  onPlay,
  onStartRename,
  onRenameDone,
}: {
  orgId: string;
  clip: ClipSummary;
  selected: boolean;
  renaming: boolean;
  actions: ClipActions;
  onSelect: (clip: ClipSummary) => void;
  onPlay: (clip: ClipSummary) => void;
  onStartRename: () => void;
  onRenameDone: () => void;
}) {
  const isAi = isAiOrigin(clip.origin);
  const score = isAi ? scoreText(clip.score) : null;
  const reasons = isAi ? reasonLabels(clip.reasons ?? []) : [];

  return (
    <li
      data-testid="video-clip-row"
      data-state={clip.state}
      data-origin={clip.origin}
      className={cn(
        'flex flex-col gap-1.5 rounded-md border-2 border-outline bg-inset p-2',
        selected && 'ring-2 ring-actionPrimary',
        clip.state === 'hidden' && 'border-dashed',
      )}
    >
      {/* The name has the whole width (an AI pick shares it with its score): clips of one video share the start of their names. */}
      {renaming ? (
        <RenameField
          title={clip.title}
          onSave={(title) => actions.rename(clip, title)}
          onDone={onRenameDone}
        />
      ) : score !== null ? (
        <div className="flex items-start gap-2">
          <ClipName clip={clip} onSelect={onSelect} className="flex-1" />
          <Badge variant="outline" className="shrink-0" data-testid="video-clip-score">
            <span className="sr-only">Score </span>
            {score}
          </Badge>
        </div>
      ) : (
        <ClipName clip={clip} onSelect={onSelect} />
      )}
      {reasons.length > 0 ? (
        <p className="m-0 font-sans text-xs text-ink type-muted" data-testid="video-clip-reasons">
          {reasons.join(', ')}
        </p>
      ) : null}
      {isAi && clip.seen ? (
        <p className="m-0 font-sans text-xs text-ink type-muted" data-testid="video-clip-seen">
          {clip.seen}
        </p>
      ) : null}
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 whitespace-nowrap font-sans text-xs text-ink tabular-nums type-muted">
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
        <ClipMenu clip={clip} actions={actions} onStartRename={onStartRename} />
      </div>
    </li>
  );
}

function ClipName({
  clip,
  onSelect,
  className,
}: {
  clip: ClipSummary;
  onSelect: (clip: ClipSummary) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(clip)}
      className={cn(
        'line-clamp-2 min-w-0 break-words rounded-sm text-left font-sans text-sm text-ink type-ui outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
        className,
      )}
      title={clip.title}
    >
      {clip.title}
    </button>
  );
}
