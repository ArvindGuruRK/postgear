/**
 * Local dev database seeder. Run via `npm run db:seed` (root) or
 * `npm run seed --workspace=packages/db`. Also auto-invoked by
 * `npm run db:reset` (which runs `prisma migrate reset`, and Prisma calls
 * this automatically afterward because of the `"prisma": { "seed": ... }`
 * field in this package's package.json).
 *
 * Idempotent by design (fixed ids + upsert) — safe to re-run.
 *
 * Sprint 2 gave every seeded user a real argon2id password and added the two
 * accounts the sprint's Definition of Done needs a subject for: a `USER`-role
 * member (to be refused by an ADMIN-only route) and a second organization (to
 * switch into).
 */
import {
  OnboardingGoal,
  OnboardingRole,
  OnboardingTeamSize,
  Period,
  PostingFrequency,
  PrismaClient,
  Provider,
  ReferralSource,
  Role,
  SubscriptionTier,
} from '@prisma/client';
import * as argon2 from 'argon2';
// The same helper the channels repository uses. Seeding through it rather than
// writing placeholder strings is what makes the "inspect a raw row" check
// meaningful.
//
// This import is why `prisma/seeds/tsconfig.json` exists — see the comment
// there. Under the root ESNext config, ts-node cannot resolve it at all.
import { encrypt } from '../../src/crypto';

const prisma = new PrismaClient();

const DEMO_ORG_ID = 'seed-demo-org';
const SECOND_ORG_ID = 'seed-second-org';
const DEMO_USER_ID = 'seed-demo-user';
const MEMBER_USER_ID = 'seed-member-user';

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

/**
 * Two connected channels (Sprint 3).
 *
 * Without these, every channels view can only ever render its empty state, and
 * the encryption boundary can only be verified by connecting a real social
 * account — which needs developer app registrations nobody has on a fresh
 * clone. Seeding them makes the channel list, both health treatments, the
 * disconnect flow and the "inspect a raw row" check all exercisable with zero
 * platform credentials.
 *
 * The second row carries `refreshNeeded: true` on purpose: a healthy channel
 * and a broken one look completely different in the UI, and shipping only the
 * happy path is how the broken-state rendering goes untested.
 */
const DEMO_CHANNEL_ID = 'seed-channel-linkedin';
const BROKEN_CHANNEL_ID = 'seed-channel-x';

/**
 * A third, healthy channel on a platform with very different rules (Sprint 4).
 *
 * The composer's whole job is showing one post against several platforms'
 * rules at once. X counts weighted characters and threads natively; LinkedIn
 * turns later parts into comments; Instagram refuses a post with no image and
 * accepts JPEG only. With all three seeded, every one of those behaviours is
 * visible in a fresh workspace without connecting anything.
 */
const INSTAGRAM_CHANNEL_ID = 'seed-channel-instagram';

/**
 * The password every seeded account shares.
 *
 * A known value in a local seed is fine and useful; the point of hashing it
 * here is that the *stored* form is a real argon2id digest, so the login path
 * is exercised for real rather than against a special case.
 */
const SEED_PASSWORD = 'DemoPassword123!';

