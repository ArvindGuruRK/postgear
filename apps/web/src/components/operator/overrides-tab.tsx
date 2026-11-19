'use client';

/**
 * Workspace Overrides (module 19 section 8): pick a workspace, see its plan,
 * status and what applies now with where each value came from, and its
 * overrides (setting, value, ends on, reason, who). Add Override and Remove
 * Override each open a dialog; both need a reason, and an override always
 * has an end date at most 366 days ahead.
 */
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import { KEYS, type Key, REGISTRY } from '@postgear/entitlements';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  DatePicker,
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
  MotionIcon,
  PageActions,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  toast,
} from '@postgear/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type {
  EntitlementCellValue,
  ResolvedValue,
  WorkspaceEntitlements,
  WorkspaceOverride,
  WorkspaceSummary,
} from '@/types/operator';
import { errorSentence, LoadFailed, ReasonField, ValueControl } from './operator-fields';
import {
  OPERATOR_COPY,
  overrideDateBounds,
  overrideEndsAt,
  reasonError,
  shortDate,
  shownValue,
  valueError,
} from './operator-model';
import { WorkspacePicker } from './workspace-picker';

const SOURCE_NAMES = { override: 'Override', plan: 'Plan', default: 'Default' } as const;

export function OverridesTab({
  workspace,
  onWorkspace,
  focusKey,
}: {
  workspace: WorkspaceSummary | null;
  onWorkspace: (workspace: WorkspaceSummary | null) => void;
  /** A setting to open Add Override on (from the Plans warning). */
  focusKey?: string | null;
}) {
  const [view, setView] = useState<WorkspaceEntitlements | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ key: Key } | null>(null);
  const [removing, setRemoving] = useState<WorkspaceOverride | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setFailed(null);
    try {
      setView(
        await api<WorkspaceEntitlements>(
          `/operator/workspaces/${encodeURIComponent(workspace.id)}/entitlements`,
        ),
      );
    } catch (caught) {
      setFailed(errorSentence(caught));
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    setView(null);
    void load();
  }, [load]);

  const columns = useMemo<ColumnDef<WorkspaceOverride>[]>(
    () => [
      { accessorKey: 'label', header: 'Setting' },
      {
        id: 'value',
        header: 'Value',
        cell: ({ row }) => shownValue(row.original.key, row.original.value),
      },
      {
        accessorKey: 'expiresAt',
        header: 'Ends On',
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-2">
            {shortDate(row.original.expiresAt)}
            {row.original.active ? null : <Badge variant="outline">Ended</Badge>}
          </span>
        ),
      },
      {
        accessorKey: 'reason',
        header: 'Reason',
        enableSorting: false,
        cell: ({ row }) => <span className="line-clamp-2 max-w-md">{row.original.reason}</span>,
      },
      { accessorKey: 'createdBy', header: 'Who' },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAdding({ key: row.original.key })}
            >
              Change
            </Button>
            <Button variant="danger" size="sm" onClick={() => setRemoving(row.original)}>
              <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
              Remove Override
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  const valueColumns = useMemo<ColumnDef<ResolvedValue>[]>(
    () => [
      { accessorKey: 'label', header: 'Setting' },
      {
        id: 'value',
        header: 'Applies Now',
        cell: ({ row }) => shownValue(row.original.key, row.original.value),
      },
      {
        accessorKey: 'source',
        header: 'From',
        cell: ({ row }) => (
          <Badge variant={row.original.source === 'override' ? 'accent' : 'outline'}>
            {SOURCE_NAMES[row.original.source]}
          </Badge>
        ),
      },
      {
        id: 'plan',
        header: 'Plan Value',
        cell: ({ row }) => shownValue(row.original.key, row.original.planValue),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <WorkspacePicker selected={workspace} onSelect={onWorkspace} />
      {workspace ? (
        <>
          <PageActions>
            <Button
              onClick={() =>
                setAdding({ key: (focusKey as Key | null) ?? KEYS[0] ?? 'clips.enabled' })
              }
              disabled={!view}
            >
              <MotionIcon icon={PlusIcon} className="h-4 w-4" />
              Add Override
            </Button>
          </PageActions>
          {failed ? <LoadFailed message={failed} onRetry={() => void load()} /> : null}
          {!view && loading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : null}
          {view ? (
            <>
              <section className="flex flex-col gap-2" aria-label="Overrides">
                <h2 className="m-0 type-heading text-lg text-ink">Overrides</h2>
                <DataTable
                  columns={columns}
                  data={view.overrides}
                  pageSize={25}
                  emptyMessage={OPERATOR_COPY.noOverrides}
                />
              </section>
              <section className="flex flex-col gap-2" aria-label="What applies now">
                <h2 className="m-0 type-heading text-lg text-ink">What Applies Now</h2>
                <DataTable columns={valueColumns} data={view.values} pageSize={25} />
              </section>
            </>
          ) : null}
        </>
      ) : null}

      {workspace && view && adding ? (
        <AddOverrideDialog
          workspace={workspace}
          view={view}
          initialKey={adding.key}
          onClose={() => setAdding(null)}
          onSaved={(next) => {
            setView(next);
            setAdding(null);
          }}
        />
      ) : null}
      {workspace && removing ? (
        <RemoveOverrideDialog
          workspace={workspace}
          override={removing}
          onClose={() => setRemoving(null)}
          onRemoved={(next) => {
            setView(next);
            setRemoving(null);
          }}
        />
      ) : null}
    </div>
  );
}

function AddOverrideDialog({
  workspace,
  view,
  initialKey,
  onClose,
  onSaved,
}: {
  workspace: WorkspaceSummary;
  view: WorkspaceEntitlements;
  initialKey: Key;
  onClose: () => void;
  onSaved: (view: WorkspaceEntitlements) => void;
}) {
  const id = useId();
  const now = useMemo(() => new Date(), []);
  const bounds = useMemo(() => overrideDateBounds(now), [now]);
  const [key, setKey] = useState<Key>(initialKey);
  const existing = view.overrides.find((override) => override.key === key) ?? null;
  const current = view.values.find((value) => value.key === key);
  const [value, setValue] = useState<EntitlementCellValue | undefined>(
    existing?.value ?? current?.value ?? REGISTRY[initialKey].default,
  );
  const [endsOn, setEndsOn] = useState<Date | undefined>(
    existing ? new Date(existing.expiresAt) : undefined,
  );
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickKey(next: Key) {
    setKey(next);
    const already = view.overrides.find((override) => override.key === next);
    const applied = view.values.find((entry) => entry.key === next);
    setValue(already?.value ?? applied?.value ?? REGISTRY[next].default);
    setEndsOn(already ? new Date(already.expiresAt) : undefined);
  }

  const valueProblem = valueError(key, value);
  const dateProblem = endsOn ? null : 'Enter the date this override ends.';

  async function save() {
    setAttempted(true);
    if (valueProblem || dateProblem || reasonError(reason) || !endsOn) return;
    setSaving(true);
    setError(null);
    try {
      const next = await api<WorkspaceEntitlements>(
        `/operator/workspaces/${encodeURIComponent(workspace.id)}/overrides/${encodeURIComponent(key)}`,
        {
          method: 'PUT',
          body: {
            value: value ?? null,
            expiresAt: overrideEndsAt(endsOn, new Date()),
            reason: reason.trim(),
            updatedAt: existing?.updatedAt ?? null,
          },
        },
      );
      toast({ title: 'The override is live for this workspace.' });
      onSaved(next);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 409
          ? OPERATOR_COPY.conflict
          : errorSentence(caught),
      );
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
            <DialogTitle>Add Override</DialogTitle>
            <DialogDescription>
              An override changes one setting for this workspace only, until its end date.
            </DialogDescription>
          </DialogHeader>
          <FormField>
            <FormLabel htmlFor={`${id}-workspace`}>Workspace</FormLabel>
            {/* Read only, so not a field: the dialog's focus starts on Setting. */}
            <output
              id={`${id}-workspace`}
              className="block rounded-md border-2 border-outline bg-inset px-3 py-2 font-sans text-sm text-ink"
            >
              {workspace.name}{' '}
              <span className="font-mono text-xs type-muted">({workspace.id})</span>
            </output>
          </FormField>
          <FormField>
            <FormLabel htmlFor={`${id}-key`} required>
              Setting
            </FormLabel>
            <Select value={key} onValueChange={(next) => pickKey(next as Key)}>
              <SelectTrigger id={`${id}-key`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KEYS.map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {REGISTRY[entry].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormHelperText>
              {REGISTRY[key].description}
              {current ? ` Now ${shownValue(key, current.value)}, from the ${current.source}.` : ''}
            </FormHelperText>
          </FormField>
          <FormField>
            <FormLabel htmlFor={`${id}-value`} required>
              Value
            </FormLabel>
            <ValueControl
              key={key}
              id={`${id}-value`}
              entitlementKey={key}
              value={value}
              onChange={setValue}
              invalid={attempted && Boolean(valueProblem)}
            />
            {attempted && valueProblem ? <FormErrorMessage>{valueProblem}</FormErrorMessage> : null}
          </FormField>
          <FormField>
            <FormLabel htmlFor={`${id}-ends`} required>
              Ends on
            </FormLabel>
            <DatePicker
              id={`${id}-ends`}
              value={endsOn}
              onValueChange={setEndsOn}
              minDate={bounds.min}
              maxDate={bounds.max}
              placeholder="Enter your end date"
              invalid={attempted && Boolean(dateProblem)}
            />
            {attempted && dateProblem ? (
              <FormErrorMessage>{dateProblem}</FormErrorMessage>
            ) : (
              <FormHelperText>{OPERATOR_COPY.endsOnHelp}</FormHelperText>
            )}
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
              {saving ? 'Saving' : 'Add Override'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveOverrideDialog({
  workspace,
  override,
  onClose,
  onRemoved,
}: {
  workspace: WorkspaceSummary;
  override: WorkspaceOverride;
  onClose: () => void;
  onRemoved: (view: WorkspaceEntitlements) => void;
}) {
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setAttempted(true);
    if (reasonError(reason)) return;
    setSaving(true);
    setError(null);
    try {
      const next = await api<WorkspaceEntitlements>(
        `/operator/workspaces/${encodeURIComponent(workspace.id)}/overrides/${encodeURIComponent(override.key)}`,
        { method: 'DELETE', body: { reason: reason.trim(), updatedAt: override.updatedAt } },
      );
      toast({ title: 'The override was removed. The plan value applies now.' });
      onRemoved(next);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 409
          ? OPERATOR_COPY.conflict
          : errorSentence(caught),
      );
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
            void remove();
          }}
        >
          <DialogHeader>
            <DialogTitle>Remove Override</DialogTitle>
            <DialogDescription>{OPERATOR_COPY.removeOverride}</DialogDescription>
          </DialogHeader>
          <p className="m-0 rounded-md border-2 border-outline bg-inset px-3 py-2 font-sans text-sm text-ink">
            {override.label}, {workspace.name}: {shownValue(override.key, override.value)}, ends{' '}
            {shortDate(override.expiresAt)}
          </p>
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
            <Button type="submit" variant="danger" disabled={saving}>
              {saving ? 'Removing' : 'Remove Override'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
