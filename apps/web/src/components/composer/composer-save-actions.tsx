'use client';

/**
 * The composer footer's save buttons, the right-hand end of its last row.
 *
 * Everyone else gets Save As Draft and the reference's split button: the main
 * action ("Add to calendar", "Schedule", "Update") and a chevron for Post Now.
 *
 * An Editor (Sprint 13, Module 14) saves drafts only, so the split button is
 * not drawn. Save As Draft becomes the one main action, and where the split
 * button stood a faded "Add To Calendar" says why there is none: it is a real
 * button, so it can be focused and hovered, but marked `aria-disabled`, with
 * the sentence as its description and its tooltip. A disabled button would
 * take no pointer and show no tooltip. The API refuses the same thing with
 * the same sentence (`editor_forbidden`).
 */
import { ChevronDownIcon } from '@animateicons/react/lucide/chevron-down-icon';
import { SendIcon } from '@animateicons/react/lucide/send-icon';
import { EDITOR_FORBIDDEN_SENTENCE } from '@postgear/entitlements';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MotionIcon,
  TooltipHint,
} from '@postgear/ui';
import { Lock } from 'lucide-react';
import { useId } from 'react';

const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

export interface SaveActionsProps {
  /** An Editor: Save As Draft only, and the reason in place of scheduling. */
  draftsOnly: boolean;
  /** Which save is in flight. */
  saving: 'DRAFT' | 'QUEUE' | 'NOW' | null;
  locked: boolean;
  noChannels: boolean;
  /** The post is on the calendar: the draft button takes it back to drafts. */
  queued: boolean;
  /** The main button's words: see the composer's `primaryLabel`. */
  primaryLabel: string;
  onSaveDraft: () => void;
  onSchedule: () => void;
  onPostNow: () => void;
}

export function SaveActions({
  draftsOnly,
  saving,
  locked,
  noChannels,
  queued,
  primaryLabel,
  onSaveDraft,
  onSchedule,
  onPostNow,
}: SaveActionsProps) {
  const busy = saving !== null;
  const off = busy || locked || noChannels;

  if (draftsOnly) {
    return (
      <div className="flex items-center gap-2 sm:gap-3">
        <Button onClick={onSaveDraft} disabled={off} className="px-4 sm:px-6">
          {saving === 'DRAFT' ? 'Saving…' : 'Save As Draft'}
        </Button>
        <EditorScheduleHint />
      </div>
    );
  }

  return (
    // Nothing to save until there is somewhere to post it: the main button
    // says so, the reference's "check the circles above".
    <div className="flex items-center gap-2 sm:gap-3">
      <Button variant="secondary" onClick={onSaveDraft} disabled={off} className="px-4 sm:px-6">
        {saving === 'DRAFT' ? 'Saving…' : queued ? 'Move To Drafts' : 'Save As Draft'}
      </Button>

      {/* The reference's split button: the main action, and a chevron for
          publishing at once. */}
      <div className="flex">
        <Button
          onClick={onSchedule}
          disabled={off}
          className="rounded-e-none px-4 sm:min-w-40 sm:px-6"
        >
          {primaryLabel}
        </Button>
        <DropdownMenu modal>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="More ways to publish"
              disabled={off}
              className="rounded-s-none border-s-0 px-2.5"
            >
              <MotionIcon icon={ChevronDownIcon} strokeWidth={3} className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="w-44">
            <DropdownMenuItem onSelect={onPostNow}>
              <MotionIcon icon={SendIcon} className="h-4 w-4" />
              Post Now
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** Where scheduling would be, for an Editor: faded, focusable, and saying why. */
function EditorScheduleHint() {
  const reason = useId();

  return (
    <>
      <TooltipHint label={EDITOR_FORBIDDEN_SENTENCE} side="top" align="end">
        <button
          type="button"
          aria-label="Add To Calendar"
          aria-disabled="true"
          aria-describedby={reason}
          data-testid="composer-editor-hint"
          // Marked disabled, so it does nothing; the click is swallowed rather
          // than ignored so a form around it can never submit.
          onClick={(event) => event.preventDefault()}
          className={cn(
            'flex h-11 cursor-not-allowed items-center gap-2 rounded-md px-2 type-ui text-sm text-ink opacity-50',
            FOCUS,
          )}
        >
          <Lock className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <span aria-hidden="true" className="hidden sm:inline">
            Add To Calendar
          </span>
        </button>
      </TooltipHint>
      <span id={reason} className="sr-only">
        {EDITOR_FORBIDDEN_SENTENCE}
      </span>
    </>
  );
}