/**
 * Matches `PasswordService.ARGON2_OPTIONS` in apps/api. Duplicated rather than
 * imported because packages/db must not depend on an app — and if the two ever
 * drift, nothing breaks: `argon2.needsRehash()` upgrades the seeded hash on the
 * user's next successful login, which is the same mechanism that migrates a
 * legacy hash.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

async function main() {
  const password = await argon2.hash(SEED_PASSWORD, ARGON2_OPTIONS);

  const organization = await prisma.organization.upsert({
    where: { id: DEMO_ORG_ID },
    update: {},
    create: {
      id: DEMO_ORG_ID,
      name: 'PostGear Demo Org',
    },
  });

  // A second workspace so org switching has somewhere to switch to, and so a
  // scoping bug that ignores the active org shows up as data from the wrong
  // workspace rather than as an empty page.
  const secondOrganization = await prisma.organization.upsert({
    where: { id: SECOND_ORG_ID },
    update: {},
    create: {
      id: SECOND_ORG_ID,
      name: 'PostGear Second Org',
    },
  });

  const user = await prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    // `update` sets the password so re-seeding an existing database picks it
    // up — before Sprint 2 these rows had none, and an empty `update` would
    // leave them permanently unable to sign in.
    update: { password, activated: true, onboardingCompletedAt: new Date(), onboardingStep: 5 },
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
      // argon2id, as set by Sprint 2's PasswordService. The plaintext is
      // SEED_PASSWORD above.
      password,
      passwordChangedAt: new Date(),
      activated: true,
      onboardingCompletedAt: new Date(),
      onboardingStep: 5,
    },
  });

  // Answers for the already-onboarded user, so the survey table is never empty
  // and a query against it can be exercised without walking the wizard.
  await prisma.onboardingResponse.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      role: OnboardingRole.AGENCY,
      teamSize: OnboardingTeamSize.SIZE_2_10,
      primaryGoal: OnboardingGoal.SAVE_TIME,
      postingFrequency: PostingFrequency.DAILY,
      referralSource: ReferralSource.SEARCH,
      interestedChannels: ['x', 'linkedin'],
    },
  });

  for (const organizationId of [organization.id, secondOrganization.id]) {
    await prisma.userOrganization.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId } },
      update: {},
      create: { userId: user.id, organizationId, role: Role.ADMIN },
    });
  }

  /**
   * A plain `USER` in the demo org.
   *
   * The sprint's Definition of Done requires proving that a USER-role member is
   * refused (403) by an ADMIN-only route. Without a seeded subject that check
   * needs a hand-built account every time, which is exactly the kind of setup
   * friction that leaves an authorization rule untested.
   *
   * Note `isSuperAdmin: false` is doing real work here — the demo admin above
   * is a superadmin and bypasses RolesGuard entirely, so it can never
   * demonstrate a 403.
   */
  const member = await prisma.user.upsert({
    where: { id: MEMBER_USER_ID },
    update: { password, activated: true, onboardingCompletedAt: new Date(), onboardingStep: 5 },
    create: {
      id: MEMBER_USER_ID,
      email: 'member@postgear.local',
      providerName: Provider.LOCAL,
      name: 'Regular Member',
      isSuperAdmin: false,
      timezone: 0,
      password,
      passwordChangedAt: new Date(),
      activated: true,
      onboardingCompletedAt: new Date(),
      onboardingStep: 5,
    },
  });

  await prisma.userOrganization.upsert({
    where: { userId_organizationId: { userId: member.id, organizationId: organization.id } },
    update: {},
    create: { userId: member.id, organizationId: organization.id, role: Role.USER },
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
  //
  // `onboardingCompletedAt` stays null and `onboardingStep` stays 1, so this
  // account also exercises the second route gate: authenticated, but sent to
  // /onboarding rather than to a workspace.
  const onboardingUser = await prisma.user.upsert({
    where: { id: ONBOARDING_USER_ID },
    update: { password, activated: true },
    create: {
      id: ONBOARDING_USER_ID,
      email: 'onboarding@postgear.local',
      providerName: Provider.LOCAL,
      name: 'Needs Onboarding',
      timezone: 0,
      password,
      passwordChangedAt: new Date(),
      activated: true,
    },
  });

  // The tokens are encrypted through the same helper the repository uses, not
  // written as plaintext placeholders. That matters: the sprint's verification
  // step is to inspect a raw row and confirm it is unreadable, and a seed that
  // wrote plaintext would make that check pass or fail for the wrong reason.
  const seededChannels = await seedChannels(organization.id);
  const seededPosts = await seedPosts(organization.id);

  console.log('Seed complete:', {
    organizationId: organization.id,
    secondOrganizationId: secondOrganization.id,
    adminEmail: user.email,
    memberEmail: member.email,
    unOnboardedEmail: onboardingUser.email,
    password: SEED_PASSWORD,
    channels: seededChannels,
    posts: seededPosts,
  });
}

/**
 * Four posts in four states (Sprint 5), so the calendar and the queue have
 * something to show — and every treatment they have — on a fresh clone:
 *
 * - a thread **queued** for tomorrow morning on LinkedIn and X;
 * - one **published** yesterday on LinkedIn, with a permalink;
 * - one **failed** two days ago on X, for the same reason the X channel is
 *   seeded broken (it needs reconnecting);
 * - a **draft** parked next week.
 *
 * Fixed ids and upsert, so re-seeding resets them rather than piling up. The
 * group ids are UUIDs because the API only answers for groups shaped like the
 * ones it mints. Content is the composer's document JSON written out by hand,
 * since the seed must not depend on an app package.
 */
async function seedPosts(organizationId: string) {
  const at = (daysFromNow: number, hour: number, minute = 0) => {
    const date = new Date();
    date.setDate(date.getDate() + daysFromNow);
    date.setHours(hour, minute, 0, 0);
    return date;
  };

  const doc = (text: string) =>
    JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });

  const rows: Array<{
    id: string;
    group: string;
    integrationId: string;
    parentPostId?: string;
    state: 'DRAFT' | 'QUEUE' | 'PUBLISHED' | 'ERROR';
    publishDate: Date;
    content: string;
    releaseId?: string;
    releaseURL?: string;
    error?: string;
  }> = [
    // Queued thread, tomorrow 10:00: LinkedIn (one part) and X (two parts).
    {
      id: 'seed-post-queued-linkedin',
      group: '11111111-1111-4111-8111-111111111111',
      integrationId: DEMO_CHANNEL_ID,
      state: 'QUEUE',
      publishDate: at(1, 10),
      content: doc('Tomorrow we open the doors on the new PostGear calendar. Drag a post, change its day.'),
    },
    {
      id: 'seed-post-queued-x',
      group: '11111111-1111-4111-8111-111111111111',
      integrationId: BROKEN_CHANNEL_ID,
      state: 'QUEUE',
      publishDate: at(1, 10),
      content: doc('Tomorrow we open the doors on the new PostGear calendar. Drag a post, change its day.'),
    },
    {
      id: 'seed-post-queued-x-2',
      group: '11111111-1111-4111-8111-111111111111',
      integrationId: BROKEN_CHANNEL_ID,
      parentPostId: 'seed-post-queued-x',
      state: 'QUEUE',
      publishDate: at(1, 10),
      content: doc('Second part of the thread: every scheduled post survives a restart.'),
    },
    // Published yesterday on LinkedIn.
    {
      id: 'seed-post-published-linkedin',
      group: '22222222-2222-4222-8222-222222222222',
      integrationId: DEMO_CHANNEL_ID,
      state: 'PUBLISHED',
      publishDate: at(-1, 9, 30),
      content: doc('Yesterday: the first post PostGear published on its own schedule.'),
      releaseId: 'urn:li:share:seed-7001',
      releaseURL: 'https://www.linkedin.com/feed/update/urn:li:share:seed-7001',
    },
    // Failed two days ago on X: the channel needs reconnecting.
    {
      id: 'seed-post-failed-x',
      group: '33333333-3333-4333-8333-333333333333',
      integrationId: BROKEN_CHANNEL_ID,
      state: 'ERROR',
      publishDate: at(-2, 16),
      content: doc('This one never made it: the X connection had expired.'),
      error: JSON.stringify({
        kind: 'failed',
        reason: 'needs_reconnect',
        message: 'Acme on X needs reconnecting before PostGear can publish to it.',
        attempts: 1,
        failedAt: at(-2, 16).toISOString(),
      }),
    },
    // A draft parked next week, on both healthy channels.
    {
      id: 'seed-post-draft-linkedin',
      group: '44444444-4444-4444-8444-444444444444',
      integrationId: DEMO_CHANNEL_ID,
      state: 'DRAFT',
      publishDate: at(7, 11),
      content: doc('Draft: ideas for next week. Not queued yet, so nothing publishes it.'),
    },
    {
      id: 'seed-post-draft-instagram',
      group: '44444444-4444-4444-8444-444444444444',
      integrationId: INSTAGRAM_CHANNEL_ID,
      state: 'DRAFT',
      publishDate: at(7, 11),
      content: doc('Draft: ideas for next week. Not queued yet, so nothing publishes it.'),
    },
  ];

  for (const row of rows) {
    const data = {
      organizationId,
      integrationId: row.integrationId,
      group: row.group,
      state: row.state,
      publishDate: row.publishDate,
      content: row.content,
      image: '[]',
      settings: JSON.stringify({ customized: false }),
      parentPostId: row.parentPostId ?? null,
      releaseId: row.releaseId ?? null,
      releaseURL: row.releaseURL ?? null,
      error: row.error ?? null,
      creationMethod: 'WEB' as const,
      deletedAt: null,
    };

    await prisma.post.upsert({
      where: { id: row.id },
      update: data,
      create: { id: row.id, ...data },
    });
  }

  return rows.map((row) => `${row.state}:${row.id}`);
}

