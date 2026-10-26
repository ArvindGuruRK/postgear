'use client';

import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { ArrowRightIcon } from '@animateicons/react/lucide/arrow-right-icon';
import { Button, cn, FormErrorMessage, MotionIcon, pressSm, Spinner } from '@postgear/ui';
import type { ReactNode, Ref } from 'react';
import { BrandMark, BrandWordmark } from '@/components/brand/brand-mark';
import { ThemeToggle } from '@/components/navigation/theme-toggle';

/**
 * The frame every onboarding screen shares, laid out after Buffer's
 * (docs/screenshots 20 to 23): back arrow and brand on the left, progress
 * dots in the middle, the theme toggle on the right; the question centred
 * under it with one wide Continue and a quiet Skip.
 */

const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

/**
 * Skip is a real button, drawn like the calendar's "Add Channel"
 * (`TILE` in calendar/channels-column.tsx): the card colour with the border
 * and hard shadow, the same 44px as Continue so the two line up (2026-10-20;
 * it was a plain text link before).
 */
const SKIP_BUTTON = cn(
  'flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-lg border-2 border-outline bg-secondary px-3 type-ui text-sm text-ink',
  pressSm,
  'disabled:opacity-50',
  FOCUS,
);

/**
 * Three columns so the dots stay centred on the page whatever the two sides
 * hold. Padding grows to the safe-area insets on a phone with a notch
 * (`viewport-fit=cover`, root layout).
 */
export function OnboardingHeader({
  onBack,
  backDisabled = false,
  progress,
}: {
  /** Omitted on the welcome screen, which has nothing to go back to. */
  onBack?: () => void;
  backDisabled?: boolean;
  /** 1-based screen number and the total; omitted on the welcome screen. */
  progress?: { current: number; total: number };
}) {
  return (
    <header className="relative z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-3 pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-4 pl-[max(1rem,env(safe-area-inset-left))] md:pt-[max(1.25rem,env(safe-area-inset-top))] md:pr-[max(1.5rem,env(safe-area-inset-right))] md:pl-[max(1.5rem,env(safe-area-inset-left))]">
      <div className="flex min-w-0 items-center gap-1 md:gap-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            disabled={backDisabled}
            aria-label="Back"
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink hover:bg-secondary disabled:opacity-50',
              FOCUS,
            )}
          >
            <MotionIcon icon={ArrowLeftIcon} size={18} className="h-[18px] w-[18px]" />
          </button>
        ) : null}
        <Brand />
      </div>

      {progress ? <ProgressDots {...progress} /> : <span />}

      <div className="flex justify-end">
        <ThemeToggle saveToAccount />
      </div>
    </header>
  );
}

/** The rail's logo mark at header size, with the wordmark beside it from `sm`. */
function Brand() {
  return (
    <span className="flex min-w-0 items-center gap-2 text-ink">
      <BrandMark className="h-11 w-11" />
      <BrandWordmark className="hidden h-5 sm:block" />
      <span className="sr-only">PostGear</span>
    </span>
  );
}

/**
 * One dot per screen. The ones reached are solid, the rest faint, so the dots
 * say how far there is to go as well as where you are.
 */
function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div
      role="progressbar"
      aria-label="Setup progress"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current}
      aria-valuetext={`Step ${current} of ${total}`}
      className="flex items-center gap-1.5"
    >
      {Array.from({ length: total }, (_, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed row of dots, never reordered
          key={index}
          className={cn(
            'h-1.5 w-1.5 rounded-full transition-colors duration-200',
            index < current ? 'bg-ink' : 'bg-ink/20',
          )}
        />
      ))}
    </div>
  );
}

/**
 * One question: the heading, whatever answers it (a grid of cards, a field),
 * then Continue and Skip. `titleRef` lets the wizard move focus to the
 * heading when the screen changes, so a screen reader starts reading the new
 * question rather than staying on a button that no longer exists.
 */
export function QuestionScreen({
  titleId,
  titleRef,
  title,
  children,
  error,
  pending,
  canContinue,
  continueLabel = 'Continue',
  onContinue,
  onSkip,
  width = 'grid',
}: {
  titleId: string;
  titleRef: Ref<HTMLHeadingElement>;
  title: string;
  children: ReactNode;
  error: string | null;
  pending: boolean;
  canContinue: boolean;
  continueLabel?: string;
  onContinue: () => void;
  /** Omitted where the screen cannot be skipped: the workspace and the profile. */
  onSkip?: () => void;
  /**
   * `grid` for two columns of cards, `form` for a single column, `wide` for
   * the profile step's avatars: nine to a row at the size four to a row had
   * in a `form` column (about 103px each).
   */
  width?: 'grid' | 'form' | 'wide';
}) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center pt-4 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(3rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]">
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (canContinue && !pending) onContinue();
        }}
        className={cn(
          'flex w-full flex-col items-center gap-8',
          { grid: 'max-w-2xl', form: 'max-w-md', wide: 'max-w-5xl' }[width],
        )}
      >
        <h1
          id={titleId}
          ref={titleRef}
          tabIndex={-1}
          // As wide as the grid under it, so a question of this length
          // ("How would you describe yourself?") stays on one line from `md`,
          // as in the reference; a longer one wraps, balanced.
          className="max-w-2xl text-center type-heading text-2xl text-ink outline-none md:text-3xl"
        >
          {title}
        </h1>

        {children}

        {/* 15rem: narrower than the grid above, so Continue reads as one
            button and not a bar (2026-10-20). Skip matches its width. */}
        <div className="flex w-full max-w-60 flex-col items-center gap-3">
          {error ? <FormErrorMessage className="text-center">{error}</FormErrorMessage> : null}

          <Button type="submit" className="w-full" disabled={pending || !canContinue}>
            {continueLabel}
            {pending ? (
              <Spinner size="sm" className="border-current border-t-transparent" />
            ) : (
              <MotionIcon icon={ArrowRightIcon} className="h-4 w-4" />
            )}
          </Button>

          {onSkip ? (
            <button type="button" onClick={onSkip} disabled={pending} className={SKIP_BUTTON}>
              Skip
            </button>
          ) : null}
        </div>
      </form>
    </main>
  );
}
