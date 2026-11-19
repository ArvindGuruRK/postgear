'use client';

/**
 * Change Log (module 19 section 8): every change to a plan value, an
 * override or a meter, newest first, filtered by scope, setting, workspace
 * and who made it. Append only: there is nothing here to edit or delete.
 */
import { ChevronLeftIcon } from '@animateicons/react/lucide/chevron-left-icon';
import { ChevronRightIcon } from '@animateicons/react/lucide/chevron-right-icon';
import { KEYS, REGISTRY } from '@postgear/entitlements';
import {
  Badge,
  Button,
  DataTable,
  FormField,
  FormLabel,
  Input,
  MotionIcon,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '@postgear/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { ChangeRow, ChangeScope, ChangesPage } from '@/types/operator';
import { errorSentence, LoadFailed } from './operator-fields';
import { dateTime, OPERATOR_COPY, tierName } from './operator-model';

const ALL = 'all';
const FILTER_DELAY_MS = 300;

const SCOPE_NAMES: Record<ChangeScope, string> = { PLAN: 'Plan', ORG: 'Workspace', USAGE: 'Usage' };

const ACTION_NAMES: Record<string, string> = {
  SET: 'Set',
  REMOVE: 'Removed',
  EXPIRE: 'Expired',
  ADJUST_USAGE: 'Adjusted',
  RESET_TO_SEED: 'Reset To Seed',
};

export interface ChangeFilters {
  scope: ChangeScope | typeof ALL;
  key: string;
  orgId: string;
  actor: string;
}

/** The query string of `GET /operator/changes` for these filters and page. */
export function changesQuery(filters: ChangeFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.scope !== ALL) params.set('scope', filters.scope);
  if (filters.key !== ALL) params.set('key', filters.key);
  if (filters.orgId.trim()) params.set('orgId', filters.orgId.trim());
  if (filters.actor.trim()) params.set('actor', filters.actor.trim());
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function ChangeLogTab() {
  const id = useId();
  const [filters, setFilters] = useState<ChangeFilters>({
    scope: ALL,
    key: ALL,
    orgId: '',
    actor: '',
  });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ChangesPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);

  // Typed filters wait a moment, so each key press is not a request.
  useEffect(() => {
    if (filters === applied) return;
    const timer = window.setTimeout(() => {
      setApplied(filters);
      setPage(1);
    }, FILTER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [filters, applied]);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    try {
      setResult(await api<ChangesPage>(`/operator/changes${changesQuery(applied, page)}`));
    } catch (caught) {
      setFailed(errorSentence(caught));
    } finally {
      setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns = useMemo<ColumnDef<ChangeRow>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        header: 'When',
        cell: ({ row }) => dateTime(row.original.createdAt),
      },
      {
        accessorKey: 'actorEmail',
        header: 'Who',
        cell: ({ row }) => row.original.actorEmail ?? 'System',
      },
      {
        accessorKey: 'scope',
        header: 'Scope',
        cell: ({ row }) => (
          <span className="flex flex-col gap-1">
            <Badge variant="outline" className="self-start">
              {SCOPE_NAMES[row.original.scope] ?? row.original.scope}
            </Badge>
            <span className="font-sans text-xs type-muted">
              {row.original.tier
                ? tierName(row.original.tier)
                : (row.original.organizationName ?? row.original.organizationId ?? '')}
            </span>
          </span>
        ),
      },
      {
        accessorKey: 'label',
        header: 'Key',
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span>{row.original.label}</span>
            <span className="font-sans text-xs type-muted">
              {ACTION_NAMES[row.original.action] ?? row.original.action}
            </span>
          </span>
        ),
      },
      {
        accessorKey: 'old',
        header: 'Old',
        enableSorting: false,
        cell: ({ row }) => row.original.old ?? 'None',
      },
      {
        accessorKey: 'new',
        header: 'New',
        enableSorting: false,
        cell: ({ row }) => row.original.new ?? 'None',
      },
      {
        accessorKey: 'reason',
        header: 'Reason',
        enableSorting: false,
        cell: ({ row }) => <span className="line-clamp-2 max-w-sm">{row.original.reason}</span>,
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-4 gap-3">
        <FormField>
          <FormLabel htmlFor={`${id}-scope`}>Scope</FormLabel>
          <Select
            value={filters.scope}
            onValueChange={(scope) =>
              setFilters((current) => ({ ...current, scope: scope as ChangeFilters['scope'] }))
            }
          >
            <SelectTrigger id={`${id}-scope`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Scopes</SelectItem>
              <SelectItem value="PLAN">Plans</SelectItem>
              <SelectItem value="ORG">Workspaces</SelectItem>
              <SelectItem value="USAGE">Usage</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField>
          <FormLabel htmlFor={`${id}-key`}>Setting</FormLabel>
          <Select
            value={filters.key}
            onValueChange={(key) => setFilters((current) => ({ ...current, key }))}
          >
            <SelectTrigger id={`${id}-key`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Settings</SelectItem>
              {KEYS.map((key) => (
                <SelectItem key={key} value={key}>
                  {REGISTRY[key].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField>
          <FormLabel htmlFor={`${id}-org`}>Workspace id</FormLabel>
          <Input
            id={`${id}-org`}
            value={filters.orgId}
            onChange={(event) =>
              setFilters((current) => ({ ...current, orgId: event.target.value }))
            }
            placeholder="Enter your workspace id"
          />
        </FormField>
        <FormField>
          <FormLabel htmlFor={`${id}-actor`}>Who</FormLabel>
          <Input
            id={`${id}-actor`}
            value={filters.actor}
            onChange={(event) =>
              setFilters((current) => ({ ...current, actor: event.target.value }))
            }
            placeholder="Enter your operator email"
          />
        </FormField>
      </div>

      {failed ? <LoadFailed message={failed} onRetry={() => void load()} /> : null}
      {!result && loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : null}
      {result ? (
        <div className={loading ? 'opacity-60' : undefined} data-testid="change-log">
          <DataTable
            columns={columns}
            data={result.changes}
            pageSize={result.pageSize}
            emptyMessage={OPERATOR_COPY.noChanges}
          />
          {result.page > 1 || result.hasMore ? (
            <div className="mt-3 flex items-center justify-end gap-3">
              <span className="font-sans text-xs text-ink type-muted">Page {result.page}</span>
              <Button
                variant="secondary"
                size="sm"
                disabled={result.page <= 1 || loading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <MotionIcon icon={ChevronLeftIcon} className="h-4 w-4" />
                Newer
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!result.hasMore || loading}
                onClick={() => setPage((current) => current + 1)}
              >
                Older
                <MotionIcon icon={ChevronRightIcon} className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
