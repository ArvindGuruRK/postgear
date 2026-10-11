'use client';

/**
 * The one failure that leaves no trace in the data: no worker running.
 *
 * A post that never publishes because nothing is polling the queue stays in
 * `QUEUE` looking perfectly healthy. This pill asks the API whether the
 * scheduler is reachable and whether a worker is polling, and says so next to
 * the posts it concerns. Polled every half minute while the page is open.
 */
import {
  cn,
  StatusIndicator,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@postgear/ui';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { SchedulerStatus } from '@/types/post';

const POLL_MS = 30_000;

type Shown = {
  status: 'online' | 'away' | 'busy' | 'pending';
  label: string;
  explanation: string;
};

function present(status: SchedulerStatus | null | 'unknown'): Shown {
  if (status === 'unknown') {
    return {
      status: 'pending',
      label: 'Checking scheduler',
      explanation: 'Asking the API whether the scheduler and a worker are running.',
    };
  }

  if (!status?.reachable) {
    return {
      status: 'busy',
      label: 'Scheduler unreachable',
      explanation:
        'The API cannot reach Temporal. Queued posts are kept and will be picked up when it is back; nothing publishes until then.',
    };
  }

  if (!status.workerOnline) {
    return {
      status: 'away',
      label: 'No worker running',
      explanation:
        'Temporal is up but no PostGear worker is polling it. Start one (npm run dev:worker) or nothing will publish.',
    };
  }

  return {
    status: 'online',
    label: 'Scheduler online',
    explanation: `A worker is polling "${status.taskQueue}". Queued posts publish on time; failures retry up to ${status.retryPolicy.maximumAttempts} times with backoff.`,
  };
}

export function SchedulerStatusPill({ className }: { className?: string }) {
  const [status, setStatus] = useState<SchedulerStatus | null | 'unknown'>('unknown');

  useEffect(() => {
    let cancelled = false;

    const check = () =>
      api<{ status: SchedulerStatus }>('/scheduling/status')
        .then((result) => !cancelled && setStatus(result.status))
        .catch(() => !cancelled && setStatus(null));

    void check();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void check();
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const shown = present(status);

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* A button, so the explanation is reachable by keyboard as well as hover. */}
          <button
            type="button"
            className={cn(
              'rounded-full outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
              className,
            )}
            data-testid="scheduler-status"
            data-status={shown.status}
            aria-label={`${shown.label}. ${shown.explanation}`}
          >
            <StatusIndicator
              status={shown.status}
              label={shown.label}
              className="rounded-full border-2 border-outline bg-secondary px-3 py-1 text-xs font-bold"
            />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          {shown.explanation}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
