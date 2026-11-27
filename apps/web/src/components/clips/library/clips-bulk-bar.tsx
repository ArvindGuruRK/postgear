'use client';

/**
 * The bar over the Clips tab once a clip is ticked (Module 11, section 1;
 * blueprint section 9): the design system's `BulkActionBar` with the count
 * and the clear button, then **Export All** (primary), **Create Montage**
 * (from two clips), **Hide** (or **Unhide** when every ticked clip is
 * hidden) and **Delete** behind the usual red confirm, which names the
 * count. A button that cannot be used says why in its tooltip.
 *
 * Hide and Delete are one call each for all the clips (`PATCH` and `DELETE
 * /clips/bulk`): all of them change, or none.
 */
import { EyeIcon } from '@animateicons/react/lucide/eye-icon';
import { EyeOffIcon } from '@animateicons/react/lucide/eye-off-icon';
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
  BulkActionBar,
  Button,
  MotionIcon,
  TooltipHint,
  toast,
} from '@postgear/ui';
import { MONTAGE_MAX_CLIPS, MONTAGE_MIN_CLIPS } from '@postgear/video-engine';
import { type ReactElement, useState } from 'react';
import {
  BULK_MAX_CLIPS,
  bulkDeleteClips,
  bulkSetClipStatus,
  EXPORT_ALL_MAX_CLIPS,
} from '@/lib/clips-bulk-api';
import type { ClipListItem } from '@/types/clips';
import { clipErrorSentence } from './clip-actions';
import { BULK_TOO_MANY, EXPORT_ALL_TOO_MANY } from './export-all-model';
import { MONTAGE_TOO_FEW, MONTAGE_TOO_MANY } from './montage-model';

/** "Delete 2 Clips?", "Delete 1 Clip?" */
export function deleteManyTitle(count: number): string {
  return count === 1 ? 'Delete 1 Clip?' : `Delete ${count} Clips?`;
}

export const DELETE_MANY_SENTENCE = 'If any were exported, their files stay in Media.';

/** The toast after a bulk change: "3 clips hidden.", "1 clip deleted." */
export function bulkDoneSentence(
  count: number,
  done: 'hidden' | 'shown again' | 'deleted',
): string {
  return `${count === 1 ? '1 clip' : `${count} clips`} ${done}.`;
}

/** Why Create Montage is off for this many ticked clips, or null. */
export function montageCountProblem(count: number): string | null {
  if (count < MONTAGE_MIN_CLIPS) return MONTAGE_TOO_FEW;
  if (count > MONTAGE_MAX_CLIPS) return MONTAGE_TOO_MANY;
  return null;
}

function WithReason({ reason, children }: { reason: string | null; children: ReactElement }) {
  return (
    <TooltipHint label={reason ?? ''} hidden={reason === null} disabled={reason !== null}>
      {children}
    </TooltipHint>
  );
}

export function ClipsBulkBar({
  selected,
  onClear,
  onExportAll,
  onCreateMontage,
  onChanged,
  onDeleted,
}: {
  /** The ticked clips, in the list's order. */
  selected: ClipListItem[];
  onClear: () => void;
  onExportAll: () => void;
  onCreateMontage: () => void;
  /** Hide or Unhide went through: the list is read again. */
  onChanged: () => void;
  /** Delete went through for these ids. */
  onDeleted: (clipIds: string[]) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'hide' | 'delete' | null>(null);
  const count = selected.length;
  const ids = selected.map((clip) => clip.id);
  const allHidden = count > 0 && selected.every((clip) => clip.state === 'hidden');
  const tooManyForBulk = count > BULK_MAX_CLIPS ? BULK_TOO_MANY : null;
  const exportProblem = count > EXPORT_ALL_MAX_CLIPS ? EXPORT_ALL_TOO_MANY : null;
  const montageProblem = montageCountProblem(count);

  const hide = async () => {
    setBusy('hide');
    try {
      await bulkSetClipStatus({ clipIds: ids, status: allHidden ? 'DRAFT' : 'HIDDEN' });
      toast({ title: bulkDoneSentence(count, allHidden ? 'shown again' : 'hidden') });
      onClear();
      onChanged();
    } catch (cause) {
      toast({ title: clipErrorSentence(cause), variant: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    try {
      await bulkDeleteClips(ids);
      toast({ title: bulkDoneSentence(count, 'deleted') });
      onClear();
      onDeleted(ids);
    } catch (cause) {
      toast({ title: clipErrorSentence(cause), variant: 'danger' });
    } finally {
      setBusy(null);
      setConfirming(false);
    }
  };

  return (
    <>
      <BulkActionBar
        count={count}
        onClear={onClear}
        data-testid="clips-bulk-bar"
        className="sticky bottom-4 z-20"
        actions={
          <>
            <WithReason reason={exportProblem}>
              <Button
                size="sm"
                onClick={onExportAll}
                disabled={exportProblem !== null || busy !== null}
                data-testid="clips-bulk-export"
              >
                Export All
              </Button>
            </WithReason>
            <WithReason reason={montageProblem}>
              <Button
                variant="secondary"
                size="sm"
                onClick={onCreateMontage}
                disabled={montageProblem !== null || busy !== null}
                data-testid="clips-bulk-montage"
              >
                Create Montage
              </Button>
            </WithReason>
            <WithReason reason={tooManyForBulk}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void hide()}
                disabled={tooManyForBulk !== null || busy !== null}
                data-testid="clips-bulk-hide"
              >
                <MotionIcon icon={allHidden ? EyeIcon : EyeOffIcon} className="h-4 w-4" />
                {allHidden ? 'Unhide' : 'Hide'}
              </Button>
            </WithReason>
            <WithReason reason={tooManyForBulk}>
              <Button
                variant="danger"
                size="sm"
                onClick={() => setConfirming(true)}
                disabled={tooManyForBulk !== null || busy !== null}
                data-testid="clips-bulk-delete"
              >
                <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
                Delete
              </Button>
            </WithReason>
          </>
        }
      />
      <AlertDialog open={confirming} onOpenChange={(open) => busy === null && setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteManyTitle(count)}</AlertDialogTitle>
            <AlertDialogDescription>{DELETE_MANY_SENTENCE}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              disabled={busy !== null}
              data-testid="clips-bulk-delete-confirm"
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
            >
              {busy === 'delete'
                ? 'Deleting'
                : count === 1
                  ? 'Delete 1 Clip'
                  : `Delete ${count} Clips`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
