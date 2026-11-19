'use client';

/**
 * Usage (module 19 section 8): one card a meter this cycle (used, limit,
 * remaining, reset date) and the workspace's last 50 ledger entries. Adjust
 * Usage writes a permanent ADJUSTMENT and its Change Log row; the dialog
 * makes its key once each time it opens, so a double click is one entry.
 */
import { SlidersHorizontalIcon } from '@animateicons/react/lucide/sliders-horizontal-icon';
import { formatNumber, getDef, METER_KEYS, type MeterKey, REGISTRY } from '@postgear/entitlements';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormErrorMessage,
  FormField,
  FormHelperText,
  FormLabel,
  Input,
  MotionIcon,
  PageActions,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  toast,
  UsageMeter,
} from '@postgear/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type {
  AdjustUsageResult,
  MeterUsage,
  UsageEntry,
  WorkspaceSummary,
  WorkspaceUsage,
} from '@/types/operator';
import { errorSentence, LoadFailed, ReasonField } from './operator-fields';
import {
  adjustAmountLabel,
  adjustmentKey,
  belowZeroProblem,
  dateTime,
  meterAmount,
  OPERATOR_COPY,
  parseNumberText,
  reasonError,
  shortDate,
  unitLabel,
} from './operator-model';
import { WorkspacePicker } from './workspace-picker';

const KIND_NAMES: Record<string, string> = {
  CHARGE: 'Charge',
  REVERSAL: 'Reversal',
  ADJUSTMENT: 'Adjustment',
};

/** The most an adjustment may move a meter in one entry (the API's own cap). */
const ADJUST_MAX = 100_000;

export function UsageTab({
  workspace,
  onWorkspace,
}: {
  workspace: WorkspaceSummary | null;
  onWorkspace: (workspace: WorkspaceSummary | null) => void;
}) {
  const [usage, setUsage] = useState<WorkspaceUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setFailed(null);
    try {
      setUsage(
        await api<WorkspaceUsage>(`/operator/workspaces/${encodeURIComponent(workspace.id)}/usage`),
      );
    } catch (caught) {
      setFailed(errorSentence(caught));
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    setUsage(null);
    void load();
  }, [load]);

  const columns = useMemo<ColumnDef<UsageEntry>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        header: 'Time',
        cell: ({ row }) => dateTime(row.original.createdAt),
      },
      { accessorKey: 'label', header: 'Meter' },
      {
        accessorKey: 'units',
        header: 'Units',
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.units > 0 ? '+' : ''}
            {formatNumber(row.original.units)}
          </span>
        ),
      },
      {
        accessorKey: 'kind',
        header: 'Kind',
        cell: ({ row }) => (
          <Badge variant={row.original.kind === 'ADJUSTMENT' ? 'accent' : 'outline'}>
            {KIND_NAMES[row.original.kind] ?? row.original.kind}
          </Badge>
        ),
      },
      {
        accessorKey: 'reference',
        header: 'Reference',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.reference ?? ''}</span>
        ),
      },
      {
        accessorKey: 'note',
        header: 'Note',
        enableSorting: false,
        cell: ({ row }) => <span className="line-clamp-2 max-w-sm">{row.original.note ?? ''}</span>,
      },
    ],
    [],
  );

  const anyUse = usage
    ? usage.meters.some((meter) => meter.used !== 0) || usage.entries.length > 0
    : false;

  return (
    <div className="flex flex-col gap-4">
      <WorkspacePicker selected={workspace} onSelect={onWorkspace} />
      {workspace ? (
        <>
          <PageActions>
            <Button onClick={() => setAdjusting(true)} disabled={!usage}>
              <MotionIcon icon={SlidersHorizontalIcon} className="h-4 w-4" />
              Adjust Usage
            </Button>
          </PageActions>
          {failed ? <LoadFailed message={failed} onRetry={() => void load()} /> : null}
          {!usage && loading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : null}
          {usage ? (
            <>
              <div className="grid grid-cols-3 gap-4">
                {usage.meters.map((meter) => (
                  <MeterCard key={meter.key} meter={meter} />
                ))}
              </div>
              {!anyUse ? (
                <p className="m-0 font-sans text-sm text-ink type-muted">{OPERATOR_COPY.noUsage}</p>
              ) : null}
              <section className="flex flex-col gap-2" aria-label="Ledger entries">
                <h2 className="m-0 type-heading text-lg text-ink">Last 50 Entries</h2>
                <DataTable
                  columns={columns}
                  data={usage.entries}
                  pageSize={50}
                  emptyMessage={OPERATOR_COPY.noUsage}
                />
              </section>
            </>
          ) : null}
        </>
      ) : null}
      {workspace && usage && adjusting ? (
        <AdjustUsageDialog
          workspace={workspace}
          usage={usage}
          onClose={() => setAdjusting(false)}
          onDone={(next) => {
            setUsage(next);
            setAdjusting(false);
          }}
        />
      ) : null}
    </div>
  );
}

