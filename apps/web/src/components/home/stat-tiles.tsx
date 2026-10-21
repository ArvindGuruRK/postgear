'use client';

/**
 * The week at a glance (Home revamp, 2026-10-22): four separate cards, each a
 * number, the progress behind it and one line on what it means.
 *
 * - **Week streak**: a chain of the last eight weeks, this week last.
 * - **Weekly goal**: published of target as segments (a bar past twelve).
 * - **AI credits**: what is left of the cycle's allowance.
 * - **Team**: who is in, against the plan's seats, and the way to invite more.
 *
 * Two columns on a phone, four from `xl`. Every card has the same four rows
 * (name, number, progress, caption), so a row of them lines up without the
 * empty space the old single strip had. The streak and the goal wait for the
 * viewer's own weeks (`useDashboard`) and hold a skeleton until then.
 *
 * What each number counts sits behind the info button's tooltip. Admins
 * change the goal from the pencil on its card and invite from the team card;
 * everyone else reads them.
 */
import { InfoIcon } from '@animateicons/react/lucide/info-icon';
import { PencilIcon } from '@animateicons/react/lucide/pencil-icon';
import { UserPlusIcon } from '@animateicons/react/lucide/user-plus-icon';
import {
  AvatarGroup,
  AvatarGroupItem,
  cn,
  fillSegments,
  MotionIcon,
  Progress,
  type ProgressSegment,
  SegmentedProgress,
  Skeleton,
  TooltipHint,
} from '@postgear/ui';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { formatResetDate } from '@/components/ai/credits-meter';
import { UserAvatar } from '@/components/profile/user-avatar';
import { avatarSeed, displayName } from '@/components/settings/team-view-model';
import type { AiCredits } from '@/types/ai';
import type { DashboardSummary } from '@/types/dashboard';
import type { TeamMember } from '@/types/team';
import { GoalEditor } from './goal-editor';
import {
  goalCaption,
  goalProgress,
  plural,
  type StreakWeek,
  seatSummary,
  streakCaption,
  streakChain,
  streakHint,
} from './home-model';
import { FOCUS, HomePanel, TEXT_LINK } from './home-ui';

/** Past this many posts a week, segments get too thin to read and the goal is a bar. */
const MAX_GOAL_SEGMENTS = 12;

/** The small round button in a card's corner (info, edit). */
const CORNER = cn(
  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink muted-tone hover:opacity-100 sm:h-7 sm:w-7',
  FOCUS,
);

export function StatTiles({
  orgId,
  summary,
  failed,
  credits,
  pending,
  mounted,
  canManage,
  members,
  memberLimit,
  onSaveGoal,
  onInvite,
}: {
  orgId: string;
  /** The zoned summary; null while loading or after a failure (the banner says which). */
  summary: DashboardSummary | null;
  /** The summary failed and there is nothing to show. */
  failed: boolean;
  credits: AiCredits | null;
  /** Nothing scoped yet because the page is still switching workspace: loading, not failed. */
  pending: boolean;
  /** The browser has rendered once, so numbers and dates can use its locale. */
  mounted: boolean;
  canManage: boolean;
  /** Null when the list failed to load. */
  members: TeamMember[] | null;
  /** The plan's seats: null for unlimited, undefined when the plan did not load. */
  memberLimit: number | null | undefined;
  onSaveGoal: (target: number | null) => Promise<void>;
  onInvite: () => void;
}) {
  return (
    <section
      aria-label="This week"
      // Four across from `xl`: with the card names at the section headings'
      // size, a name like "Weekly goal" does not fit one line in a quarter of
      // a laptop-width page, and the numbers would sit at different heights.
      className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4"
      data-testid="home-stats"
    >
      <StreakTile summary={summary} failed={failed} />
      <GoalTile summary={summary} failed={failed} canEdit={canManage} onSave={onSaveGoal} />
      <CreditsTile credits={credits} pending={pending} mounted={mounted} />
      <TeamTile
        orgId={orgId}
        members={members}
        limit={memberLimit}
        pending={pending}
        canManage={canManage}
        onInvite={onInvite}
      />
    </section>
  );
}

