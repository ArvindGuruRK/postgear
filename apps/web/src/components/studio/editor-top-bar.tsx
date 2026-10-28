'use client';

/**
 * The editor's action row (Sprint 9, Screen 4): the way back, the design's
 * name (click to rename, DS-6.4), the save status (DS-6.1), then Undo and
 * Redo, Reset, Preview, Share, Export and Send To Composer.
 *
 * The name is the document's, like a file name, not a page title: the top
 * bar above still says Design Studio. Below `lg` the slide rail and the
 * properties panel are drawers, opened from the two buttons at the end.
 */
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { DownloadIcon } from '@animateicons/react/lucide/download-icon';
import { EyeIcon } from '@animateicons/react/lucide/eye-icon';
import { LayersIcon } from '@animateicons/react/lucide/layers-icon';
import { RedoIcon } from '@animateicons/react/lucide/redo-icon';
import { RotateCcwIcon } from '@animateicons/react/lucide/rotate-ccw-icon';
import { SendIcon } from '@animateicons/react/lucide/send-icon';
import { ShareIcon } from '@animateicons/react/lucide/share-icon';
import { SlidersHorizontalIcon } from '@animateicons/react/lucide/sliders-horizontal-icon';
import { UndoIcon } from '@animateicons/react/lucide/undo-icon';
import {
  Button,
  buttonVariants,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Kbd,
  KbdGroup,
  MotionIcon,
  PageActions,
  Spinner,
  TooltipHint,
} from '@postgear/ui';
import { Check, CloudOff, RefreshCw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { type Ref, useRef, useState } from 'react';
import { FOCUS } from './design-card';
import { cleanTitle, MAX_TITLE_LENGTH, type SaveState, saveLabel } from './studio-view-model';

const ICON_BUTTON = 'w-9 shrink-0 px-0';

export function EditorTopBar({
  orgId,
  title,
  onRename,
  status,
  mac,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onReset,
  onPreview,
  onShare,
  onExport,
  onSend,
  sendRef,
  onOpenSlides,
  onOpenPanel,
}: {
  orgId: string;
  title: string;
  onRename: (title: string) => void;
  status: SaveState;
  /** Shows the Command key rather than Ctrl in shortcut hints. */
  mac: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onReset: (what: 'slide' | 'design') => void;
  onPreview: () => void;
  onShare: () => void;
  onExport: () => void;
  onSend: () => void;
  /** Send To Composer itself, which focus goes back to when the composer closes. */
  sendRef?: Ref<HTMLButtonElement>;
  onOpenSlides: () => void;
  onOpenPanel: () => void;
}) {
  const mod = mac ? '⌘' : 'Ctrl';

  return (
    <PageActions className="justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <TooltipHint label="Back To Studio" side="bottom">
          <Link
            href={`/${orgId}/studio`}
            aria-label="Back To Studio"
            className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), ICON_BUTTON)}
          >
            <MotionIcon icon={ArrowLeftIcon} className="h-4 w-4" />
          </Link>
        </TooltipHint>
        <TitleField title={title} onRename={onRename} />
        <SaveIndicator status={status} />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex items-center gap-1">
          <TooltipHint
            label="Undo"
            side="bottom"
            disabled={!canUndo}
            shortcut={
              <KbdGroup>
                <Kbd>{mod}</Kbd>
                <Kbd>Z</Kbd>
              </KbdGroup>
            }
          >
            <Button
              variant="secondary"
              size="sm"
              aria-label="Undo"
              className={ICON_BUTTON}
              disabled={!canUndo}
              onClick={onUndo}
            >
              <MotionIcon icon={UndoIcon} className="h-4 w-4" />
            </Button>
          </TooltipHint>
          <TooltipHint
            label="Redo"
            side="bottom"
            disabled={!canRedo}
            shortcut={
              <KbdGroup>
                <Kbd>Shift</Kbd>
                <Kbd>{mod}</Kbd>
                <Kbd>Z</Kbd>
              </KbdGroup>
            }
          >
            <Button
              variant="secondary"
              size="sm"
              aria-label="Redo"
              className={ICON_BUTTON}
              disabled={!canRedo}
              onClick={onRedo}
            >
              <MotionIcon icon={RedoIcon} className="h-4 w-4" />
            </Button>
          </TooltipHint>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" aria-label="Reset">
              <MotionIcon icon={RotateCcwIcon} className="h-4 w-4" />
              <span className="hidden xl:inline">Reset</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onReset('slide')}>Reset Slide</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onReset('design')}>Reset Design</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <TooltipHint label="Preview" side="bottom">
          <Button
            variant="secondary"
            size="sm"
            aria-label="Preview"
            className={ICON_BUTTON}
            onClick={onPreview}
          >
            <MotionIcon icon={EyeIcon} className="h-4 w-4" />
          </Button>
        </TooltipHint>

        <Button variant="secondary" size="sm" aria-label="Share" onClick={onShare}>
          <MotionIcon icon={ShareIcon} className="h-4 w-4" />
          <span className="hidden xl:inline">Share</span>
        </Button>

        <Button variant="secondary" size="sm" aria-label="Export" onClick={onExport}>
          <MotionIcon icon={DownloadIcon} className="h-4 w-4" />
          <span className="hidden sm:inline">Export</span>
        </Button>

        <Button ref={sendRef} size="sm" onClick={onSend}>
          <MotionIcon icon={SendIcon} className="h-4 w-4" />
          Send To Composer
        </Button>

        <div className="flex items-center gap-1 lg:hidden">
          <TooltipHint label="Slides" side="bottom">
            <Button
              variant="secondary"
              size="sm"
              aria-label="Slides"
              className={ICON_BUTTON}
              onClick={onOpenSlides}
            >
              <MotionIcon icon={LayersIcon} className="h-4 w-4" />
            </Button>
          </TooltipHint>
          <TooltipHint label="Edit" side="bottom">
            <Button
              variant="secondary"
              size="sm"
              aria-label="Edit"
              className={ICON_BUTTON}
              onClick={onOpenPanel}
            >
              <MotionIcon icon={SlidersHorizontalIcon} className="h-4 w-4" />
            </Button>
          </TooltipHint>
        </div>
      </div>
    </PageActions>
  );
}

