'use client';

/**
 * The Competitors tab (Module 07, stories DC-7.1 to DC-7.3): the competitors
 * this workspace follows, one group each, with the newest of what each
 * published and Create Post on every row.
 *
 * ## Two kinds of request, kept apart
 *
 * The list of competitors is one request. Each group then asks for its own
 * items, so a competitor whose sources are slow, or whose request fails,
 * holds up and troubles its own group only (story DC-7.2: "in that group
 * only"). The API keeps every competitor's items for half an hour, so opening
 * the tab, or pressing Refresh, costs a stranger's site nothing most of the
 * time.
 *
 * Refresh (the page's own button, `refreshKey`) asks for the list and every
 * group's items again. What is on screen stays there, dimmed, until the new
 * answer lands, and an answer that arrives after a newer question is dropped.
 *
 * ## What a group says when a source is resting
 *
 * The API writes a sentence for each kind it could not read ("YouTube could
 * not be reached. Showing what we had from 2 hours ago.") and still sends the
 * last copy of its rows. The sentences go under the group's name; nothing
 * else on the page changes.
 *
 * ## Who can do what
 *
 * Anyone in the workspace adds and edits. Only an admin removes, so a member's
 * menu has no Remove at all (the API refuses a member's delete anyway).
 * Removing asks first, with the solid red button every delete has.
 */
import { EllipsisVerticalIcon } from '@animateicons/react/lucide/ellipsis-vertical-icon';
import { PencilIcon } from '@animateicons/react/lucide/pencil-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  MotionIcon,
  Skeleton,
  TooltipHint,
  toast,
} from '@postgear/ui';
import { Compass } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { getCompetitorItems, getCompetitors, removeCompetitor } from '@/lib/discover-api';
import type {
  Competitor,
  CompetitorItemsResponse,
  CompetitorsResponse,
  DiscoverItem,
} from '@/types/discover';
import { AnalyticsPanel, PanelHeader } from '../analytics/analytics-ui';
import { CompetitorDialog } from './competitor-dialog';
import { COMPETITORS_FAILED, ITEMS_FAILED, REMOVE_FAILED, STILL_READING } from './competitor-model';
import { CompetitorRows } from './competitor-row';
import { competitorGroupTitle, competitorSources } from './discover-model';
import { INSET_NOTE, ROW_LIST } from './discover-ui';

export const NO_COMPETITORS_TITLE = 'No competitors yet';
export const NO_COMPETITORS_HINT = 'Add one by website to see what they publish.';
export const COMPETITORS_LOAD_FAILED = 'Discover could not load';

/** How long a group waits before asking again for an answer that was not ready, and how often. */
export const PENDING_RETRY_MS = 4_000;
export const PENDING_TRIES = 5;

export function competitorLimitText(limit: number): string {
  return `You can follow up to ${limit} competitors.`;
}

export function nothingNewText(name: string): string {
  return `Nothing new from ${name} in the last 30 days.`;
}

export function removeQuestion(name: string): string {
  return `Remove ${name}? Their items disappear from Discover.`;
}

/** The API's own sentence for a refusal; ours when it never answered. */
function sentenceOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError && cause.status !== 0 ? cause.message : fallback;
}

/** A group's footprint while its items load: three rows in the box the rows will sit in. */
function RowsSkeleton({ name }: { name: string }) {
  return (
    <div
      aria-busy="true"
      aria-label={`Loading what ${name} published`}
      className={ROW_LIST}
      role="status"
    >
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex items-center gap-3 p-3">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-9 w-24" />
        </div>
      ))}
    </div>
  );
}

interface CompetitorGroupProps {
  competitor: Competitor;
  isAdmin: boolean;
  now: Date;
  refreshKey: number;
  onCreatePost?: (item: DiscoverItem) => void;
  renderRowExtra?: (item: DiscoverItem) => ReactNode;
  onEdit: (competitor: Competitor) => void;
  onRemove: (competitor: Competitor) => void;
}

