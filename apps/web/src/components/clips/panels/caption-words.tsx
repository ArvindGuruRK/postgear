'use client';

/**
 * The words of a clip's captions, to fix in place (Sprint 13, Module 03).
 *
 * Words are grouped as the captions page them. Pressing a word opens it:
 * type the right word and press Enter (this clip only), hide it from this
 * clip, or, for words that were listened to, fix it everywhere in the video
 * (Replace Everywhere). A word the listener was unsure of has a dotted
 * underline until it is changed; a hidden word is struck through and can be
 * shown again. Pressing a group's time jumps the clip there.
 *
 * The list never edits the document: each change is handed up as one undo
 * step.
 */
import { EyeIcon } from '@animateicons/react/lucide/eye-icon';
import { EyeOffIcon } from '@animateicons/react/lucide/eye-off-icon';
import { Button, cn, Input, MotionIcon, TooltipHint } from '@postgear/ui';
import { formatTimecode } from '@postgear/video-engine';
import { type FormEvent, useId, useState } from 'react';
import {
  type WordChip,
  type WordGroup,
  WORD_PLACEHOLDER,
} from './captions-model';

export interface CaptionWordsProps {
  groups: readonly WordGroup[];
  /** Whether a fix can be made for the whole video (words that were listened to). */
  canReplaceEverywhere: boolean;
  /** Something is being saved: the fields wait. */
  busy: boolean;
  onSeek: (ms: number) => void;
  onText: (index: number, text: string) => void;
  onHidden: (index: number, hidden: boolean) => void;
  /** Resolves to how many words changed, or null when it was refused. */
  onReplaceEverywhere: (from: string, to: string) => Promise<number | null>;
}

/** The word without the punctuation around it: what Replace Everywhere looks for. */
function bareWord(text: string): string {
  return text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function OpenWord({
  chip,
  canReplaceEverywhere,
  busy,
  onClose,
  onText,
  onHidden,
  onReplaceEverywhere,
}: {
  chip: WordChip;
  onClose: () => void;
} & Pick<
  CaptionWordsProps,
  'canReplaceEverywhere' | 'busy' | 'onText' | 'onHidden' | 'onReplaceEverywhere'
>) {
  const fieldId = useId();
  const [value, setValue] = useState(chip.changed ? chip.shown : chip.heard);
  const [said, setSaid] = useState<string | null>(null);
  const typed = value.replace(/\s+/g, ' ').trim();
  const from = bareWord(chip.heard);
  const to = bareWord(typed);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (typed.length === 0) return;
    onText(chip.index, typed);
    onClose();
  }

  async function everywhere() {
    if (from.length === 0 || to.length === 0 || from === to) return;
    const changed = await onReplaceEverywhere(from, to);
    if (changed === null) return;
    setSaid(
      changed === 1 ? 'Changed 1 word in this video.' : `Changed ${changed} words in this video.`,
    );
    // This clip's own change would hide the video-wide fix: it goes.
    onText(chip.index, '');
  }

  return (
    <form
      onSubmit={submit}
      className="flex w-full flex-col gap-2 rounded-md border-2 border-outline bg-inset p-2"
      data-testid="clip-caption-word-open"
    >
      <label htmlFor={fieldId} className="sr-only">
        The word shown
      </label>
      <Input
        id={fieldId}
        value={value}
        maxLength={80}
        disabled={busy}
        placeholder={WORD_PLACEHOLDER}
        onChange={(event) => setValue(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
        autoFocus
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || typed.length === 0}>
          Save
        </Button>
        {canReplaceEverywhere ? (
          <TooltipHint label={`Change "${from}" to this wherever it was heard in the video`}>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy || to.length === 0 || from.length === 0 || from === to}
              onClick={everywhere}
            >
              Replace Everywhere
            </Button>
          </TooltipHint>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            onHidden(chip.index, !chip.hidden);
            onClose();
          }}
        >
          <MotionIcon icon={chip.hidden ? EyeIcon : EyeOffIcon} className="h-4 w-4" />
          {chip.hidden ? 'Show Word' : 'Hide Word'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {chip.changed ? (
        <p className="m-0 font-sans text-xs text-ink type-muted">
          {`Heard as "${chip.heard}".`}{' '}
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 font-sans text-xs text-ink underline"
            onClick={() => {
              onText(chip.index, '');
              onClose();
            }}
          >
            Use It Again
          </button>
        </p>
      ) : null}
      {said ? (
        <p role="status" className="m-0 font-sans text-xs text-ink">
          {said}
        </p>
      ) : null}
    </form>
  );
}

export function CaptionWords({
  groups,
  canReplaceEverywhere,
  busy,
  onSeek,
  onText,
  onHidden,
  onReplaceEverywhere,
}: CaptionWordsProps) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0" data-testid="clip-caption-words">
      {groups.map((group) => {
        const opened = group.words.find((chip) => chip.index === open) ?? null;
        return (
          <li key={group.key} className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2">
              <button
                type="button"
                onClick={() => onSeek(group.startMs)}
                aria-label={`Go to ${formatTimecode(group.startMs)}`}
                className="shrink-0 cursor-pointer border-0 bg-transparent p-0 font-sans text-xs tabular-nums text-ink type-muted hover:underline"
              >
                {formatTimecode(group.startMs)}
              </button>
              <div className="flex min-w-0 flex-wrap gap-x-1 gap-y-1">
                {group.words.map((chip) => (
                  <button
                    key={chip.index}
                    type="button"
                    aria-expanded={chip.index === open}
                    aria-label={
                      chip.hidden
                        ? `${chip.heard}, hidden`
                        : chip.unsure
                          ? `${chip.shown}, not sure`
                          : chip.shown
                    }
                    data-testid="clip-caption-word"
                    data-state={chip.hidden ? 'hidden' : chip.unsure ? 'unsure' : 'plain'}
                    onClick={() => setOpen(chip.index === open ? null : chip.index)}
                    className={cn(
                      'cursor-pointer rounded-sm border-0 bg-transparent px-1 py-0.5 font-sans text-sm text-ink hover:bg-inset',
                      chip.index === open && 'bg-inset',
                      chip.hidden && 'line-through type-muted',
                      chip.unsure &&
                        !chip.hidden &&
                        'underline decoration-dotted decoration-2 underline-offset-4',
                      chip.changed && !chip.hidden && 'font-bold',
                    )}
                  >
                    {chip.hidden ? chip.heard : chip.shown}
                  </button>
                ))}
              </div>
            </div>
            {opened ? (
              <OpenWord
                key={opened.index}
                chip={opened}
                canReplaceEverywhere={canReplaceEverywhere}
                busy={busy}
                onClose={() => setOpen(null)}
                onText={onText}
                onHidden={onHidden}
                onReplaceEverywhere={onReplaceEverywhere}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
