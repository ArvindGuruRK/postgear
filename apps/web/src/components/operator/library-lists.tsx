'use client';

/**
 * Library, Deny List and Gaps (module 19 section 9): the items no ingest may
 * bring back (read only), and the top 50 searches that found nothing, so the
 * next run can add what people look for.
 */
import { Badge, DataTable, Spinner } from '@postgear/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { LibraryDenyRow, LibraryMiss } from '@/types/operator';
import { errorSentence, LoadFailed } from './operator-fields';
import { dateTime, shortDate } from './operator-model';

function useList<T>(path: string) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const load = useCallback(async () => {
    setFailed(null);
    try {
      setRows(await api<T[]>(path));
    } catch (caught) {
      setFailed(errorSentence(caught));
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  return { rows, failed, load };
}

export function LibraryDenyList() {
  const { rows, failed, load } = useList<LibraryDenyRow>('/operator/library/deny');
  const columns = useMemo<ColumnDef<LibraryDenyRow>[]>(
    () => [
      {
        id: 'what',
        header: 'Checksum Or Origin Id',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-col gap-0.5">
            {row.original.origin ? (
              <span className="font-mono text-xs">
                {row.original.origin}
                {row.original.originId ? `: ${row.original.originId}` : ''}
              </span>
            ) : null}
            {row.original.sourceChecksum ? (
              <span
                className="max-w-md truncate font-mono text-xs type-muted"
                title={row.original.sourceChecksum}
              >
                {row.original.sourceChecksum}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        accessorKey: 'reason',
        header: 'Reason',
        enableSorting: false,
        cell: ({ row }) => <span className="line-clamp-2 max-w-md">{row.original.reason}</span>,
      },
      {
        accessorKey: 'createdAt',
        header: 'Date',
        cell: ({ row }) => dateTime(row.original.createdAt),
      },
    ],
    [],
  );
  if (failed && !rows) return <LoadFailed message={failed} onRetry={() => void load()} />;
  if (!rows)
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  return (
    <DataTable
      columns={columns}
      data={rows}
      pageSize={50}
      emptyMessage="Nothing has been removed from the library."
    />
  );
}

export function LibraryGaps() {
  const { rows, failed, load } = useList<LibraryMiss>('/operator/library/misses');
  const columns = useMemo<ColumnDef<LibraryMiss>[]>(
    () => [
      { accessorKey: 'term', header: 'Term' },
      {
        accessorKey: 'kind',
        header: 'Kind',
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.kind === 'sound' ? 'Sounds' : 'Stickers'}</Badge>
        ),
      },
      { accessorKey: 'count', header: 'Count' },
      {
        accessorKey: 'lastAt',
        header: 'Last Seen',
        cell: ({ row }) => shortDate(row.original.lastAt),
      },
    ],
    [],
  );
  if (failed && !rows) return <LoadFailed message={failed} onRetry={() => void load()} />;
  if (!rows)
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  return (
    <DataTable
      columns={columns}
      data={rows}
      pageSize={50}
      emptyMessage="Every search found something so far."
    />
  );
}
