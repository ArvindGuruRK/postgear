'use client';

/**
 * Costs (Sprint 13, Module 15 section 3): what Clips jobs cost us for the
 * picked days, beside what workspaces were charged, so the owner can see
 * whether the allowances cover the bills. From and To are both counted
 * (UTC days, at most 92); the tables are the API's sums as they come: cost
 * by job kind, each meter's cost against its net units, cost by workspace,
 * and the Clips ledger by workspace and by person. Read only. Nothing here
 * is ever shown to a workspace.
 */
import {
  DataTable,
  DatePicker,
  FormErrorMessage,
  FormField,
  FormLabel,
  Spinner,
} from '@postgear/ui';
import { formatNumber } from '@postgear/entitlements';
import type { ColumnDef } from '@tanstack/react-table';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type {
  CostsView,
  KindCost,
  MeterCost,
  PersonMeterUsage,
  WorkspaceCost,
  WorkspaceMeterUsage,
} from '@/types/operator';
import { errorSentence, LoadFailed } from './operator-fields';
import {
  costsMissingSentence,
  costsQuery,
  costsRangeProblem,
  costsTotalSentence,
  jobKindName,
  lastCostsDay,
  OPERATOR_COPY,
  usd,
} from './operator-model';

function todayStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

const numberCell = (value: number) => <span className="tabular-nums">{formatNumber(value)}</span>;
const costCell = (cents: number) => <span className="tabular-nums">{usd(cents)}</span>;

function personName(row: PersonMeterUsage): string {
  if (row.person) return row.person;
  return row.userId ? 'Unknown Person' : 'Not Recorded';
}

