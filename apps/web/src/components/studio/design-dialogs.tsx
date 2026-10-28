'use client';

/**
 * Rename and Delete for a design on the Studio page (DS-1.3).
 *
 * Rename sends the title alone, against the revision the card holds. If the
 * design changed since (open in an editor elsewhere), the API refuses with a
 * 409; a title on its own cannot overwrite anyone's slides, so the dialog
 * reads the current revision and tries once more rather than making the
 * user do it.
 */
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormErrorMessage,
  FormField,
  FormLabel,
  Input,
} from '@postgear/ui';
import { useEffect, useId, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { DesignDetail, DesignSaveResult, DesignSummary } from '@/types/studio';
import { cleanTitle, MAX_TITLE_LENGTH } from './studio-view-model';

/** PATCHes a title, retrying once on a stale revision. */
export async function renameDesign(
  id: string,
  revision: number,
  title: string,
): Promise<DesignSaveResult> {
  const send = (at: number) =>
    api<{ design: DesignSaveResult }>(`/studio/designs/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { revision: at, title },
    });

  try {
    return (await send(revision)).design;
  } catch (cause) {
    if (!(cause instanceof ApiError) || cause.status !== 409) throw cause;

    const { design } = await api<{ design: DesignDetail }>(
      `/studio/designs/${encodeURIComponent(id)}`,
    );
    return (await send(design.revision)).design;
  }
}

export function RenameDesignDialog({
  design,
  onOpenChange,
  onRenamed,
}: {
  design: DesignSummary | null;
  onOpenChange: (open: boolean) => void;
  onRenamed: (result: DesignSaveResult) => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const fieldId = useId();

  useEffect(() => {
    setValue(design?.title ?? '');
    setError(null);
  }, [design]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!design || working) return;

    const title = cleanTitle(value, design.title);
    if (title === design.title) {
      onOpenChange(false);
      return;
    }

    setWorking(true);
    setError(null);

    try {
      onRenamed(await renameDesign(design.id, design.revision, title));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That name could not be saved.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog open={design !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={save} noValidate>
          <DialogHeader>
            <DialogTitle>Rename Design</DialogTitle>
            <DialogDescription>An empty name keeps the one it has.</DialogDescription>
          </DialogHeader>

          <FormField className="mt-5">
            <FormLabel htmlFor={fieldId}>Design name</FormLabel>
            <Input
              id={fieldId}
              value={value}
              maxLength={MAX_TITLE_LENGTH}
              onChange={(event) => setValue(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              placeholder="Enter your design name"
              autoFocus
            />
            {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
          </FormField>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={working}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={working}>
              {working ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteDesignDialog({
  design,
  onOpenChange,
  onDeleted,
}: {
  design: DesignSummary | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: (design: DesignSummary) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (design) setError(null);
  }, [design]);

  async function confirm(event: React.MouseEvent) {
    // Keep the dialog open until the request settles, so an error has somewhere to show.
    event.preventDefault();
    if (!design) return;

    setWorking(true);

    try {
      await api(`/studio/designs/${encodeURIComponent(design.id)}`, { method: 'DELETE' });
      onDeleted(design);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That design could not be deleted.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <AlertDialog open={design !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {design?.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its share links stop working. Images you exported stay in your media library. This
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error ? <FormErrorMessage role="alert">{error}</FormErrorMessage> : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={working}>Keep It</AlertDialogCancel>
          <AlertDialogAction variant="danger" onClick={confirm} disabled={working}>
            {working ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
