'use client';

/**
 * My Layouts (Module 10 section 6): the workspace's saved layouts for the
 * clip's shape, each a row that applies it in one press, with a menu
 * (Rename, Delete Layout behind a red confirm), and Save Layout, which asks
 * for a name.
 *
 * - The list is read when the tab opens and again when the shape changes
 *   (a layout saved for one shape is offered for that shape only), so a
 *   layout another member saved shows up the next time the tab opens.
 * - A slow answer for a shape that is no longer the clip's is dropped.
 * - Every refusal is the API's own sentence: the limit of 50 in the save
 *   dialog, a layout someone else deleted as a toast (and the row goes).
 */
import { EllipsisVerticalIcon } from '@animateicons/react/lucide/ellipsis-vertical-icon';
import { PencilIcon } from '@animateicons/react/lucide/pencil-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  keyTile,
  MotionIcon,
  Skeleton,
  toast,
} from '@postgear/ui';
import type { ClipLayout, Ratio } from '@postgear/video-engine';
import { useCallback, useEffect, useState } from 'react';
import { NOTE, PanelSection } from '@/components/studio/panel-ui';
import { ApiError } from '@/lib/api';
import { deleteLayout, listLayouts, renameLayout, saveLayout } from '@/lib/clips-api';
import type { SavedLayoutView } from '@/types/clips';
import { LayoutDrawing } from './layout-drawing';
import {
  cleanLayoutName,
  deleteLayoutSentence,
  layoutDrawing,
  layoutShapeName,
  MAX_SAVED_LAYOUT_NAME,
  noSavedLayoutsSentence,
  SAVE_UNREACHABLE,
  SAVED_LAYOUTS_FAILED,
} from './layouts-model';
import { NameDialog } from './name-dialog';

type ListState =
  | { ratio: Ratio; status: 'loading' }
  | { ratio: Ratio; status: 'failed' }
  | { ratio: Ratio; status: 'ready'; layouts: SavedLayoutView[] };

/** The sentence for a refused call: the API's own, or the connection one. */
function sentenceOf(cause: unknown): string {
  return cause instanceof ApiError && cause.status !== 0 ? cause.message : SAVE_UNREACHABLE;
}

/** The saved layouts for one shape, read again whenever the shape changes. */
export function useSavedLayouts(ratio: Ratio) {
  const [state, setState] = useState<ListState>({ ratio, status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    void attempt;
    const controller = new AbortController();
    setState({ ratio, status: 'loading' });
    listLayouts(ratio, { signal: controller.signal })
      .then((layouts) => {
        if (!controller.signal.aborted) setState({ ratio, status: 'ready', layouts });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ ratio, status: 'failed' });
      });
    return () => controller.abort();
  }, [ratio, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  /** Puts a layout in the list (new first), when it is for the shape shown. */
  const put = useCallback((layout: SavedLayoutView) => {
    setState((current) => {
      if (current.status !== 'ready' || current.ratio !== layout.ratio) return current;
      const known = current.layouts.some((l) => l.id === layout.id);
      const layouts = known
        ? current.layouts.map((l) => (l.id === layout.id ? layout : l))
        : [layout, ...current.layouts];
      return { ...current, layouts };
    });
  }, []);

  const drop = useCallback((layoutId: string) => {
    setState((current) =>
      current.status === 'ready'
        ? { ...current, layouts: current.layouts.filter((l) => l.id !== layoutId) }
        : current,
    );
  }, []);

  // A list still showing the old shape reads as loading until the new one lands.
  const shown: ListState = state.ratio === ratio ? state : { ratio, status: 'loading' };
  return { state: shown, retry, put, drop };
}