function StreakTile({ summary, failed }: { summary: DashboardSummary | null; failed: boolean }) {
  const streak = summary?.streak;

  return (
    <Tile
      emoji="🔥"
      label="Week Streak"
      corner={
        <InfoButton
          label="Week Streak"
          info={streak ? streakHint(streak) : 'Weeks in a row with at least one published post.'}
        />
      }
      value={streak?.weeks ?? null}
      unit={streak ? plural(streak.weeks, 'week', 'weeks') : null}
      failed={failed}
      meter={streak ? <Chain weeks={streakChain(streak)} /> : null}
      caption={streak ? streakCaption(streak) : null}
      data-testid="home-streak"
      data-weeks={streak?.weeks}
    />
  );
}

function GoalTile({
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
  const info =
    'Posts published this week, Monday to Sunday, against the weekly goal. Each channel counts.';

  return (
    <Tile
      emoji="🎯"
      label="Weekly Goal"
      corner={
        <span className="flex items-center">
          {goal && canEdit ? (
            <GoalEditor goal={goal} onSave={onSave}>
              <button
                type="button"
                className={CORNER}
                aria-label={`Weekly goal: ${goal.published} of ${goal.target} published. Change the goal`}
              >
                <MotionIcon icon={PencilIcon} size={14} className="h-3.5 w-3.5" />
              </button>
            </GoalEditor>
          ) : null}
          <InfoButton label="Weekly Goal" info={info} />
        </span>
      }
      value={goal?.published ?? null}
      unit={goal ? `of ${goal.target}` : null}
      failed={failed}
      meter={
        goal ? (
          goal.target <= MAX_GOAL_SEGMENTS ? (
            <Segments total={goal.target} filled={goal.published} />
          ) : (
            <Meter
              value={goalProgress(goal.published, goal.target)}
              tone="primary"
              label={`${goal.published} of ${goal.target} published`}
              text={percentText(goalProgress(goal.published, goal.target))}
            />
          )
        ) : null
      }
      caption={goal ? goalCaption(goal.published, goal.target) : null}
      data-testid="home-goal"
      data-published={goal?.published}
      data-target={goal?.target}
      data-custom={goal?.custom}
    />
  );
}

function CreditsTile({
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
  const resets = credits && mounted ? `resets ${formatResetDate(credits.resetsAt)}` : null;

  return (
    <Tile
      emoji="✨"
      label="AI Credits"
      corner={
        <InfoButton
          label="AI Credits"
          // Tooltip content renders only when opened, in the browser, so the
          // reset date can use the viewer's locale.
          info={
            credits
              ? `Used by AI posts, images and the copilot. ${credits.remaining} of ${credits.allowance} left this cycle${credits.low ? ', running low' : ''}; resets ${formatResetDate(credits.resetsAt)}.`
              : 'Used by AI posts, images and the copilot.'
          }
        />
      }
      value={value}
      unit={credits ? 'left' : null}
      danger={credits?.low ?? false}
      failed={credits === null && !pending}
      meter={
        credits ? (
          <Meter
            value={credits.allowance > 0 ? credits.remaining / credits.allowance : 0}
            tone={credits.low ? 'danger' : 'ai'}
            label="AI credits left"
            text={percentText(credits.allowance > 0 ? credits.remaining / credits.allowance : 0)}
          />
        ) : null
      }
      caption={
        credits
          ? [`${credits.allowance.toLocaleString()} this cycle`, resets].filter(Boolean).join(', ')
          : null
      }
      data-testid="home-credits"
      data-remaining={credits?.remaining}
    />
  );
}

function TeamTile({
  orgId,
  members,
  limit,
  pending,
  canManage,
  onInvite,
}: {
  orgId: string;
  members: TeamMember[] | null;
  limit: number | null | undefined;
  pending: boolean;
  canManage: boolean;
  onInvite: () => void;
}) {
  const active = members?.filter((member) => !member.disabled) ?? null;
  const seats = active ? seatSummary(active.length, limit) : null;

  return (
    <Tile
      emoji="🤝"
      label="Team"
      corner={
        active && active.length > 0 ? (
          <AvatarGroup size="xs" max={3}>
            {active.map((member) => (
              <AvatarGroupItem key={member.userId} name={displayName(member)}>
                <UserAvatar name={avatarSeed(member)} avatar={member.avatar} />
              </AvatarGroupItem>
            ))}
          </AvatarGroup>
        ) : null
      }
      value={active?.length ?? null}
      unit={seats?.unit ?? null}
      failed={members === null && !pending}
      meter={
        seats?.progress != null ? (
          <Meter value={seats.progress} tone="primary" label="Seats used" />
        ) : null
      }
      caption={
        canManage ? (
          <button type="button" onClick={onInvite} className={cn(TEXT_LINK, 'text-xs')}>
            <MotionIcon icon={UserPlusIcon} size={14} className="h-3.5 w-3.5" />
            Invite Members
          </button>
        ) : (
          <Link href={`/${orgId}/settings/team`} className={cn(TEXT_LINK, 'text-xs')}>
            View Team
          </Link>
        )
      }
      // The caption row is the invite (or the team page), so the seats
      // line sits on the same row, before it.
      note={seats?.caption ?? null}
      data-testid="home-team"
      data-members={active?.length}
    />
  );
}

/**
 * One card: its name and corner control, the number with its unit, the
 * progress, and a caption. A skeleton holds each row's place until its data
 * exists, so nothing below moves when it arrives.
 */
function Tile({
  emoji,
  label,
  corner,
  value,
  unit,
  failed,
  danger = false,
  meter,
  caption,
  note,
  ...props
}: {
  /** A real emoji, drawn by the viewer's system font, in place of a line icon. */
  emoji: string;
  label: string;
  corner?: ReactNode;
  value: ReactNode;
  unit: string | null;
  failed: boolean;
  danger?: boolean;
  meter: ReactNode;
  caption: ReactNode;
  /** A muted line beside the caption when the caption is an action (the team's seats). */
  note?: string | null;
  'data-testid': string;
  [data: `data-${string}`]: string | number | boolean | undefined;
}) {
  const loading = value === null && !failed;

  return (
    // Tighter on a phone, where two cards share the row and the names need the room.
    //
    // A `HomePanel`: the theme's frame colour, not the Card's near-white (see
    // `home-ui.tsx`). The meters' empty tracks are the ink at low strength, so
    // they read on it in every theme.
    <HomePanel className="flex min-w-0 flex-col gap-3 p-3 sm:p-4 md:p-5" {...props}>
      {/* On a phone two cards share the row and a name at the section
          headings' size may wrap ("Weekly / goal"), so the header keeps two
          lines whether or not it needs them and the numbers below stay level
          across the row. From `sm` there is room for one line. */}
      <div className="flex min-h-14 items-start justify-between gap-2 sm:min-h-8 sm:items-center">
        <span className="flex min-w-0 items-start gap-1.5 sm:items-center sm:gap-2">
          <span
            aria-hidden="true"
            data-testid="home-tile-emoji"
            // A real emoji with no frame around it (the owner's call, only on
            // these four cards), in its own colours. Decorative: the name
            // beside it says what the card is. Hidden on a phone, where the
            // name needs the room.
            className="hidden shrink-0 text-2xl leading-none sm:block"
          >
            {emoji}
          </span>
          {/* The same role and size as the section headings (First steps, Up
              next), so a card's name and a section's read as one family. */}
          <span className="min-w-0 type-heading text-lg text-ink" data-testid="home-tile-label">
            {label}
          </span>
        </span>
        {corner}
      </div>

      <div className="flex min-h-9 items-baseline gap-1.5 md:min-h-10">
        {value !== null ? (
          <>
            <span
              className={cn(
                'type-heading text-3xl leading-none tabular-nums md:text-4xl',
                danger ? 'text-dangerInk' : 'text-ink',
              )}
            >
              {value}
            </span>
            {unit ? (
              <span className="truncate font-sans text-sm text-ink type-muted">{unit}</span>
            ) : null}
          </>
        ) : failed ? (
          <span className="self-center font-sans text-sm text-ink type-muted">Unavailable</span>
        ) : (
          <Skeleton
            className="h-8 w-16 self-center"
            aria-label={`Loading ${label.toLowerCase()}`}
          />
        )}
      </div>

      <div className="mt-auto flex min-w-0 flex-col gap-2">
        {meter ?? (loading ? <Skeleton className="h-3 w-full" /> : null)}
        {caption !== null ? (
          typeof caption === 'string' ? (
            <span className="font-sans text-xs text-ink type-muted">{caption}</span>
          ) : (
            // One row, so this card's bar lines up with its neighbours'.
            <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
              {note ? <span className="font-sans text-xs text-ink type-muted">{note}</span> : null}
              {caption}
            </span>
          )
        ) : loading ? (
          <Skeleton className="h-3 w-24" />
        ) : null}
      </div>
    </HomePanel>
  );
}

function InfoButton({ label, info }: { label: string; info: string }) {
  return (
    <TooltipHint label={info}>
      <button type="button" aria-label={`About ${label.toLowerCase()}`} className={CORNER}>
        <MotionIcon icon={InfoIcon} size={14} className="h-3.5 w-3.5" />
      </button>
    </TooltipHint>
  );
}

/**
 * The design system's own `Progress`, small: the outlined pill with a striped
 * fill, a dotted track and the figure written in it (the `/dev/components`
 * specimen), with the system's own animation: the stripes crawl (and stop
 * under reduced motion), and the fill slides when its value changes. Its
 * colours are the ones the system already gives each meaning: `primary` blue
 * for progress (seats, and a goal too big for segments; the goal stays blue
 * even when met), `ai` violet for credits (`danger` red when low).
 *
 * Used unbroken for AI credits and Team. The streak (a chain of weeks) and the
 * goal (one cell per post) are the same bar cut into gapped cells, which is
 * the system's `SegmentedProgress` (`Segments`, `Chain` below).
 */
function Meter({
  value,
  tone,
  label,
  text,
}: {
  /** 0 to 1. */
  value: number;
  tone: ComponentProps<typeof Progress>['tone'];
  /** What the bar measures, for assistive tech. */
  label: string;
  /**
   * What is written inside the bar ("92%"). Left out where the card already
   * says it in words (Team: "2 of 3 seats").
   */
  text?: string;
}) {
  return (
    <Progress
      value={Math.round(Math.min(1, Math.max(0, value)) * 100)}
      tone={tone}
      size="sm"
      label={text}
      aria-label={label}
    />
  );
}

/**
 * The goal as one cell per post, blue as they go out and still blue once met
 * (never green: the owner's call). The design system's `SegmentedProgress`:
 * the stripes run through the gaps as one pattern.
 */
function Segments({ total, filled }: { total: number; filled: number }) {
  return (
    <SegmentedProgress
      segments={fillSegments(filled, total)}
      tone="primary"
      aria-label={`${filled} of ${total} published`}
    />
  );
}

/** The streak's chain of weeks: orange for a week with a post, dashed for this week still open. */
function Chain({ weeks }: { weeks: StreakWeek[] }) {
  const done = weeks.filter((week) => week === 'done').length;

  return (
    <SegmentedProgress
      segments={weeks.map(
        (week): ProgressSegment => (week === 'done' ? 'full' : week === 'open' ? 'open' : 'empty'),
      )}
      tone="accent"
      aria-label={`${done} of the last ${weeks.length} weeks with a post`}
    />
  );
}

/** A share written the way the bar shows it: "86%". */
function percentText(value: number): string {
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
}