/** One competitor: its name, where its rows come from, its menu, and the rows. */
export function CompetitorGroup({
  competitor,
  isAdmin,
  now,
  refreshKey,
  onCreatePost,
  renderRowExtra,
  onEdit,
  onRemove,
}: CompetitorGroupProps) {
  const headingId = useId();
  const [data, setData] = useState<CompetitorItemsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const asked = useRef(0);
  // How often this group asked again by itself for an answer that was not ready.
  const waits = useRef(0);
  const askedAgain = useRef(false);

  // Asked again on Refresh, on Try Again, and after an edit (the API stamps
  // `updatedAt`), since an edit can change which sources there are.
  //
  // An answer can also say it is not ready (`pending`): someone else is reading
  // this competitor right now, or the API had no free slot. Then the group asks
  // again by itself a few times, a few seconds apart, and only then says so.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `refreshKey`, `attempt` and `updatedAt` are triggers, not inputs
  useEffect(() => {
    asked.current += 1;
    const mine = asked.current;
    let again: number | undefined;
    // A person asked (or the competitor changed): the count of waits starts over.
    if (!askedAgain.current) waits.current = 0;
    askedAgain.current = false;
    setLoading(true);

    getCompetitorItems(competitor.id)
      .then((answer) => {
        if (asked.current !== mine) return;
        setData(answer);
        if (!answer.pending) {
          setError(null);
          return;
        }
        if (waits.current >= PENDING_TRIES) {
          setError(STILL_READING);
          return;
        }
        setError(null);
        waits.current += 1;
        again = window.setTimeout(() => {
          askedAgain.current = true;
          setAttempt((count) => count + 1);
        }, PENDING_RETRY_MS);
      })
      .catch((cause: unknown) => {
        if (asked.current !== mine) return;
        setError(sentenceOf(cause, ITEMS_FAILED));
      })
      .finally(() => {
        if (asked.current === mine) setLoading(false);
      });

    return () => {
      // Unmounted or asked again: this answer is nobody's.
      asked.current += 1;
      window.clearTimeout(again);
    };
  }, [competitor.id, competitor.updatedAt, refreshKey, attempt]);

  const notes = data?.notes ?? [];
  const items = data?.items ?? [];
  const pending = data?.pending === true;

  function body(): ReactNode {
    if (!data && loading) return <RowsSkeleton name={competitor.name} />;
    // Not read yet is not "nothing new": keep the footprint until it is, or until
    // the alert above says we gave up waiting.
    if (pending && items.length === 0) {
      return error ? null : <RowsSkeleton name={competitor.name} />;
    }
    if (items.length === 0 && notes.length === 0 && !error) {
      return (
        <p className={INSET_NOTE} data-testid="competitor-nothing-new">
          {nothingNewText(competitor.name)}
        </p>
      );
    }
    if (items.length === 0) return null;

    return (
      <div aria-busy={loading} className={cn('transition-opacity', loading && 'opacity-70')}>
        <CompetitorRows
          items={items}
          now={now}
          onCreatePost={onCreatePost}
          renderExtra={renderRowExtra}
        />
      </div>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="discover-competitor-group"
      data-competitor={competitor.id}
    >
      <AnalyticsPanel className="flex flex-col gap-4 p-4 md:p-5">
        <PanelHeader
          id={headingId}
          title={competitorGroupTitle(competitor.name)}
          sub={
            <div className="flex flex-col gap-1">
              <p className="m-0 font-sans text-sm text-ink type-muted">
                {competitorSources(competitor)}
              </p>
              {notes.map((note) => (
                <p
                  key={note}
                  className="m-0 font-sans text-sm text-ink type-muted"
                  data-stale="true"
                  data-testid="competitor-note"
                >
                  {note}
                </p>
              ))}
            </div>
          }
          aside={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-9 shrink-0 px-0"
                  aria-label={`More actions for ${competitor.name}`}
                >
                  <MotionIcon icon={EllipsisVerticalIcon} className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onEdit(competitor)}>
                  <MotionIcon icon={PencilIcon} className="h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                {isAdmin ? (
                  <DropdownMenuItem
                    className="text-dangerInk"
                    onSelect={() => onRemove(competitor)}
                  >
                    <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
                    Remove
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
        {error ? (
          <Alert variant="warning" className="items-center py-3" data-testid="competitor-error">
            <span className="flex-1">{error}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAttempt((count) => count + 1)}
              disabled={loading}
            >
              Try Again
            </Button>
          </Alert>
        ) : null}
        {body()}
      </AnalyticsPanel>
    </section>
  );
}

