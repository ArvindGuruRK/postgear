/**
 * Local dev database seeder. Run via `npm run db:seed` (root) or
 * `npm run seed --workspace=packages/db`. Also auto-invoked by
 * `npm run db:reset` (which runs `prisma migrate reset`, and Prisma calls
 * this automatically afterward because of the `"prisma": { "seed": ... }`
 * field in this package's package.json).
 *
 * Idempotent by design (fixed ids + upsert) — safe to re-run.
 */
import { PrismaClient, Provider, Role, SubscriptionTier, Period } from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_ORG_ID = 'seed-demo-org';
const DEMO_USER_ID = 'seed-demo-user';

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
      // `timezone` is a required Int on this schema (Postiz stores it this
      // way too) — using 0 for UTC as a placeholder; confirm the intended
      // convention (offset minutes vs. an IANA-name lookup index) once
      // Sprint 2's auth/profile module actually reads or writes it.
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

  console.log('Seed complete:', {
    organizationId: organization.id,
    userId: user.id,
    email: user.email,
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
