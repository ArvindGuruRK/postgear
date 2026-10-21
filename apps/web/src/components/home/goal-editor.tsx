'use client';

/**
 * The weekly goal's editor: a popover on the goal cell, for admins only (the
 * API refuses the change from anyone else).
 *
 * A number stepper from 1 to 100, Save, and "Use suggested", which hands the
 * goal back to the suggestion derived from the onboarding answer (the API
 * takes `null` for that). It is quiet text rather than a second filled
 * button, the "Skip questions" treatment, so Save stays the one main action.
 */
import { MinusIcon } from '@animateicons/react/lucide/minus-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import {
  Button,
  cn,
  FormErrorMessage,
  Input,
  Label,
  MotionIcon,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@postgear/ui';
import { type FormEvent, type ReactElement, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { type DashboardGoalSetting, MAX_WEEKLY_GOAL, MIN_WEEKLY_GOAL } from '@/types/dashboard';
import { clampGoal } from './home-model';
import { FOCUS } from './home-ui';

/**
 * A square icon button: the design system's secondary at its normal height
 * (`md`, 44px) with the width of a square and no side padding, so the stepper
 * has the same fill-on-hover as every other secondary button.
 */
const STEP = 'w-11 shrink-0 px-0';

const QUIET = cn(
  'rounded-sm font-sans text-sm font-bold text-ink underline underline-offset-2',
  'disabled:pointer-events-none disabled:opacity-50',
  FOCUS,
);

export function GoalEditor({
  goal,
  onSave,
  children,
}: {
  goal: DashboardGoalSetting;
  /** Saves a target, or null for the suggestion. Rejects with the API's message. */
  onSave: (target: number | null) => Promise<void>;
  /** The goal cell, which opens the editor. */
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(goal.target));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function openChange(next: boolean) {
    if (next) {
      // Every opening starts from the goal as it stands, not an abandoned edit.
      setDraft(String(goal.target));
      setError(null);
    }
    setOpen(next);
  }

  const value = clampGoal(Number(draft));

  async function save(target: number | null) {
    setSaving(true);
    setError(null);
    try {
      await onSave(target);
      setOpen(false);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'The goal could not be saved. Try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void save(value);
  }

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="center"
        className="w-[min(18rem,calc(100vw-2rem))]"
        // Straight into the number, selected, so typing replaces it.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.focus();
          input.current?.select();
        }}
      >
        <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Weekly goal">
          <div className="flex flex-col gap-2">
            <Label htmlFor="home-weekly-goal">Posts a week</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                className={STEP}
                aria-label="One fewer"
                disabled={saving || value <= MIN_WEEKLY_GOAL}
                onClick={() => setDraft(String(clampGoal(value - 1)))}
              >
                <MotionIcon icon={MinusIcon} className="h-4 w-4" />
              </Button>
              <Input
                ref={input}
                id="home-weekly-goal"
                type="number"
                inputMode="numeric"
                min={MIN_WEEKLY_GOAL}
                max={MAX_WEEKLY_GOAL}
                step={1}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => setDraft(String(value))}
                className="min-w-0 flex-1 text-center tabular-nums"
                disabled={saving}
              />
              <Button
                type="button"
                variant="secondary"
                className={STEP}
                aria-label="One more"
                disabled={saving || value >= MAX_WEEKLY_GOAL}
                onClick={() => setDraft(String(clampGoal(value + 1)))}
              >
                <MotionIcon icon={PlusIcon} className="h-4 w-4" />
              </Button>
            </div>
            {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
          </div>

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              className={QUIET}
              disabled={saving || !goal.custom}
              onClick={() => void save(null)}
            >
              Use Suggested
            </button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