export function CostsTab() {
  const id = useId();
  const [from, setFrom] = useState<Date>(todayStart);
  const [to, setTo] = useState<Date>(todayStart);
  const [view, setView] = useState<CostsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // Only the latest request may show: a quick second pick must not be overwritten by the first.
  const latest = useRef(0);

  const problem = costsRangeProblem(from, to);

  const load = useCallback(async () => {
    if (costsRangeProblem(from, to)) return;
    const request = latest.current + 1;
    latest.current = request;
    setLoading(true);
    setFailed(null);
    try {
      const next = await api<CostsView>(`/operator/clips/costs?${costsQuery(from, to)}`);
      if (latest.current === request) setView(next);
    } catch (caught) {
      if (latest.current === request) setFailed(errorSentence(caught));
    } finally {
      if (latest.current === request) setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const kindColumns = useMemo<ColumnDef<KindCost>[]>(
    () => [
      {
        accessorKey: 'kind',
        header: 'Job Kind',
        cell: ({ row }) => jobKindName(row.original.kind),
      },
      { accessorKey: 'jobs', header: 'Jobs', cell: ({ row }) => numberCell(row.original.jobs) },
      {
        accessorKey: 'costed',
        header: 'Costed',
        cell: ({ row }) => numberCell(row.original.costed),
      },
      {
        accessorKey: 'estimated',
        header: 'Estimated',
        cell: ({ row }) => numberCell(row.original.estimated),
      },
      { accessorKey: 'cents', header: 'Cost', cell: ({ row }) => costCell(row.original.cents) },
    ],
    [],
  );

  const meterColumns = useMemo<ColumnDef<MeterCost>[]>(
    () => [
      { accessorKey: 'label', header: 'Meter' },
      {
        accessorKey: 'kinds',
        header: 'Paid For',
        enableSorting: false,
        cell: ({ row }) => row.original.kinds.map(jobKindName).join(', '),
      },
      {
        accessorKey: 'charged',
        header: 'Charged',
        cell: ({ row }) => numberCell(row.original.charged),
      },
      {
        accessorKey: 'reversed',
        header: 'Reversed',
        cell: ({ row }) => numberCell(row.original.reversed),
      },
      {
        accessorKey: 'adjusted',
        header: 'Adjusted',
        cell: ({ row }) => numberCell(row.original.adjusted),
      },
      { accessorKey: 'net', header: 'Net', cell: ({ row }) => numberCell(row.original.net) },
      { accessorKey: 'cents', header: 'Cost', cell: ({ row }) => costCell(row.original.cents) },
      {
        accessorKey: 'centsPerUnit',
        header: 'Cost Per Unit',
        cell: ({ row }) =>
          row.original.centsPerUnit === null ? '' : costCell(row.original.centsPerUnit),
      },
    ],
    [],
  );

  const workspaceColumns = useMemo<ColumnDef<WorkspaceCost>[]>(
    () => [
      {
        accessorKey: 'workspace',
        header: 'Workspace',
        cell: ({ row }) => row.original.workspace ?? row.original.organizationId,
      },
      { accessorKey: 'jobs', header: 'Jobs', cell: ({ row }) => numberCell(row.original.jobs) },
      { accessorKey: 'cents', header: 'Cost', cell: ({ row }) => costCell(row.original.cents) },
    ],
    [],
  );

  const usageColumns = useMemo<ColumnDef<WorkspaceMeterUsage>[]>(
    () => [
      {
        accessorKey: 'workspace',
        header: 'Workspace',
        cell: ({ row }) => row.original.workspace ?? row.original.organizationId,
      },
      { accessorKey: 'label', header: 'Meter' },
      {
        accessorKey: 'charged',
        header: 'Charged',
        cell: ({ row }) => numberCell(row.original.charged),
      },
      {
        accessorKey: 'reversed',
        header: 'Reversed',
        cell: ({ row }) => numberCell(row.original.reversed),
      },
      {
        accessorKey: 'adjusted',
        header: 'Adjusted',
        cell: ({ row }) => numberCell(row.original.adjusted),
      },
      { accessorKey: 'net', header: 'Net', cell: ({ row }) => numberCell(row.original.net) },
    ],
    [],
  );

  const personColumns = useMemo<ColumnDef<PersonMeterUsage>[]>(
    () => [
      { id: 'person', header: 'Person', accessorFn: personName },
      {
        accessorKey: 'workspace',
        header: 'Workspace',
        cell: ({ row }) => row.original.workspace ?? row.original.organizationId,
      },
      { accessorKey: 'label', header: 'Meter' },
      {
        accessorKey: 'charged',
        header: 'Charged',
        cell: ({ row }) => numberCell(row.original.charged),
      },
      {
        accessorKey: 'reversed',
        header: 'Reversed',
        cell: ({ row }) => numberCell(row.original.reversed),
      },
      { accessorKey: 'net', header: 'Net', cell: ({ row }) => numberCell(row.original.net) },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-4">
        <FormField className="w-56">
          <FormLabel htmlFor={`${id}-from`}>From</FormLabel>
          <DatePicker
            id={`${id}-from`}
            value={from}
            onValueChange={(day) => day && setFrom(day)}
            placeholder="Enter your first day"
          />
        </FormField>
        <FormField className="w-56">
          <FormLabel htmlFor={`${id}-to`}>To</FormLabel>
          <DatePicker
            id={`${id}-to`}
            value={to}
            onValueChange={(day) => day && setTo(day)}
            minDate={from}
            maxDate={lastCostsDay(from)}
            placeholder="Enter your last day"
            invalid={Boolean(problem)}
          />
          {problem ? <FormErrorMessage>{problem}</FormErrorMessage> : null}
        </FormField>
      </div>
      <p className="m-0 font-sans text-sm text-ink type-muted">{OPERATOR_COPY.costsHelp}</p>

      {failed ? <LoadFailed message={failed} onRetry={() => void load()} /> : null}
      {!view && loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : null}

      {view ? (
        <div className="flex flex-col gap-6" aria-busy={loading || undefined}>
          <div className="flex flex-col gap-1">
            <p className="m-0 font-sans text-sm text-ink" data-testid="costs-total">
              {costsTotalSentence(view.totals.jobs, view.totals.cents)}
            </p>
            {view.totals.missing > 0 ? (
              <p className="m-0 font-sans text-sm text-ink type-muted">
                {costsMissingSentence(view.totals.missing)}
              </p>
            ) : null}
            {view.totals.estimated > 0 ? (
              <p className="m-0 font-sans text-sm text-ink type-muted">
                {OPERATOR_COPY.costsEstimated}
              </p>
            ) : null}
          </div>

          <section className="flex flex-col gap-2" aria-label="Cost by job kind">
            <h2 className="m-0 type-heading text-lg text-ink">Cost By Job Kind</h2>
            <DataTable
              columns={kindColumns}
              data={view.byKind}
              pageSize={20}
              emptyMessage={OPERATOR_COPY.noCosts}
            />
          </section>

          <section className="flex flex-col gap-2" aria-label="Cost against meters">
            <h2 className="m-0 type-heading text-lg text-ink">Cost Against Meters</h2>
            <DataTable
              columns={meterColumns}
              data={view.byMeter}
              pageSize={20}
              emptyMessage={OPERATOR_COPY.noCostUsage}
            />
          </section>

          <section className="flex flex-col gap-2" aria-label="Cost by workspace">
            <h2 className="m-0 type-heading text-lg text-ink">Cost By Workspace</h2>
            <DataTable
              columns={workspaceColumns}
              data={view.byWorkspace}
              pageSize={20}
              emptyMessage={OPERATOR_COPY.noCosts}
            />
          </section>

          <section className="flex flex-col gap-2" aria-label="Usage by workspace">
            <h2 className="m-0 type-heading text-lg text-ink">Usage By Workspace</h2>
            <DataTable
              columns={usageColumns}
              data={view.usageByWorkspace}
              pageSize={20}
              emptyMessage={OPERATOR_COPY.noCostUsage}
            />
          </section>

          <section className="flex flex-col gap-2" aria-label="Usage by person">
            <h2 className="m-0 type-heading text-lg text-ink">Usage By Person</h2>
            <DataTable
              columns={personColumns}
              data={view.usageByPerson}
              pageSize={20}
              emptyMessage={OPERATOR_COPY.noCostUsage}
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}
