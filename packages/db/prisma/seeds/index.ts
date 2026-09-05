/**
 * Local dev database seeder. Run via `npm run db:seed` (root) or
 * `npm run seed --workspace=packages/db`. Also auto-invoked by
 * `npm run db:reset` (which runs `prisma migrate reset`, and Prisma calls
 * this automatically afterward because of the `"prisma": { "seed": ... }`
 * field in this package's package.json).
 *
 * Idempotent by design (fixed ids + upsert) — safe to re-run.
 */
import { Period, PrismaClient, Provider, Role, SubscriptionTier } from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_ORG_ID = 'seed-demo-org';
const DEMO_USER_ID = 'seed-demo-user';

/**
 * A second user that deliberately belongs to **no** organization.
 *
 * Sprint 1 Task 3a locked in that signup collects credentials only, and the
 * workspace is created afterward in a real onboarding flow. That makes
 * "authenticated but not onboarded" a genuine, persistable state — and the
 * classic way this pattern breaks is a query that assumes every user has at
 * least one `UserOrganization`, crashing on the first post-login page load.
 *
 * Seeding this row means the un-onboarded path is reproducible from a plain
 * `npm run db:seed` instead of something each developer has to hand-craft.
 */
const ONBOARDING_USER_ID = 'seed-onboarding-user';

async function main() {
  const organization = await prisma.organization.upsert({
    where: { id: DEMO_ORG_ID },
    update: {},
    create: {
      id: DEMO_ORG_ID,
      name: 'PostGear Demo Org',
    },
  });

  const user = await prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    update: {},
    create: {
      id: DEMO_USER_ID,
      email: 'demo@postgear.local',
      providerName: Provider.LOCAL,
      name: 'Demo Admin',
      isSuperAdmin: true,
      // Convention confirmed (Sprint 1): `timezone` is the user's **UTC
      // offset in minutes**, not an IANA-zone index. Postiz's client sends
      // `String(dayjs.tz().utcOffset())`, and dayjs's `utcOffset()` returns
      // minutes — so 0 = UTC, -300 = US Eastern (EST), 330 = IST.
      //
      // Worth knowing before Sprint 2's profile UI writes this: an offset is
      // strictly less information than a zone name. It cannot survive a DST
      // transition on its own, so a user scheduled at "9am local" via a stored
      // offset drifts by an hour twice a year. Sprint 5's scheduler is where
      // that actually bites; if it needs DST correctness, add a nullable
      // `timezoneName` (IANA string) alongside this field rather than
      // reinterpreting it.
      timezone: 0,
      // `password` deliberately left unset — there's no working login flow
      // yet (Sprint 2). Set it via bcrypt once that lands, don't store a
      // plaintext placeholder here in the meantime.
    },
  });

  await prisma.userOrganization.upsert({
    where: {
      userId_organizationId: {
        userId: user.id,
        organizationId: organization.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      organizationId: organization.id,
      role: Role.ADMIN,
    },
  });

  await prisma.subscription.upsert({
    where: { organizationId: organization.id },
    update: {},
    create: {
      organizationId: organization.id,
      subscriptionTier: SubscriptionTier.STANDARD,
      period: Period.MONTHLY,
      totalChannels: 5,
    },
  });

  // No `userOrganization` row is created for this user, on purpose — see the
  // comment on ONBOARDING_USER_ID. The schema already permits it:
  // `User.organizations` is a to-many relation with no minimum cardinality,
  // so zero rows needs no migration, only queries that don't assume otherwise.
  const onboardingUser = await prisma.user.upsert({
    where: { id: ONBOARDING_USER_ID },
    update: {},
    create: {
      id: ONBOARDING_USER_ID,
      email: 'onboarding@postgear.local',
      providerName: Provider.LOCAL,
      name: 'Needs Onboarding',
      timezone: 0,
    },
  });

  console.log('Seed complete:', {
    organizationId: organization.id,
    userId: user.id,
    email: user.email,
    unOnboardedUserId: onboardingUser.id,
    unOnboardedEmail: onboardingUser.email,
  });
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
