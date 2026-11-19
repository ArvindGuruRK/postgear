'use client';

/**
 * Review Changes (module 19 section 8): each waiting change as "Clips
 * Storage, Pro: 50 GB to 60 GB", the reason, then one save. A 409 closes the
 * dialog and the tab shows the conflict sentence; a refused value keeps the
 * dialog open with the API's sentence.
 */
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from '@postgear/ui';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { PlansView, SavePlansResult } from '@/types/operator';
import { errorSentence, ReasonField } from './operator-fields';
import { type Drafts, planWrites, reasonError, reviewLines, savedSentence } from './operator-model';

export function ReviewChangesDialog({
  open,
  onOpenChange,
  plans,
  drafts,
  onSaved,
  onConflict,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plans: PlansView;
  drafts: Drafts;
  onSaved: (plans: PlansView) => void;
  onConflict: () => void;
}) {
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lines = reviewLines(plans, drafts);

  useEffect(() => {
    if (open) {
      setAttempted(false);
      setError(null);
    }
  }, [open]);

  async function save() {
    setAttempted(true);
    if (reasonError(reason)) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api<SavePlansResult>('/operator/entitlements/plans', {
        method: 'PUT',
        body: { cells: planWrites(plans, drafts), reason: reason.trim() },
      });
      toast({ title: savedSentence(result.saved) });
      setReason('');
      onSaved(result.plans);
      onOpenChange(false);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        onConflict();
      } else {
        setError(errorSentence(caught));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-w-xl">
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>Review Changes</DialogTitle>
            <DialogDescription>
              Every workspace on these plans gets the new values within a few seconds.
            </DialogDescription>
          </DialogHeader>
          <ul
            className="m-0 flex max-h-64 list-none flex-col gap-1.5 overflow-y-auto rounded-md border-2 border-outline bg-inset p-3 pg-scrollbar"
            data-testid="review-lines"
          >
            {lines.map((line) => (
              <li key={line.id} className="font-sans text-sm text-ink">
                {line.text}
              </li>
            ))}
          </ul>
          <ReasonField
            value={reason}
            onChange={setReason}
            attempted={attempted}
            disabled={saving}
          />
          {error ? (
            <Alert variant="danger" className="items-center">
              <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              <p className="m-0 min-w-0 flex-1">{error}</p>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || lines.length === 0}>
              {saving ? 'Saving' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