/**
 * The design's name, renamed in place (DS-6.4): click it to type, Enter or
 * leaving the field saves, Escape puts the old name back, and an empty name
 * falls back to the previous one.
 */
function TitleField({ title, onRename }: { title: string; onRename: (title: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Escape ends editing through the blur that follows; this stops that blur saving.
  const cancelled = useRef(false);

  function start() {
    cancelled.current = false;
    setDraft(title);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
  }

  function finish(save: boolean) {
    if (draft === null) return;
    if (save) {
      const next = cleanTitle(draft, title);
      if (next !== title) onRename(next);
    }
    setDraft(null);
    requestAnimationFrame(() => button.current?.focus());
  }

  if (draft !== null) {
    return (
      <input
        ref={input}
        value={draft}
        maxLength={MAX_TITLE_LENGTH}
        aria-label="Design name"
        // Keeps the browser's own undo while renaming: the editor's Undo is for the design.
        data-native-undo=""
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            finish(true);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            cancelled.current = true;
            finish(false);
          }
        }}
        onBlur={() => {
          if (!cancelled.current) finish(true);
        }}
        className={cn(
          'h-9 min-w-0 max-w-sm flex-1 rounded-md border-2 border-outline bg-secondary px-3',
          'type-ui text-sm text-ink shadow-surfaceSm',
          FOCUS,
        )}
      />
    );
  }

  return (
    <TooltipHint label="Rename" side="bottom">
      <button
        ref={button}
        type="button"
        onClick={start}
        aria-label={`Rename ${title}`}
        className={cn(
          'min-w-0 max-w-sm truncate rounded-md border-2 border-transparent px-2 py-1 text-start',
          'type-ui text-sm text-ink hover:border-outline hover:bg-secondary',
          FOCUS,
        )}
      >
        {title}
      </button>
    </TooltipHint>
  );
}

/**
 * Saved, Saving, Offline, "Could not save. Retrying." or Not saved, each with
 * its own icon so the state is never told by colour alone. Read out politely
 * when it changes.
 */
function SaveIndicator({ status }: { status: SaveState }) {
  const label = saveLabel(status);
  const problem = status === 'conflict' || status === 'failed';

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex shrink-0 items-center gap-1.5 font-sans text-xs text-ink',
        problem ? 'font-bold text-dangerInk' : 'type-muted',
      )}
    >
      {status === 'saved' ? (
        <Check aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} />
      ) : status === 'pending' || status === 'saving' ? (
        <Spinner
          size="sm"
          role="presentation"
          aria-hidden="true"
          className="motion-reduce:animate-none"
        />
      ) : status === 'offline' ? (
        <CloudOff aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} />
      ) : status === 'retrying' ? (
        <RefreshCw aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} />
      ) : (
        <TriangleAlert aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} />
      )}
      <span className="hidden md:inline">{label}</span>
      <span className="sr-only md:hidden">{label}</span>
    </div>
  );
}
