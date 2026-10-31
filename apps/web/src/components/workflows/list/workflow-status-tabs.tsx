'use client';

/**
 * The list's status filter (All, Active, Paused, Draft), set as Queue's state
 * tabs are: the shared segmented control (`SEGMENTED_LIST`, `SEGMENTED_TRIGGER`
 * from the Analytics page) with a count badge in each tab. Counts are the whole
 * workspace's, whichever tab is chosen, so "3 paused" shows before anyone
 * clicks it. On the chosen tab, which is itself blue, the badge turns to the
 * card surface so it never disappears into the fill.
 */
import { Badge, cn, Tabs, TabsList, TabsTrigger } from '@postgear/ui';
import { SEGMENTED_LIST, SEGMENTED_TRIGGER } from '@/components/analytics/analytics-ui';
import type { AutomationStatus, AutomationStatusCounts } from '@/types/workflows';
import { STATUS_FILTERS } from './workflows-view-model';

export type StatusFilter = AutomationStatus | 'ALL';

export function WorkflowStatusTabs({
  value,
  counts,
  onChange,
}: {
  value: StatusFilter;
  /** Null until the list has loaded. */
  counts: AutomationStatusCounts | null;
  onChange: (value: StatusFilter) => void;
}) {
  return (
    <Tabs
      className="w-fit max-w-full"
      value={value}
      onValueChange={(next) => onChange(next as StatusFilter)}
    >
      <TabsList
        aria-label="Filter by status"
        data-testid="workflow-status-filter"
        className={cn(SEGMENTED_LIST, 'inline-flex max-w-full')}
      >
        {STATUS_FILTERS.map((filter) => {
          const count = counts?.[filter.id];
          return (
            <TabsTrigger
              key={filter.id}
              value={filter.id}
              className={cn(SEGMENTED_TRIGGER, 'group gap-2')}
            >
              {filter.label}
              {count === undefined ? null : <CountBadge status={filter.id} count={count} />}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}

/** A tab's count: green for Active, blue for the rest, as Queue's tabs colour theirs. */
function CountBadge({ status, count }: { status: StatusFilter; count: number }) {
  const active = status === 'ACTIVE';
  return (
    <>
      <Badge
        aria-hidden="true"
        variant={active ? 'success' : 'primary'}
        className={cn(
          'min-w-6 justify-center px-1.5 py-0.5 leading-none tabular-nums',
          !active && 'group-data-[state=active]:bg-secondary group-data-[state=active]:text-ink',
        )}
      >
        {count}
      </Badge>
      {/* Read as "Active 2 workflows" rather than "Active 2". */}
      <span className="sr-only">
        {count} {count === 1 ? 'workflow' : 'workflows'}
      </span>
    </>
  );
}
