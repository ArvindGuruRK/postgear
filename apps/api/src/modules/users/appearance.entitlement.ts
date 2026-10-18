/**
 * Whether a user may use the premium themes, light and dark.
 *
 * ## Per user, unlocked by any workspace
 *
 * A theme is the user's, not a workspace's (it follows them into every
 * workspace and onto every device), but plans are bought per workspace. So
 * the rule is the generous one: premium themes unlock while **any** workspace
 * the user is an enabled member of is entitled to a paid tier. A member of a
 * client's paid workspace gets them too; that is the point of a shared plan.
 *
 * ## The plan table decides "paid"
 *
 * "Paid" is exactly what `resolveEntitlement` in `billing/plans.ts` says it
 * is (the same rule the AI credit allowance (`tierOf`) and the channel limit
 * read), so a theme never disagrees with the billing page about whether a
 * plan is live: an unexpired trial counts, a cancellation counts until
 * `cancelAt`, past-due keeps its grace period, an expired trial or a
 * cancelled plan does not. Nothing here re-derives those rules.
 */
import { prisma } from '@postgear/db';
import { resolveEntitlement, type SubscriptionLike } from '../billing/plans';

/** The subscription columns `resolveEntitlement` reads. */
export const ENTITLEMENT_SUBSCRIPTION_SELECT = {
  subscriptionTier: true,
  status: true,
  period: true,
  trialEndsAt: true,
  currentPeriodEnd: true,
  cancelAt: true,
  deletedAt: true,
  isLifetime: true,
  scheduledTier: true,
  scheduledPeriod: true,
} as const;

/** The pure rule: is any of these subscriptions entitled to a paid tier at `now`? */
export function premiumUnlockedFrom(
  subscriptions: ReadonlyArray<SubscriptionLike | null>,
  now: Date = new Date(),
): boolean {
  return subscriptions.some(
    (subscription) => resolveEntitlement(subscription, now).tier !== 'FREE',
  );
}

/**
 * Reads the user's enabled memberships and applies the rule. One query: the
 * memberships with each workspace's subscription row joined in.
 */
export async function hasPremiumThemes(userId: string, now: Date = new Date()): Promise<boolean> {
  const memberships = await prisma.userOrganization.findMany({
    where: { userId, disabled: false },
    select: {
      organization: { select: { subscription: { select: ENTITLEMENT_SUBSCRIPTION_SELECT } } },
    },
  });

  return premiumUnlockedFrom(
    memberships.map((membership) => membership.organization.subscription),
    now,
  );
}
