'use client';

/**
 * Plans (module 19 section 8): every key a row, every tier a column, read
 * from the registry and the stored values. A cell edits in place with a
 * control by type; edited cells are marked and counted, and nothing is sent
 * until Review Changes, a reason and Save Changes. A stale screen gets the
 * conflict sentence and keeps nothing of its save.
 */
import { EllipsisIcon } from '@animateicons/react/lucide/ellipsis-icon';
import { RotateCcwIcon } from '@animateicons/react/lucide/rotate-ccw-icon';
import { getDef, type Key } from '@postgear/entitlements';
import {
  Alert,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MotionIcon,
  PageActions,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Toggle,
  TooltipHint,
} from '@postgear/ui';
import { Info, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { EndingOverride, EntitlementCellValue, PlanCell, PlansView } from '@/types/operator';
import { LoadFailed, ValueControl } from './operator-fields';
import {
  cellId,
  changesWaiting,
  type Draft,
  type Drafts,
  draftErrors,
  draftValue,
  endingSoonSentence,
  findCell,
  lowerTierWarnings,
  OPERATOR_COPY,
  seedHint,
  shortDate,
  shownValue,
  tierName,
  valueError,
  withDraft,
  withoutDraft,
} from './operator-model';
import { ReviewChangesDialog } from './review-changes-dialog';

export function PlansTab({
  plans,
  onPlansChange,
  onReload,
  onOpenOverride,
}: {
  plans: PlansView | null;
  onPlansChange: (plans: PlansView) => void;
  onReload: () => Promise<void>;
  /** Opens Workspace Overrides on the workspace an ending override belongs to. */
  onOpenOverride: (ending: EndingOverride | null) => void;
}) {
  const [drafts, setDrafts] = useState<Drafts>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);

  const errors = useMemo(() => (plans ? draftErrors(plans, drafts) : {}), [plans, drafts]);
  const warnings = useMemo(() => (plans ? lowerTierWarnings(plans, drafts) : []), [plans, drafts]);
  const waiting = Object.keys(drafts).length;
  const blocked = Object.keys(errors).length > 0;

  async function reload() {
    setReloading(true);
    try {
      await onReload();
      setDrafts({});
      setEditing(null);
      setConflict(false);
    } finally {
      setReloading(false);
    }
  }

  if (!plans) return <LoadFailed onRetry={() => void reload()} />;

  function edit(cell: PlanCell, draft: Draft) {
    setDrafts((current) => withDraft(current, cell, draft));
  }

  function resetRow(key: Key) {
    if (!plans) return;
    setDrafts((current) => {
      let next = current;
      for (const tier of plans.tiers) {
        const cell = findCell(plans, tier, key);
        if (!cell) continue;
        next =
          cell.value === cell.seed && cell.valid
            ? withoutDraft(next, cell)
            : withDraft(next, cell, { kind: 'reset' });
      }
      return next;
    });
    setEditing(null);
  }

  const groups = [...new Set(plans.keys.map((info) => info.group))];

  return (
    <div className="flex flex-col gap-4">
      <PageActions>
        <span className="font-sans text-sm text-ink type-muted" aria-live="polite">
          {waiting > 0 ? changesWaiting(waiting) : ''}
        </span>
        {waiting > 0 ? (
          <Button variant="secondary" onClick={() => setDrafts({})}>
            Discard Changes
          </Button>
        ) : null}
        <Button onClick={() => setReviewing(true)} disabled={waiting === 0 || blocked}>
          Review Changes
        </Button>
      </PageActions>

      <Alert variant="info" className="items-center">
        <Info className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
        <p className="m-0 min-w-0 flex-1">{OPERATOR_COPY.plansBanner}</p>
      </Alert>

      {conflict ? (
        <Alert variant="warning" className="items-center" data-testid="plans-conflict">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{OPERATOR_COPY.conflict}</p>
          <Button variant="secondary" size="sm" onClick={() => void reload()} disabled={reloading}>
            Reload
          </Button>
        </Alert>
      ) : null}

      {plans.endingSoon.length > 0 ? (
        <Alert variant="warning" className="items-start">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="m-0">{endingSoonSentence(plans.endingSoon.length)}</p>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-sm">
              {plans.endingSoon.map((ending) => (
                <li key={`${ending.organizationId}|${ending.key}`}>
                  <button
                    type="button"
                    className="underline underline-offset-2 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-focusRing"
                    onClick={() => onOpenOverride(ending)}
                  >
                    {ending.organizationName}, {ending.label}, ends {shortDate(ending.expiresAt)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <Button variant="secondary" size="sm" onClick={() => onOpenOverride(null)}>
            Open Workspace Overrides
          </Button>
        </Alert>
      ) : null}

      {warnings.map((warning) => (
        <Alert key={warning} variant="warning" className="items-center">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{warning}</p>
        </Alert>
      ))}

      <Table className="table-fixed" data-testid="plans-table">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[26%]">Setting</TableHead>
            {plans.tiers.map((tier) => (
              <TableHead key={tier}>{tierName(tier)}</TableHead>
            ))}
            <TableHead className="w-14">
              <span className="sr-only">Row Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => (
            <GroupRows
              key={group}
              group={group}
              // One group needs no heading: its first row already names it.
              titled={groups.length > 1}
              plans={plans}
              drafts={drafts}
              errors={errors}
              editing={editing}
              onEditing={setEditing}
              onEdit={edit}
              onDiscard={(cell) => setDrafts((current) => withoutDraft(current, cell))}
              onResetRow={resetRow}
            />
          ))}
        </TableBody>
      </Table>

      <ReviewChangesDialog
        open={reviewing}
        onOpenChange={setReviewing}
        plans={plans}
        drafts={drafts}
        onSaved={(next) => {
          onPlansChange(next);
          setDrafts({});
          setEditing(null);
          setConflict(false);
        }}
        onConflict={() => {
          setReviewing(false);
          setConflict(true);
        }}
      />
    </div>
  );
}

function GroupRows({
  group,
  titled,
  plans,
  drafts,
  errors,
  editing,
  onEditing,
  onEdit,
  onDiscard,
  onResetRow,
}: {
  group: string;
  titled: boolean;
  plans: PlansView;
  drafts: Drafts;
  errors: Record<string, string>;
  editing: string | null;
  onEditing: (id: string | null) => void;
  onEdit: (cell: PlanCell, draft: Draft) => void;
  onDiscard: (cell: PlanCell) => void;
  onResetRow: (key: Key) => void;
}) {
  const keys = plans.keys.filter((info) => info.group === group);
  return (
    <>
      {titled ? (
        <TableRow className="bg-inset">
          <TableCell colSpan={plans.tiers.length + 2} className="py-2">
            <span className="type-label text-sm text-ink">{groupName(group)}</span>
          </TableCell>
        </TableRow>
      ) : null}
      {keys.map((info) => {
        const rowCells = plans.tiers
          .map((tier) => findCell(plans, tier, info.key))
          .filter((cell): cell is PlanCell => Boolean(cell));
        const canReset = rowCells.some(
          (cell) =>
            !cell.valid || draftValue(cell, drafts[cellId(cell.tier, cell.key)]) !== cell.seed,
        );
        return (
          <TableRow key={info.key}>
            <TableCell className="align-top">
              <span className="block font-sans text-sm font-semibold text-ink">{info.label}</span>
              <span className="block font-sans text-xs text-ink type-muted">
                {info.description}
              </span>
            </TableCell>
            {plans.tiers.map((tier) => {
              const cell = findCell(plans, tier, info.key);
              if (!cell) return <TableCell key={tier} />;
              const id = cellId(tier, info.key);
              return (
                <TableCell key={tier} className="p-2 align-top">
                  <PlanCellEditor
                    cell={cell}
                    draft={drafts[id]}
                    error={errors[id] ?? null}
                    editing={editing === id}
                    onStartEditing={() => onEditing(id)}
                    onStopEditing={() => onEditing(null)}
                    onEdit={(draft) => onEdit(cell, draft)}
                    onDiscard={() => onDiscard(cell)}
                  />
                </TableCell>
              );
            })}
            <TableCell className="p-2 align-top">
              <DropdownMenu>
                <TooltipHint label="Row Actions" side="left">
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 px-0"
                      aria-label={`${info.label} actions`}
                    >
                      <MotionIcon icon={EllipsisIcon} className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipHint>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled={!canReset} onSelect={() => onResetRow(info.key)}>
                    <MotionIcon icon={RotateCcwIcon} className="h-4 w-4" />
                    Reset To Seed
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        );
      })}
    </>
  );
}

function groupName(group: string): string {
  return group.charAt(0).toUpperCase() + group.slice(1);
}

/**
 * One cell: its value and, when it differs from the seed, a small "Seed 180".
 * A switch flips in place; a number or a select opens on click. An edited
 * cell is marked, and an invalid one says why under it.
 */
export function PlanCellEditor({
  cell,
  draft,
  error,
  editing,
  onStartEditing,
  onStopEditing,
  onEdit,
  onDiscard,
}: {
  cell: PlanCell;
  draft: Draft | undefined;
  error: string | null;
  editing: boolean;
  onStartEditing: () => void;
  onStopEditing: () => void;
  onEdit: (draft: Draft) => void;
  onDiscard: () => void;
}) {
  const def = getDef(cell.key);
  const value = draftValue(cell, draft);
  const hint = seedHint(cell.key, value, cell.seed);
  const edited = draft !== undefined;
  const label = `${def?.label ?? cell.key}, ${tierName(cell.tier)}`;
  const [pending, setPending] = useState<EntitlementCellValue | undefined>(value);

  const shell = cn(
    'flex min-h-11 flex-col justify-center gap-1 rounded-md border-2 px-2 py-1',
    edited ? 'border-actionAccent bg-inset' : 'border-transparent',
    error ? 'border-actionDanger' : null,
  );

  if (def?.type === 'boolean') {
    return (
      <div className={shell} data-edited={edited || undefined}>
        <span className="inline-flex items-center gap-2">
          <Toggle
            checked={value === true}
            onCheckedChange={(checked) => onEdit({ kind: 'set', value: checked })}
            aria-label={`${label}: ${value === true ? 'on' : 'off'}`}
          />
          <span className="font-sans text-sm text-ink">{shownValue(cell.key, value)}</span>
        </span>
        <CellFooter
          hint={hint}
          edited={edited}
          invalid={!cell.valid && !edited}
          onDiscard={onDiscard}
        />
      </div>
    );
  }

  if (editing && def) {
    const commit = () => {
      onEdit({ kind: 'set', value: pending });
      if (!valueError(cell.key, pending)) onStopEditing();
    };
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: focus leaving the cell commits the edit; the field inside is the control.
      <div
        className={shell}
        onBlur={(event) => {
          // Leaving the cell (not moving between its own controls) commits.
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null) &&
            def.type !== 'enum'
          ) {
            commit();
          }
        }}
      >
        <ValueControl
          entitlementKey={cell.key}
          value={pending}
          size="sm"
          autoFocus
          invalid={Boolean(error)}
          onChange={(next) => {
            setPending(next);
            if (def.type === 'enum' && next !== undefined) {
              onEdit({ kind: 'set', value: next });
              onStopEditing();
            }
          }}
          onCommit={commit}
          onCancel={() => {
            setPending(value);
            onStopEditing();
          }}
        />
        {error ? (
          <span className="font-sans text-xs font-semibold text-dangerInk">{error}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className={shell} data-edited={edited || undefined}>
      <button
        type="button"
        onClick={() => {
          setPending(value);
          onStartEditing();
        }}
        aria-label={`Edit ${label}`}
        className={cn(
          'w-full rounded-sm text-left font-sans text-sm text-ink outline-none',
          'hover:underline hover:underline-offset-2',
          'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-focusRing',
        )}
      >
        {value === undefined ? 'Empty' : error ? String(value) : shownValue(cell.key, value)}
      </button>
      {error ? (
        <span className="font-sans text-xs font-semibold text-dangerInk">{error}</span>
      ) : null}
      <CellFooter
        hint={hint}
        edited={edited}
        invalid={!cell.valid && !edited}
        onDiscard={onDiscard}
      />
    </div>
  );
}

function CellFooter({
  hint,
  edited,
  invalid,
  onDiscard,
}: {
  hint: string | null;
  edited: boolean;
  invalid: boolean;
  onDiscard: () => void;
}) {
  if (!hint && !edited && !invalid) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-sans text-xs text-ink">
      {invalid ? (
        <span className="font-semibold text-dangerInk">
          The stored value is not valid and is ignored.
        </span>
      ) : null}
      {hint ? <span className="type-muted">{hint}</span> : null}
      {edited ? (
        <button
          type="button"
          onClick={onDiscard}
          className="underline underline-offset-2 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-focusRing"
        >
          Undo
        </button>
      ) : null}
    </span>
  );
}
