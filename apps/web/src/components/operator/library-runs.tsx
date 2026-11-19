'use client';

/**
 * Library, Runs (module 19 section 9): each ingest run with its counts and
 * the rejection reasons, its licence report (a signed address that lives ten
 * minutes), and for a run with staged items Review Items and Publish Run.
 * Openverse and OpenGameArt runs carry Needs Review and are never
 * auto-published; Publish Run always needs its tick.
 */
import { DownloadIcon } from '@animateicons/react/lucide/download-icon';
import { ListChecksIcon } from '@animateicons/react/lucide/list-checks-icon';
import { RocketIcon } from '@animateicons/react/lucide/rocket-icon';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  MotionIcon,
  Spinner,
  TooltipHint,
  toast,
} from '@postgear/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { LibraryRun, LibraryRunDetail, PublishRunResult } from '@/types/operator';
import { errorSentence, LoadFailed } from './operator-fields';
import { dateTime, OPERATOR_COPY, publishRunSentence, rejectionsSentence } from './operator-model';

export function LibraryRuns({ onReviewItems }: { onReviewItems: (run: LibraryRun) => void }) {
  const [runs, setRuns] = useState<LibraryRun[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<LibraryRun | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      setRuns(await api<LibraryRun[]>('/operator/library/runs'));
    } catch (caught) {
      setFailed(errorSentence(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const download = useCallback(async (run: LibraryRun) => {
    setDownloading(run.id);
    try {
      const detail = await api<LibraryRunDetail>(`/operator/library/runs/${run.id}`);
      if (!detail.reportUrl) {
        toast({ title: 'The report could not be signed. Try again in a moment.' });
        return;
      }
      window.open(detail.reportUrl, '_blank', 'noopener,noreferrer');
    } catch (caught) {
      toast({ title: errorSentence(caught) });
    } finally {
      setDownloading(null);
    }
  }, []);

  const columns = useMemo<ColumnDef<LibraryRun>[]>(
    () => [
      {
        accessorKey: 'startedAt',
        header: 'Started',
        cell: ({ row }) => dateTime(row.original.startedAt),
      },
      {
        accessorKey: 'origin',
        header: 'Origin',
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{row.original.origin}</span>
            <Badge variant="outline">{row.original.type === 'sound' ? 'Sounds' : 'Stickers'}</Badge>
            {row.original.needsReview ? <Badge variant="accent">Needs Review</Badge> : null}
          </span>
        ),
      },
      { accessorKey: 'accepted', header: 'Accepted' },
      { accessorKey: 'rejected', header: 'Rejected' },
      {
        id: 'reasons',
        header: 'Reasons',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-sans text-xs type-muted">
            {rejectionsSentence(row.original.rejections)}
          </span>
        ),
      },
      {
        id: 'staged',
        header: 'Staged',
        accessorFn: (run) => run.counts.staged,
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end gap-2">
            {row.original.hasReport ? (
              <TooltipHint label="Download Report" side="top">
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-9 w-9 px-0"
                  aria-label="Download Report"
                  disabled={downloading === row.original.id}
                  onClick={() => void download(row.original)}
                >
                  <MotionIcon icon={DownloadIcon} className="h-4 w-4" />
                </Button>
              </TooltipHint>
            ) : null}
            {row.original.counts.staged > 0 ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => onReviewItems(row.original)}>
                  <MotionIcon icon={ListChecksIcon} className="h-4 w-4" />
                  Review Items
                </Button>
                <Button size="sm" onClick={() => setPublishing(row.original)}>
                  <MotionIcon icon={RocketIcon} className="h-4 w-4" />
                  Publish Run
                </Button>
              </>
            ) : null}
          </div>
        ),
      },
    ],
    [download, downloading, onReviewItems],
  );

  if (failed && !runs) return <LoadFailed message={failed} onRetry={() => void load()} />;
  if (!runs)
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );

  return (
    <>
      <DataTable
        columns={columns}
        data={runs}
        pageSize={25}
        emptyMessage="No ingest has run yet. Runs are started by the ingest script on the media worker."
      />
      {publishing ? (
        <PublishRunDialog
          run={publishing}
          onClose={() => setPublishing(null)}
          onPublished={() => {
            setPublishing(null);
            void load();
          }}
        />
      ) : null}
    </>
  );
}

export function PublishRunDialog({
  run,
  onClose,
  onPublished,
}: {
  run: LibraryRun;
  onClose: () => void;
  onPublished: (result: PublishRunResult) => void;
}) {
  const id = useId();
  const [detail, setDetail] = useState<LibraryRunDetail | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [ticked, setTicked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<LibraryRunDetail>(`/operator/library/runs/${run.id}`)
      .then((next) => live && setDetail(next))
      .catch((caught: unknown) => live && setFailed(errorSentence(caught)));
    return () => {
      live = false;
    };
  }, [run.id]);

  const count = detail?.publishable ?? run.counts.staged;

  async function publish() {
    if (!ticked) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api<PublishRunResult>(`/operator/library/runs/${run.id}/publish`, {
        method: 'POST',
        body: { reviewed: true },
      });
      toast({
        title:
          result.heldBack.length > 0
            ? `Published ${result.published}. ${result.heldBack.length} held back by the licence check.`
            : `Published ${result.published}. They are visible to every workspace now.`,
      });
      onPublished(result);
    } catch (caught) {
      setError(errorSentence(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-w-lg">
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void publish();
          }}
        >
          <DialogHeader>
            <DialogTitle>Publish Run</DialogTitle>
            <DialogDescription>{publishRunSentence(count)}</DialogDescription>
          </DialogHeader>
          {run.needsReview ? (
            <Alert variant="warning" className="items-center">
              <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              <p className="m-0 min-w-0 flex-1">
                This run came from an open collection. Listen to a sample and read the licences
                before it goes live.
              </p>
            </Alert>
          ) : null}
          {failed ? <p className="m-0 font-sans text-sm text-dangerInk">{failed}</p> : null}
          {detail && detail.heldBack.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="m-0 font-sans text-sm text-ink">
                {detail.heldBack.length === 1
                  ? '1 item stays staged: the licence check refuses it.'
                  : `${detail.heldBack.length} items stay staged: the licence check refuses them.`}
              </p>
              <ul className="m-0 flex max-h-40 list-none flex-col gap-1 overflow-y-auto rounded-md border-2 border-outline bg-inset p-3 pg-scrollbar">
                {detail.heldBack.map((item) => (
                  <li key={item.id} className="font-sans text-xs text-ink">
                    <span className="font-semibold">{item.name}</span>: {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <label
            htmlFor={`${id}-tick`}
            className="flex cursor-pointer items-start gap-3 font-sans text-sm text-ink"
          >
            <Checkbox
              id={`${id}-tick`}
              checked={ticked}
              onCheckedChange={(checked) => setTicked(checked === true)}
              className="mt-0.5"
            />
            {OPERATOR_COPY.publishTick}
          </label>
          {error ? (
            <Alert variant="danger" className="items-center">
              <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              <p className="m-0 min-w-0 flex-1">{error}</p>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ticked || saving || count === 0}>
              {saving ? 'Publishing' : 'Publish Run'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
