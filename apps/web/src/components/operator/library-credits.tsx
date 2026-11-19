'use client';

/**
 * Library, Credits (module 19 section 9): every source with its live and
 * waiting items, and the words the public credits page prints for it. A
 * source that needs a credit line and has none is flagged here, and its
 * items cannot be published until it has one. Only the credit line, the
 * change note and the notice change here; the licence never does.
 */
import { ExternalLinkIcon } from '@animateicons/react/lucide/external-link-icon';
import { PencilIcon } from '@animateicons/react/lucide/pencil-icon';
import {
  Alert,
  Button,
  buttonVariants,
  cn,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  FormHelperText,
  FormLabel,
  MotionIcon,
  PageActions,
  Spinner,
  Textarea,
  toast,
} from '@postgear/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { LibrarySource } from '@/types/operator';
import { errorSentence, LoadFailed, ReasonField } from './operator-fields';
import { CREDIT_GROUP_NAMES, OPERATOR_COPY, reasonError } from './operator-model';

export function LibraryCredits() {
  const [sources, setSources] = useState<LibrarySource[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [editing, setEditing] = useState<LibrarySource | null>(null);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      setSources(await api<LibrarySource[]>('/operator/library/sources'));
    } catch (caught) {
      setFailed(errorSentence(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const columns = useMemo<ColumnDef<LibrarySource>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Source',
        cell: ({ row }) => (
          <span className="flex flex-col">
            <a
              href={row.original.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline underline-offset-2"
            >
              {row.original.name}
            </a>
            <span className="font-sans text-xs type-muted">{row.original.author}</span>
          </span>
        ),
      },
      {
        accessorKey: 'group',
        header: 'Group',
        cell: ({ row }) => CREDIT_GROUP_NAMES[row.original.group],
      },
      {
        accessorKey: 'licence',
        header: 'Licence',
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.licence}</span>,
      },
      {
        id: 'live',
        header: 'Live',
        accessorFn: (source) => source.stickers.active + source.sounds.active,
      },
      {
        id: 'waiting',
        header: 'Staged',
        accessorFn: (source) => source.stickers.staged + source.sounds.staged,
      },
      {
        accessorKey: 'creditLine',
        header: 'Credit Line',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.creditLine ? (
            <span className="line-clamp-2 max-w-sm">{row.original.creditLine}</span>
          ) : (
            <span
              className={
                row.original.needsCreditLine ? 'font-semibold text-dangerInk' : 'type-muted'
              }
            >
              {row.original.requiresCredit ? 'Missing' : 'Not needed'}
            </span>
          ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={() => setEditing(row.original)}>
              <MotionIcon icon={PencilIcon} className="h-4 w-4" />
              Edit Credits
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  const missing = sources?.filter((source) => source.needsCreditLine) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageActions>
        <a
          href="/credits/clips"
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: 'secondary' }), 'gap-2')}
        >
          <MotionIcon icon={ExternalLinkIcon} className="h-4 w-4" />
          Preview Credits Page
        </a>
      </PageActions>
      {missing.map((source) => (
        <Alert
          key={source.id}
          variant="warning"
          className="items-center"
          data-testid="credit-line-missing"
        >
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">
            <span className="font-semibold">{source.name}</span>: {OPERATOR_COPY.creditLineMissing}
          </p>
          <Button variant="secondary" size="sm" onClick={() => setEditing(source)}>
            Add Credit Line
          </Button>
        </Alert>
      ))}
      {failed && !sources ? <LoadFailed message={failed} onRetry={() => void load()} /> : null}
      {!sources && !failed ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : null}
      {sources ? (
        <DataTable
          columns={columns}
          data={sources}
          pageSize={50}
          emptyMessage="No library source yet."
        />
      ) : null}
      {editing ? (
        <EditCreditsDialog
          source={editing}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            setSources(
              (current) =>
                current?.map((source) => (source.id === next.id ? next : source)) ?? null,
            );
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function EditCreditsDialog({
  source,
  onClose,
  onSaved,
}: {
  source: LibrarySource;
  onClose: () => void;
  onSaved: (source: LibrarySource) => void;
}) {
  const id = useId();
  const [creditLine, setCreditLine] = useState(source.creditLine ?? '');
  const [changeNote, setChangeNote] = useState(source.changeNote ?? '');
  const [noticeText, setNoticeText] = useState(source.noticeText ?? '');
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setAttempted(true);
    if (reasonError(reason)) return;
    setSaving(true);
    setError(null);
    try {
      const next = await api<LibrarySource>(`/operator/library/sources/${source.id}`, {
        method: 'PATCH',
        body: { creditLine, changeNote, noticeText, reason: reason.trim() },
      });
      toast({ title: 'The credits are saved. The credits page shows them now.' });
      onSaved(next);
    } catch (caught) {
      setError(errorSentence(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-w-xl">
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit Credits</DialogTitle>
            <DialogDescription>
              {source.name}, {source.licence}. These words are printed on the public credits page.
            </DialogDescription>
          </DialogHeader>
          <FormField>
            <FormLabel htmlFor={`${id}-credit`} required={source.requiresCredit}>
              Credit line
            </FormLabel>
            <Textarea
              id={`${id}-credit`}
              value={creditLine}
              onChange={(event) => setCreditLine(event.target.value)}
              placeholder="Enter your credit line"
              rows={2}
              maxLength={500}
            />
            <FormHelperText>
              {source.requiresCredit
                ? 'Required before this source can publish: the exact words the licence asks for.'
                : 'This licence does not ask for a credit. Leave it empty unless you want one.'}
            </FormHelperText>
          </FormField>
          <FormField>
            <FormLabel htmlFor={`${id}-change`}>Change note</FormLabel>
            <Textarea
              id={`${id}-change`}
              value={changeNote}
              onChange={(event) => setChangeNote(event.target.value)}
              placeholder="Enter your change note"
              rows={2}
              maxLength={500}
            />
          </FormField>
          <FormField>
            <FormLabel htmlFor={`${id}-notice`}>Notice text</FormLabel>
            <Textarea
              id={`${id}-notice`}
              value={noticeText}
              onChange={(event) => setNoticeText(event.target.value)}
              placeholder="Enter your notice text"
              rows={4}
              maxLength={5000}
            />
            <FormHelperText>
              For an MIT or Apache licence, the notice it asks to keep.
            </FormHelperText>
          </FormField>
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
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving' : 'Save Credits'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
