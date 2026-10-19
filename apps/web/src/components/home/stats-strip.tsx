'use client';

/**
 * The week in three numbers, in one framed row (Buffer's stat strip): the
 * posting streak (a Postiz-style flame), the weekly goal as a ring, and the
 * AI credits left.
 *
 * The three cells stay in one row at every width; on a phone each stacks its
 * picture over its number and label so all three fit. The streak and the
 * goal wait for the viewer's own weeks (`useDashboard`), so they hold a
 * skeleton of their final size until then; the credits arrive with the page.
 *
 * Explanations sit behind an info button's tooltip: the numbers are glanced
 * at, and what they count is only needed once. Admins open the goal cell to
 * change the goal; everyone else reads it.
 */
import { InfoIcon } from '@animateicons/react/lucide/info-icon';
import { PencilIcon } from '@animateicons/react/lucide/pencil-icon';
import { Card, cn, MotionIcon, Skeleton, TooltipHint } from '@postgear/ui';
import { Check, Flame, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatResetDate } from '@/components/ai/credits-meter';
import type { AiCredits } from '@/types/ai';
import type { DashboardSummary } from '@/types/dashboard';
import { GoalEditor } from './goal-editor';
import { goalProgress, streakHint } from './home-model';
import { FOCUS } from './home-ui';

/** The round frame each cell's picture sits in. */
const DISC =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-outline bg-secondary md:h-12 md:w-12';

/** A cell's layout: picture, then number over label (picture beside them from `md`). */
const CELL =
  'flex h-full w-full min-w-0 flex-col items-center gap-2 px-1.5 py-4 text-center md:flex-row md:gap-4 md:px-5 md:py-5 md:text-start';

export function StatsStrip({
  summary,
  failed,
  credits,
  creditsPending,
  mounted,
  canEditGoal,
  onSaveGoal,
}: {
  /** The zoned summary; null while loading or after a failure (the banner says which). */
  summary: DashboardSummary | null;
  /** The summary failed and there is nothing to show. */
  failed: boolean;
  credits: AiCredits | null;
  /** No balance yet because the page is still switching workspace: loading, not failed. */
  creditsPending: boolean;
  /** The browser has rendered once, so numbers can use its locale. */
  mounted: boolean;
  canEditGoal: boolean;
  onSaveGoal: (target: number | null) => Promise<void>;
}) {
  return (
    <Card
      className="grid grid-cols-3 overflow-hidden"
      aria-label="This week"
      role="group"
      data-testid="home-stats"
    >
      <StreakCell summary={summary} failed={failed} />
      <GoalCell summary={summary} failed={failed} canEdit={canEditGoal} onSave={onSaveGoal} />
      <CreditsCell credits={credits} pending={creditsPending} mounted={mounted} />
    </Card>
  );
}

function StreakCell({ summary, failed }: { summary: DashboardSummary | null; failed: boolean }) {
  const streak = summary?.streak;
  const live = streak ? streak.weeks > 0 : false;

  return (
    <div className={CELL} data-testid="home-streak" data-weeks={streak?.weeks}>
      {streak || failed ? (
        <span className={DISC} aria-hidden="true">
          <Flame
            strokeWidth={2.25}
            // Orange in every state (the user's call; the avatar palette's
            // orange, which is the same in every theme). Filled while there
            // is a streak, even one waiting on this week's post (the tooltip
            // says so); an outline at zero.
            className={cn('h-5 w-5 text-avatar5 md:h-6 md:w-6', live && 'fill-avatar5')}
          />
        </span>
      ) : (
        <PictureSkeleton />
      )}
      <CellText
        value={streak ? streak.weeks : null}
        failed={failed}
        label="Week streak"
        info={streak ? streakHint(streak) : 'Weeks in a row with at least one published post.'}
      />
    </div>
  );
}

function GoalCell({
  summary,
  failed,
  canEdit,
  onSave,
}: {
  summary: DashboardSummary | null;
  failed: boolean;
  canEdit: boolean;
  onSave: (target: number | null) => Promise<void>;
}) {
  const goal = summary?.goal;
  const value = goal ? `${goal.published}/${goal.target}` : null;
  const info =
    'Posts published this week, Monday to Sunday, against the weekly goal. Each channel counts.';

  if (goal && canEdit) {
    return (
      <GoalEditor goal={goal} onSave={onSave}>
        <button
          type="button"
          className={cn(
            CELL,
            'hover:bg-actionPrimary/10',
            FOCUS,
            'focus-visible:outline-offset-[-3px]',
          )}
          aria-label={`Weekly goal: ${goal.published} of ${goal.target} published. Change the goal`}
          data-testid="home-goal"
          data-published={goal.published}
          data-target={goal.target}
          data-custom={goal.custom}
        >
          <GoalRing published={goal.published} target={goal.target} />
          <span className="flex min-w-0 flex-col items-center gap-1 md:items-start">
            <span className="type-heading text-xl leading-none text-ink tabular-nums md:text-2xl">
              {value}
            </span>
            <span className="flex items-center gap-1 font-sans text-xs text-ink opacity-80 md:text-sm">
              Weekly goal
              <MotionIcon icon={PencilIcon} size={14} className="h-3.5 w-3.5" />
            </span>
          </span>
        </button>
      </GoalEditor>
    );
  }

  return (
    <div
      className={CELL}
      data-testid="home-goal"
      data-published={goal?.published}
      data-target={goal?.target}
      data-custom={goal?.custom}
    >
      {goal ? (
        <GoalRing published={goal.published} target={goal.target} />
      ) : failed ? (
        // The bare track: nothing to measure, and nothing still loading.
        <GoalRing published={0} target={1} />
      ) : (
        <PictureSkeleton />
      )}
      <CellText value={value} failed={failed} label="Weekly goal" info={info} />
    </div>
  );
}

