'use client';

/**
 * Premium looks in a workspace whose plan does not include them (Sprint 9b,
 * section 9): the Luxury collection and the hand-made originals.
 *
 * A locked template card, theme tile or art tile still shows, since people
 * should see what a paid plan brings, with `PremiumLockMark` on it; choosing
 * it opens `PremiumLockDialog` instead of applying it. Wrap the locked control
 * in `TooltipHint` with `PREMIUM_LOCK_MESSAGE` for the hover hint, and add
 * ", locked" to its accessible name. A workspace that has them shows nothing
 * extra: no "Premium" pill on every luxury card.
 *
 * The API is the authority. It refuses a premium look it does not allow with
 * a 402 carrying `PREMIUM_LOOK_REQUIRED_CODE`, the same shape as a premium
 * appearance theme, so a page that still thought it was unlocked (a plan that
 * lapsed in another tab) opens the same dialog instead of showing an error.
 */
import {
  Button,
  buttonVariants,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@postgear/ui';
import { Lock } from 'lucide-react';
import Link from 'next/link';
import { useWorkspace } from '@/components/navigation/workspace-provider';
import { ApiError } from '@/lib/api';

/** The code on the API's refusal (`studio.messages.ts` has the same string). */
export const PREMIUM_LOOK_REQUIRED_CODE = 'premium_look_requires_plan';

/** The lock's hint and the dialog's first sentence. */
export const PREMIUM_LOCK_MESSAGE = 'Premium templates come with a paid plan.';

/** True for the API's "needs a paid plan" refusal, false for any other failure. */
export function isPremiumRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.code === PREMIUM_LOOK_REQUIRED_CODE;
}

/**
 * The lock on a locked card or tile. Hidden from screen readers: the control
 * it sits on says "locked" in its own name.
 */
export function PremiumLockMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-premium-lock=""
      className={cn(
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border-2 border-outline bg-secondary text-ink',
        className,
      )}
    >
      <Lock className="h-3.5 w-3.5" strokeWidth={2.5} />
    </span>
  );
}

/**
 * What choosing a locked look opens: why it is locked, and the way to the
 * plans. `newTab` opens the plans in a new tab, for a page with work on it
 * (the editor) that should still be there after the upgrade.
 */
export function PremiumLockDialog({
  open,
  onOpenChange,
  newTab = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newTab?: boolean;
}) {
  const { activeOrgId } = useWorkspace();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="premium-look-dialog">
        <DialogHeader>
          <DialogTitle>Premium Templates</DialogTitle>
          <DialogDescription>
            {PREMIUM_LOCK_MESSAGE} Upgrade this workspace to use the Luxury collection and the
            hand-made backgrounds in every design.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Link
            href={`/${activeOrgId}/settings/billing`}
            target={newTab ? '_blank' : undefined}
            rel={newTab ? 'noopener' : undefined}
            onClick={() => onOpenChange(false)}
            className={buttonVariants({ variant: 'primary' })}
          >
            See Plans
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
