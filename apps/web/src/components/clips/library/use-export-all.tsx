'use client';

/**
 * Export All's place on the Clips page (Module 11, section 2): the dialog,
 * and the small "Exporting 8 Clips" chip in the page's actions that opens it
 * again once it was closed. The chip comes back after a reload from `GET
 * /clips/exports/batches?open=1`, and is read again every few seconds while
 * a batch runs, so it goes once the batch is done.
 */
import { Button } from '@postgear/ui';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { listOpenExportBatches } from '@/lib/clips-bulk-api';
import type { ClipListItem } from '@/types/clips';
import type { ClipExportBatchSummary, ClipExportBatchView } from '@/types/clips-batch';
import { ExportRing } from '../export-ring';
import { ExportAllDialog, type ExportAllRequest } from './export-all-dialog';
import { chipLabel } from './export-all-model';

/** How often the chip asks which batches still run. */
export const OPEN_BATCHES_POLL_MS = 5_000;

export interface ExportAllState {
  /** Opens the dialog on these clips. */
  start: (clips: ClipListItem[]) => void;
  chip: ReactNode;
  dialog: ReactNode;
}

export function useExportAll({
  orgId,
  onStarted,
  load = listOpenExportBatches,
}: {
  orgId: string;
  /** A batch began (the list reads its rings again). */
  onStarted?: (view: ClipExportBatchView) => void;
  load?: typeof listOpenExportBatches;
}): ExportAllState {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<ExportAllRequest | null>(null);
  const [batches, setBatches] = useState<ClipExportBatchSummary[]>([]);

  // The batches still running, on the first paint and while any remain.
  const running = batches.length > 0;
  useEffect(() => {
    const abort = new AbortController();
    const read = () =>
      load({ signal: abort.signal })
        .then((rows) => {
          if (!abort.signal.aborted) setBatches(rows);
        })
        .catch(() => undefined);
    void read();
    if (!running) return () => abort.abort();
    const timer = setInterval(read, OPEN_BATCHES_POLL_MS);
    return () => {
      clearInterval(timer);
      abort.abort();
    };
  }, [load, running]);

  const start = useCallback((clips: ClipListItem[]) => {
    setRequest({ kind: 'choose', clips });
    setOpen(true);
  }, []);

  const started = useCallback(
    (view: ClipExportBatchView) => {
      setRequest({ kind: 'batch', batchId: view.batchId, initial: view });
      if (!view.finished) {
        setBatches((current) => [
          ...current.filter((one) => one.batchId !== view.batchId),
          { batchId: view.batchId, total: view.total, done: view.done, failed: view.failed },
        ]);
      }
      onStarted?.(view);
    },
    [onStarted],
  );

  const finished = useCallback((batchId: string) => {
    setBatches((current) => current.filter((one) => one.batchId !== batchId));
  }, []);

  const total = batches.reduce((sum, one) => sum + one.total, 0);
  const settled = batches.reduce((sum, one) => sum + one.done + one.failed, 0);
  const latest = batches.at(-1) ?? null;

  const chip = useMemo(
    () =>
      latest ? (
        <Button
          variant="secondary"
          size="sm"
          data-testid="clips-export-all-chip"
          onClick={() => {
            setRequest((current) =>
              current?.kind === 'batch' && current.batchId === latest.batchId
                ? current
                : { kind: 'batch', batchId: latest.batchId },
            );
            setOpen(true);
          }}
        >
          <ExportRing progress={total > 0 ? (settled / total) * 100 : 0} />
          {chipLabel(total)}
        </Button>
      ) : null,
    [latest, settled, total],
  );

  const dialog = (
    <ExportAllDialog
      orgId={orgId}
      open={open}
      request={request}
      onOpenChange={setOpen}
      onStarted={started}
      onFinished={finished}
    />
  );

  return { start, chip, dialog };
}