function CreditsCell({
  credits,
  pending,
  mounted,
}: {
  credits: AiCredits | null;
  pending: boolean;
  mounted: boolean;
}) {
  // Grouped in the viewer's locale once mounted; the server renders the bare
  // number, so the first client render matches it.
  const value = credits
    ? mounted
      ? credits.remaining.toLocaleString()
      : String(credits.remaining)
    : null;

  return (
    <div className={CELL} data-testid="home-credits" data-remaining={credits?.remaining}>
      <span className={DISC} aria-hidden="true">
        <Sparkles strokeWidth={2.25} className="h-5 w-5 fill-actionAi text-ink md:h-6 md:w-6" />
      </span>
      <CellText
        value={value}
        failed={credits === null && !pending}
        label="AI credits left"
        danger={credits?.low ?? false}
        // Tooltip content renders only when opened, in the browser, so the
        // reset date can use the viewer's locale.
        info={
          credits
            ? `Used by AI posts, images and the copilot. ${credits.remaining} of ${credits.allowance} left this cycle${credits.low ? ', running low' : ''}; resets ${formatResetDate(credits.resetsAt)}.`
            : 'Used by AI posts, images and the copilot.'
        }
      />
    </div>
  );
}

/** The number over its label, with the info button. A skeleton until the number exists. */
function CellText({
  value,
  failed,
  label,
  info,
  danger = false,
}: {
  value: ReactNode;
  failed: boolean;
  label: string;
  info: string;
  danger?: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-col items-center gap-1 md:items-start">
      {value !== null ? (
        <span
          className={cn(
            'type-heading text-xl leading-none tabular-nums md:text-2xl',
            danger ? 'text-dangerInk' : 'text-ink',
          )}
        >
          {value}
        </span>
      ) : failed ? (
        <span className="font-sans text-xs leading-5 text-ink opacity-60 md:text-sm md:leading-6">
          Unavailable
        </span>
      ) : (
        <Skeleton className="h-5 w-10 md:h-6 md:w-12" aria-label={`Loading ${label}`} />
      )}
      <span className="flex items-center gap-1 font-sans text-xs text-ink opacity-80 md:text-sm">
        {label}
        <TooltipHint label={info}>
          <button
            type="button"
            aria-label={`About ${label.toLowerCase()}`}
            className={cn(
              'flex h-5 w-5 shrink-0 items-center justify-center rounded-full opacity-80 hover:opacity-100',
              FOCUS,
            )}
          >
            <MotionIcon icon={InfoIcon} size={14} className="h-3.5 w-3.5" />
          </button>
        </TooltipHint>
      </span>
    </span>
  );
}

function PictureSkeleton() {
  return <Skeleton className="h-10 w-10 shrink-0 rounded-full md:h-12 md:w-12" />;
}

/**
 * Published of target as a ring: the primary blue on its way, success green
 * once met. Hard ends and a flat stroke, as every chart here is drawn
 * (§16c); the track is the ink at low opacity so it reads in both schemes.
 */
function GoalRing({ published, target }: { published: number; target: number }) {
  const radius = 19;
  const circumference = 2 * Math.PI * radius;
  const progress = goalProgress(published, target);
  const met = published >= target;

  return (
    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center md:h-12 md:w-12">
      <svg viewBox="0 0 48 48" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="24" cy="24" r={radius} fill="none" strokeWidth="6" className="stroke-ink/15" />
        {progress > 0 ? (
          <circle
            cx="24"
            cy="24"
            r={radius}
            fill="none"
            strokeWidth="6"
            strokeLinecap="butt"
            strokeDasharray={`${circumference * progress} ${circumference}`}
            className={met ? 'stroke-actionSuccess' : 'stroke-actionPrimary'}
          />
        ) : null}
      </svg>
      {met ? (
        <Check
          aria-hidden="true"
          strokeWidth={3}
          className="absolute h-4 w-4 text-ink md:h-5 md:w-5"
        />
      ) : null}
    </span>
  );
}