/** The confirmation before a competitor is removed: the same shape as every other delete. */
function RemoveCompetitorDialog({
  competitor,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  competitor: Competitor | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog
      open={competitor !== null}
      onOpenChange={(open) => (open || busy ? undefined : onCancel())}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove Competitor</AlertDialogTitle>
          <AlertDialogDescription>
            {competitor ? removeQuestion(competitor.name) : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <Alert variant="danger" className="mt-4 py-3" data-testid="competitor-remove-error">
            {error}
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="danger"
            disabled={busy}
            aria-busy={busy}
            onClick={(event) => {
              // Stays open until the API has answered, so a refusal can be read here.
              event.preventDefault();
              onConfirm();
            }}
          >
            {busy ? 'Removing...' : 'Remove'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export interface CompetitorsTabProps {
  orgId: string;
  /** Presentation only: whether Remove is offered. The API's guard is the real check. */
  isAdmin: boolean;
  now: Date;
  /** Bumped by the page's Refresh: the list and every group's items are asked for again. */
  refreshKey: number;
  /** Opens the Create Post sheet for a row, in the place and language being read. */
  onCreatePost?: (item: DiscoverItem) => void;
  /** A control after a row's Open (Read, Module 08). */
  renderRowExtra?: (item: DiscoverItem) => ReactNode;
}

export function CompetitorsTab({
  orgId,
  isAdmin,
  now,
  refreshKey,
  onCreatePost,
  renderRowExtra,
}: CompetitorsTabProps) {
  const [list, setList] = useState<CompetitorsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const asked = useRef(0);

  // The dialog's competitor is kept apart from whether it is open, so the form
  // does not blank while the dialog fades out.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Competitor | null>(null);
  const [removing, setRemoving] = useState<Competitor | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the workspace, `refreshKey` and `attempt` are triggers, not inputs
  useEffect(() => {
    asked.current += 1;
    const mine = asked.current;
    setLoading(true);

    getCompetitors()
      .then((answer) => {
        if (asked.current !== mine) return;
        setList(answer);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (asked.current !== mine) return;
        setError(sentenceOf(cause, COMPETITORS_FAILED));
      })
      .finally(() => {
        if (asked.current === mine) setLoading(false);
      });

    return () => {
      asked.current += 1;
    };
  }, [orgId, refreshKey, attempt]);

  const openAdd = useCallback(() => {
    setEditing(null);
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((competitor: Competitor) => {
    setEditing(competitor);
    setDialogOpen(true);
  }, []);

  function saved(competitor: Competitor) {
    setList((current) => {
      if (!current) return current;
      const known = current.competitors.some((entry) => entry.id === competitor.id);
      return {
        ...current,
        competitors: known
          ? current.competitors.map((entry) => (entry.id === competitor.id ? competitor : entry))
          : [...current.competitors, competitor],
      };
    });
  }

  async function confirmRemove() {
    if (!removing || removeBusy) return;
    const target = removing;
    setRemoveBusy(true);
    setRemoveError(null);

    try {
      await removeCompetitor(target.id);
      setList((current) =>
        current
          ? {
              ...current,
              competitors: current.competitors.filter((entry) => entry.id !== target.id),
            }
          : current,
      );
      setRemoving(null);
      toast({ title: 'Removed', description: `${target.name} was removed.` });
    } catch (cause) {
      setRemoveError(sentenceOf(cause, REMOVE_FAILED));
    } finally {
      setRemoveBusy(false);
    }
  }

  function content(): ReactNode {
    if (!list) {
      if (error) {
        return (
          <ErrorState
            title={COMPETITORS_LOAD_FAILED}
            description={error}
            action={{
              label: 'Try Again',
              onClick: () => setAttempt((count) => count + 1),
              variant: 'secondary',
            }}
          />
        );
      }
      return (
        <div
          aria-busy="true"
          aria-label="Loading competitors"
          className="flex flex-col gap-6"
          role="status"
        >
          {[0, 1].map((index) => (
            <AnalyticsPanel key={index} className="flex flex-col gap-4 p-4 md:p-5">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-6 w-56 max-w-full" />
                <Skeleton className="h-4 w-40" />
              </div>
              <div className={ROW_LIST}>
                {[0, 1, 2].map((row) => (
                  <div key={row} className="flex items-center gap-3 p-3">
                    <Skeleton className="h-6 w-16" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-9 w-24" />
                  </div>
                ))}
              </div>
            </AnalyticsPanel>
          ))}
        </div>
      );
    }

    if (list.competitors.length === 0) {
      return (
        <EmptyState
          icon={Compass}
          title={NO_COMPETITORS_TITLE}
          description={NO_COMPETITORS_HINT}
          action={{ label: 'Add Competitor', onClick: openAdd }}
        />
      );
    }

    const full = list.competitors.length >= list.limit;

    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <TooltipHint
            label={competitorLimitText(list.limit)}
            disabled={full}
            hidden={!full}
            triggerClassName="self-start"
          >
            <Button variant="secondary" onClick={openAdd} disabled={full}>
              <MotionIcon icon={PlusIcon} className="h-4 w-4" />
              Add Competitor
            </Button>
          </TooltipHint>
          <span className="font-sans text-sm text-ink type-muted" data-testid="competitor-count">
            {list.competitors.length} of {list.limit}
          </span>
        </div>
        {error ? (
          <Alert variant="warning" className="items-center py-3">
            <span className="flex-1">{error} Showing what loaded last.</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAttempt((count) => count + 1)}
              disabled={loading}
            >
              Try Again
            </Button>
          </Alert>
        ) : null}
        {list.competitors.map((competitor) => (
          <CompetitorGroup
            key={competitor.id}
            competitor={competitor}
            isAdmin={isAdmin}
            now={now}
            refreshKey={refreshKey}
            onCreatePost={onCreatePost}
            renderRowExtra={renderRowExtra}
            onEdit={openEdit}
            onRemove={(target) => {
              setRemoveError(null);
              setRemoving(target);
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      {content()}
      <CompetitorDialog
        open={dialogOpen}
        competitor={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={saved}
      />
      <RemoveCompetitorDialog
        competitor={removing}
        busy={removeBusy}
        error={removeError}
        onCancel={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
      />
    </>
  );
}