/**
 * Two connected channels on the demo workspace — one healthy, one needing a
 * reconnect. See the comment on DEMO_CHANNEL_ID for why both exist.
 *
 * Idempotent like everything else here: fixed ids and upsert, so re-running
 * refreshes the rows rather than duplicating them.
 */
async function seedChannels(organizationId: string) {
  const channels = [
    {
      id: DEMO_CHANNEL_ID,
      internalId: 'seed-linkedin-account',
      providerIdentifier: 'linkedin',
      // Deliberately not "PostGear Demo": the demo organization is
      // "PostGear Demo Org", and a channel name that is a substring of the
      // workspace name makes every text-based assertion in the E2E suite
      // ambiguous between the channel card and the workspace switcher.
      name: 'Acme Marketing',
      profile: 'acme-marketing',
      refreshNeeded: false,
      // Comfortably in the future, so this row reads as healthy rather than
      // drifting into the "expiring" warning as the fixture ages.
      tokenExpiration: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    },
    {
      id: BROKEN_CHANNEL_ID,
      internalId: 'seed-x-account',
      providerIdentifier: 'x',
      name: 'Acme on X',
      profile: 'acme',
      refreshNeeded: true,
      tokenExpiration: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
    {
      id: INSTAGRAM_CHANNEL_ID,
      internalId: 'seed-instagram-account',
      providerIdentifier: 'instagram',
      name: 'Acme Studio',
      profile: 'acme.studio',
      refreshNeeded: false,
      // Page-scoped Meta tokens are long-lived; a far expiry keeps it healthy.
      tokenExpiration: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    },
  ];

  for (const channel of channels) {
    const shared = {
      organizationId,
      internalId: channel.internalId,
      providerIdentifier: channel.providerIdentifier,
      type: 'social',
      name: channel.name,
      profile: channel.profile,
      token: encrypt(`seed-access-token-${channel.internalId}`),
      refreshToken: encrypt(`seed-refresh-token-${channel.internalId}`),
      tokenExpiration: channel.tokenExpiration,
      refreshNeeded: channel.refreshNeeded,
      inBetweenSteps: false,
      deletedAt: null,
    };

    await prisma.integration.upsert({
      where: { id: channel.id },
      update: shared,
      create: { id: channel.id, rootInternalId: channel.internalId, ...shared },
    });
  }

  return channels.map((channel) => `${channel.providerIdentifier}:${channel.name}`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
