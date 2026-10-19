'use client';

/**
 * Three numbered first steps (Buffer's "First steps"): connect a channel,
 * create a post, publish one. Each card is one line and one action, with the
 * reference's check circle in its corner, filled once the step is done.
 *
 * The row disappears once all three are done: it has nothing left to teach.
 * It has no dismiss button, since finishing is the way to make it go. It
 * renders nothing until the first steps are known, rather than a skeleton
 * that would then vanish for everyone past them, which is most people.
 */
import { ListOrderedIcon } from '@animateicons/react/lucide/list-ordered-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { SlidersHorizontalIcon } from '@animateicons/react/lucide/sliders-horizontal-icon';
import { SquarePenIcon } from '@animateicons/react/lucide/square-pen-icon';
import { Card, cn, MotionIcon, TooltipHint } from '@postgear/ui';
import { Check, CircleCheck } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { DashboardFirstSteps } from '@/types/dashboard';
import { firstStepsDone } from './home-model';
import { HomeSection, PLAIN_ACTION } from './home-ui';

export function FirstSteps({
  orgId,
  steps,
  canManage,
  atChannelLimit,
  onConnect,
}: {
  orgId: string;
  steps: DashboardFirstSteps | null;
  canManage: boolean;
  /** The plan's channel limit is reached, so Connect would be refused. */
  atChannelLimit: boolean;
  onConnect: () => void;
}) {
  if (!steps || firstStepsDone(steps)) {
    return null;
  }

  return (
    <HomeSection title="First steps" data-testid="home-first-steps">
      <ol className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-3 md:gap-4">
        <Step
          number={1}
          title="Connect a channel"
          line="Link the accounts you want to post to."
          done={steps.channel}
        >
          {canManage ? (
            <TooltipHint
              label="This plan’s channel limit is reached"
              disabled={atChannelLimit}
              hidden={!atChannelLimit}
            >
              <button
                type="button"
                className={PLAIN_ACTION}
                onClick={onConnect}
                disabled={atChannelLimit}
              >
                <MotionIcon icon={PlusIcon} className="h-4 w-4" />
                Connect channel
              </button>
            </TooltipHint>
          ) : (
            // Connecting is an admin's job; a member can still see what is there.
            <Link href={`/${orgId}/channels`} className={PLAIN_ACTION}>
              <MotionIcon icon={SlidersHorizontalIcon} className="h-4 w-4" />
              View channels
            </Link>
          )}
        </Step>
        <Step
          number={2}
          title="Create a post"
          line="Write your first post and schedule it."
          done={steps.post}
        >
          <Link href={`/${orgId}/composer`} className={PLAIN_ACTION}>
            <MotionIcon icon={SquarePenIcon} className="h-4 w-4" />
            Create post
          </Link>
        </Step>
        <Step
          number={3}
          title="Publish a post"
          line="Send a post out to start your streak."
          done={steps.published}
        >
          <Link href={`/${orgId}/queue`} className={PLAIN_ACTION}>
            <MotionIcon icon={ListOrderedIcon} className="h-4 w-4" />
            Open queue
          </Link>
        </Step>
      </ol>
    </HomeSection>
  );
}

function Step({
  number,
  title,
  line,
  done,
  children,
}: {
  number: number;
  title: string;
  line: string;
  done: boolean;
  children: ReactNode;
}) {
  return (
    <li className="flex" data-testid="home-step" data-done={done}>
      <Card className="flex w-full flex-col items-start gap-3 p-4 md:p-5">
        <span className="flex w-full items-start justify-between gap-3">
          <span className="flex min-w-0 flex-col gap-1">
            <span className="type-ui text-sm text-ink md:text-base">
              {number}. {title}
            </span>
            <span className="font-sans text-sm text-ink opacity-75">{line}</span>
          </span>
          {done ? (
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-outline bg-actionSuccess text-onActionLight"
              role="img"
              aria-label="Done"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
            </span>
          ) : (
            <span role="img" aria-label="Not done yet" className="shrink-0">
              <CircleCheck
                className={cn('h-6 w-6 text-ink opacity-30')}
                strokeWidth={2}
                aria-hidden="true"
              />
            </span>
          )}
        </span>
        <span className="mt-auto">{children}</span>
      </Card>
    </li>
  );
}