export function SavedLayouts({
  ratio,
  layout,
  onApply,
}: {
  /** The clip's shape: the list shows layouts saved for it, and Save Layout saves for it. */
  ratio: Ratio;
  /** The clip's layout, which Save Layout keeps. */
  layout: ClipLayout;
  onApply: (saved: SavedLayoutView) => void;
}) {
  const { state, retry, put, drop } = useSavedLayouts(ratio);
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState<SavedLayoutView | null>(null);
  const [deleting, setDeleting] = useState<SavedLayoutView | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const save = async (draft: string): Promise<string | null> => {
    const name = cleanLayoutName(draft);
    if (!name) return 'Enter a name for the layout.';
    try {
      const created = await saveLayout({ name, ratio, layout });
      put(created);
      toast({ title: `Layout saved as ${created.name}.` });
      return null;
    } catch (cause) {
      return sentenceOf(cause);
    }
  };

  const rename = async (draft: string): Promise<string | null> => {
    const target = renaming;
    if (!target) return null;
    const name = cleanLayoutName(draft);
    if (!name || name === target.name) return null;
    try {
      put(await renameLayout(target.id, name));
      return null;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        drop(target.id);
        toast({ title: cause.message, variant: 'danger' });
        return null;
      }
      return sentenceOf(cause);
    }
  };

  const confirmDelete = async () => {
    const target = deleting;
    if (!target || deleteBusy) return;
    setDeleteBusy(true);
    try {
      const { message } = await deleteLayout(target.id);
      drop(target.id);
      toast({ title: message });
      setDeleting(null);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        // Someone else deleted it first: it is gone either way.
        drop(target.id);
        setDeleting(null);
      }
      toast({ title: sentenceOf(cause), variant: 'danger' });
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <PanelSection
      title="My Layouts"
      aside={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setSaving(true)}
          data-testid="clip-save-layout"
        >
          Save Layout
        </Button>
      }
    >
      {state.status === 'loading' ? (
        <div className="flex flex-col gap-2" data-testid="clip-saved-layouts-loading">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : state.status === 'failed' ? (
        <div className="flex flex-col items-start gap-2">
          <p className={NOTE}>{SAVED_LAYOUTS_FAILED}</p>
          <Button variant="secondary" size="sm" onClick={retry}>
            Try Again
          </Button>
        </div>
      ) : state.layouts.length === 0 ? (
        <p className={NOTE}>{noSavedLayoutsSentence(ratio)}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="clip-saved-layouts">
          {state.layouts.map((saved) => (
            <li key={saved.id} className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={() => onApply(saved)}
                data-testid="clip-saved-layout"
                className={cn(
                  'flex h-14 min-w-0 flex-1 items-center gap-3 px-3 text-left type-ui text-sm',
                  keyTile(false),
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center">
                  <LayoutDrawing drawing={layoutDrawing(saved.ratio, saved.layout)} size={32} />
                </span>
                <span className="min-w-0 flex-1 truncate">{saved.name}</span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" aria-label={`More for ${saved.name}`}>
                    <MotionIcon icon={EllipsisVerticalIcon} className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setRenaming(saved)}>
                    <MotionIcon icon={PencilIcon} className="h-4 w-4" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setDeleting(saved)}>
                    <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
                    Delete Layout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      <NameDialog
        open={saving}
        onOpenChange={setSaving}
        title="Save Layout"
        description={`Keep these crops to use on your other ${layoutShapeName(ratio)} clips. Everyone in this workspace can use it.`}
        label="Layout name"
        placeholder="Enter your layout name"
        initial=""
        maxLength={MAX_SAVED_LAYOUT_NAME}
        submitLabel="Save Layout"
        busyLabel="Saving"
        onSubmit={save}
        testId="clip-save-layout-dialog"
      />
      <NameDialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        title="Rename Layout"
        description="The new name shows for everyone in this workspace."
        label="Layout name"
        placeholder="Enter your layout name"
        initial={renaming?.name ?? ''}
        maxLength={MAX_SAVED_LAYOUT_NAME}
        submitLabel="Save"
        busyLabel="Saving"
        onSubmit={rename}
        testId="clip-rename-layout-dialog"
      />
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && !deleteBusy && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Layout</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting ? deleteLayoutSentence(deleting.name) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              disabled={deleteBusy}
              data-testid="clip-delete-layout-confirm"
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              {deleteBusy ? 'Deleting' : 'Delete Layout'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PanelSection>
  );
}