function MeterCard({ meter }: { meter: MeterUsage }) {
  const used = meterAmount(meter.key, meter.used);
  const limit = meter.limit === null ? 'Unlimited' : meterAmount(meter.key, meter.limit);
  const caption = (
    <span className="flex flex-col gap-0.5">
      <span>
        {used} used of {limit}
        {meter.remaining !== null
          ? `, ${meterAmount(meter.key, Math.max(0, meter.remaining))} left`
          : ''}
      </span>
      <span>Resets {shortDate(meter.cycleEnd)}</span>
    </span>
  );
  return (
    <div className="flex flex-col gap-3 rounded-card border-2 border-outline bg-chrome p-4 shadow-surfaceSm">
      {meter.limit !== null && meter.limit > 0 ? (
        <UsageMeter
          label={meter.label}
          value={Math.min(meter.used, meter.limit)}
          max={meter.limit}
          caption={caption}
        />
      ) : (
        <div className="flex flex-col gap-1">
          <span className="type-label text-sm text-ink">{meter.label}</span>
          <span className="font-sans text-xs text-ink type-muted">{caption}</span>
        </div>
      )}
    </div>
  );
}

function AdjustUsageDialog({
  workspace,
  usage,
  onClose,
  onDone,
}: {
  workspace: WorkspaceSummary;
  usage: WorkspaceUsage;
  onClose: () => void;
  onDone: (usage: WorkspaceUsage) => void;
}) {
  const id = useId();
  // Made once for this opening of the dialog: a second click sends the same key.
  const [idempotencyKey] = useState(adjustmentKey);
  const [meter, setMeter] = useState<MeterKey>(METER_KEYS[0] ?? 'clips.ai_minutes_per_month');
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = parseNumberText(amountText);
  const amountProblem =
    amount === undefined || Number.isNaN(amount) || !Number.isInteger(amount) || amount === 0
      ? 'Enter a whole number that is not 0. A negative number gives back.'
      : Math.abs(amount) > ADJUST_MAX
        ? `Enter at most ${formatNumber(ADJUST_MAX)} either way.`
        : belowZeroProblem(amount, usage.meters.find((row) => row.key === meter)?.used);
  const def = getDef(meter);
  const unit = def ? unitLabel(def) : null;

  async function adjust() {
    setAttempted(true);
    if (amountProblem || reasonError(reason) || amount === undefined) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api<AdjustUsageResult>(
        `/operator/workspaces/${encodeURIComponent(workspace.id)}/usage/adjust`,
        { method: 'POST', body: { meter, units: amount, reason: reason.trim(), idempotencyKey } },
      );
      toast({
        title: result.duplicate
          ? 'This adjustment was already saved.'
          : 'Usage adjusted. The ledger and the Change Log have the entry.',
      });
      onDone(result.usage);
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
            void adjust();
          }}
        >
          <DialogHeader>
            <DialogTitle>Adjust Usage</DialogTitle>
            <DialogDescription>
              {workspace.name}: a positive number adds use, a negative one gives it back.
            </DialogDescription>
          </DialogHeader>
          <FormField>
            <FormLabel htmlFor={`${id}-meter`} required>
              Setting
            </FormLabel>
            <Select value={meter} onValueChange={(next) => setMeter(next as MeterKey)}>
              <SelectTrigger id={`${id}-meter`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METER_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {REGISTRY[key].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField>
            <FormLabel htmlFor={`${id}-amount`} required>
              {adjustAmountLabel(meter)}
            </FormLabel>
            <span className="inline-flex items-center gap-2">
              <Input
                id={`${id}-amount`}
                inputMode="numeric"
                className="w-56"
                value={amountText}
                onChange={(event) => setAmountText(event.target.value)}
                placeholder="Enter your amount"
                variant={attempted && amountProblem ? 'error' : 'default'}
                aria-invalid={attempted && amountProblem ? true : undefined}
              />
              {unit ? <span className="font-sans text-xs text-ink type-muted">{unit}</span> : null}
            </span>
            {attempted && amountProblem ? (
              <FormErrorMessage>{amountProblem}</FormErrorMessage>
            ) : (
              <FormHelperText>A negative number gives back.</FormHelperText>
            )}
          </FormField>
          <ReasonField
            value={reason}
            onChange={setReason}
            attempted={attempted}
            disabled={saving}
          />
          <Alert variant="warning" className="items-center">
            <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <p className="m-0 min-w-0 flex-1">{OPERATOR_COPY.adjustWarning}</p>
          </Alert>
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
              {saving ? 'Saving' : 'Adjust Usage'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
