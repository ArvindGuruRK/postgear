'use client';

/**
 * The clip editor's head row (Module 08 section 5, blueprint section 6;
 * unframed 2026-11-19): the way back to the video, the clip's name (click to
 * rename), the save status, Undo and Redo, and **Export**, which opens the
 * Export tab. It sits over the stage only, on the page itself, with no frame
 * of its own: the rail and the panel beside it run the full height, as in
 * StreamLadder's editor. Keyboard Shortcuts moved to the rail's foot.
 *
 * While the panel is folded away, Show Panel leads the row.
 *
 * Sprint 13, Module 10: the overflow menu (More Actions) holds Save As
 * Recipe and Apply A Recipe.
 *
 * The name is the clip's, like a file name, not a page title.
 */
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { BookmarkIcon } from '@animateicons/react/lucide/bookmark-icon';
import { DownloadIcon } from '@animateicons/react/lucide/download-icon';
import { EllipsisIcon } from '@animateicons/react/lucide/ellipsis-icon';
import { PanelLeftOpenIcon } from '@animateicons/react/lucide/panel-left-open-icon';
import { RedoIcon } from '@animateicons/react/lucide/redo-icon';
import { ScrollTextIcon } from '@animateicons/react/lucide/scroll-text-icon';
import { UndoIcon } from '@animateicons/react/lucide/undo-icon';
import { WandSparklesIcon } from '@animateicons/react/lucide/wand-sparkles-icon';
import {
  Button,
  buttonVariants,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MotionIcon,
  Spinner,
  TooltipHint,
} from '@postgear/ui';
import { Check, CloudOff, RefreshCw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { ExportRing } from '../export-ring';
import { type ClipSaveState, clipSaveLabel } from './clip-autosave';
import { cleanClipName, MAX_CLIP_NAME } from './editor-state';

const ICON_BUTTON = 'h-9 w-9 shrink-0 px-0';
const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-focusRing';

export function EditorTopBar({
  backHref,
  backLabel,
  title,
  onRename,
  status,
  mod,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onShowPanel,
  transcriptOpen,
  onTranscript,
  onExport,
  exportProgress = null,
  onSaveRecipe,
  onApplyRecipe,
}: {
  backHref: string;
  /** "Back To Video", or "Back To Clips" for a clip whose video was deleted. */
  backLabel: string;
  title: string;
  onRename: (title: string) => void;
  status: ClipSaveState;
  /** "Ctrl", or the Command sign on a Mac. */
  mod: string;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Present while the panel is folded away: opens it again. */
  onShowPanel?: () => void;
  /** Sprint 13, Module 04: the Transcript pane is open; pressing the button (or T) toggles it. */
  transcriptOpen?: boolean;
  onTranscript?: () => void;
  onExport: () => void;
  /** 0 to 100 while an export runs (a small ring in the Export button); null otherwise. */
  exportProgress?: number | null;
  /** Module 10: the menu's Save As Recipe and Apply A Recipe. */
  onSaveRecipe?: () => void;
  onApplyRecipe?: () => void;
}) {
  return (
    <header
      data-testid="clip-editor-top-bar"
      className="flex min-h-14 shrink-0 items-center justify-between gap-4"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {onShowPanel ? (
          <TooltipHint label="Show Panel" side="bottom">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Show Panel"
              className={ICON_BUTTON}
              onClick={onShowPanel}
              data-testid="clip-panel-show"
            >
              <MotionIcon icon={PanelLeftOpenIcon} className="h-4 w-4" />
            </Button>
          </TooltipHint>
        ) : null}
        <TooltipHint label={backLabel} side="bottom">
          <Link
            href={backHref}
            aria-label={backLabel}
            className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), ICON_BUTTON)}
          >
            <MotionIcon icon={ArrowLeftIcon} className="h-4 w-4" />
          </Link>
        </TooltipHint>
        <NameField title={title} onRename={onRename} />
        <SaveIndicator status={status} />
      </div>

      <div className="flex items-center gap-2">
        {onTranscript ? (
          <TooltipHint
            label={transcriptOpen ? 'Close Transcript' : 'Open Transcript'}
            side="bottom"
            shortcut={['T']}
          >
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={transcriptOpen === true}
              onClick={onTranscript}
              data-testid="clip-transcript-toggle"
            >
              <MotionIcon icon={ScrollTextIcon} className="h-4 w-4" />
              Transcript
            </Button>
          </TooltipHint>
        ) : null}
        <div className="flex items-center gap-1">
          <TooltipHint label="Undo" side="bottom" disabled={!canUndo} shortcut={[mod, 'Z']}>
            <Button
              variant="ghost"
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
            shortcut={['Shift', mod, 'Z']}
          >
            <Button
              variant="ghost"
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
        {onSaveRecipe || onApplyRecipe ? (
          <DropdownMenu>
            <TooltipHint label="More Actions" side="bottom">
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="More Actions"
                  className={ICON_BUTTON}
                  data-testid="clip-editor-more"
                >
                  <MotionIcon icon={EllipsisIcon} className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipHint>
            <DropdownMenuContent align="end">
              {onSaveRecipe ? (
                <DropdownMenuItem onSelect={onSaveRecipe} data-testid="clip-menu-save-recipe">
                  <MotionIcon icon={BookmarkIcon} className="h-4 w-4" />
                  Save As Recipe
                </DropdownMenuItem>
              ) : null}
              {onApplyRecipe ? (
                <DropdownMenuItem onSelect={onApplyRecipe} data-testid="clip-menu-apply-recipe">
                  <MotionIcon icon={WandSparklesIcon} className="h-4 w-4" />
                  Apply A Recipe
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <Button
          size="sm"
          onClick={onExport}
          data-testid="clip-editor-export"
          aria-label={
            exportProgress === null ? undefined : `Export, ${Math.round(exportProgress)}% done`
          }
        >
          {exportProgress === null ? (
            <MotionIcon icon={DownloadIcon} className="h-4 w-4" />
          ) : (
            <ExportRing progress={exportProgress} />
          )}
          Export
        </Button>
      </div>
    </header>
  );
}

/**
 * The clip's name, renamed in place: click it to type, Enter or leaving the
 * field saves, Escape puts the old name back, and an empty name keeps the
 * previous one.
 */
function NameField({ title, onRename }: { title: string; onRename: (title: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Escape ends editing through the blur that follows; this stops that blur saving.
  const cancelled = useRef(false);

  function begin() {
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
      const next = cleanClipName(draft, title);
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
        maxLength={MAX_CLIP_NAME}
        aria-label="Clip name"
        // The browser's own undo works while renaming: the editor's Undo is for the clip.
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
          'h-9 min-w-0 max-w-md flex-1 rounded-md border-2 border-outline bg-secondary px-3',
          'type-ui font-sans text-sm text-ink focus-visible:border-focusRing',
          'outline-none',
        )}
      />
    );
  }

  return (
    <TooltipHint label="Rename" side="bottom">
      <button
        ref={button}
        type="button"
        onClick={begin}
        aria-label={`Rename ${title}`}
        data-testid="clip-editor-name"
        className={cn(
          'min-w-0 max-w-md truncate rounded-md border-2 border-transparent px-2 py-1 text-start',
          'type-ui font-sans text-sm text-ink hover:border-outline hover:bg-secondary',
          FOCUS,
        )}
      >
        {title}
      </button>
    </TooltipHint>
  );
}

/**
 * Saved, Saving, "Offline, will retry", "Could not save. Retrying." or Not
 * saved, each with its own icon so the state is never told by colour alone.
 * Read out politely when it changes.
 */
export function SaveIndicator({ status }: { status: ClipSaveState }) {
  const label = clipSaveLabel(status);
  const problem = status === 'conflict' || status === 'failed';

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="clip-save-status"
      data-status={status}
      className={cn(
        'flex shrink-0 items-center gap-1.5 font-sans text-xs text-ink',
        problem ? 'type-ui text-dangerInk' : 'type-muted',
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
      <span>{label}</span>
    </div>
  );
}
