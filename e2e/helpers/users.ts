import { Provider, prisma } from '@postgear/db';
import * as argon2 from 'argon2';

/**
 * Test fixtures that create real users directly in the database.
 *
 * ## Why not register through the API
 *
 * Registration deliberately leaves an account **unactivated**, and the only
 * way to activate it is a token that exists solely inside an email. In local
 * development that email is printed to the API process's stdout, which a
 * browser test cannot read. There is no "give me the token" endpoint, and
 * adding one — even guarded by NODE_ENV — would be a bypass of the
 * confirmation flow living permanently in the codebase for the convenience of
 * a test.
 *
 * So the fixture writes the row it needs. That is honest about what these
 * tests cover: the **onboarding wizard and the route gates**, starting from a
 * user who is already activated. Activation itself is covered by the API-level
 * checks in the completion checklist, which can read the console output.
 *
 * The password is hashed with the same argon2id parameters as
 * `PasswordService`, so sign-in exercises the real verification path rather
 * than a special case.
 */

export const FIXTURE_PASSWORD = 'correct-horse-9-battery';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export interface FixtureUser {
  id: string;
  email: string;
  password: string;
}

/**
 * An activated user who has **not** onboarded: no organization, step 1.
 *
 * This is the state route gate 2 exists for, and the state the wizard starts
 * from.
 */
export async function createUnonboardedUser(label: string): Promise<FixtureUser> {
  const email = `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

  const user = await prisma.user.create({
    data: {
      email,
      providerName: Provider.LOCAL,
      name: 'E2E Tester',
      timezone: 0,
      password: await argon2.hash(FIXTURE_PASSWORD, ARGON2_OPTIONS),
      passwordChangedAt: new Date(),
      activated: true,
      onboardingStep: 1,
      onboardingCompletedAt: null,
    },
    select: { id: true, email: true },
  });

  return { ...user, password: FIXTURE_PASSWORD };
}

/**
 * Removes a fixture user and everything hanging off it.
 *
 * Order matters — `UserOrganization` and `OnboardingResponse` both hold a
 * foreign key to `User`, and Prisma's default referential action is `Restrict`,
 * so deleting the user first fails. Organizations created during a test are
 * removed too; leaving them behind would slowly fill the switcher in every
 * later manual run.
 */
export async function deleteUser(userId: string): Promise<void> {
  const memberships = await prisma.userOrganization.findMany({
    where: { userId },
    select: { organizationId: true },
  });

  await prisma.onboardingResponse.deleteMany({ where: { userId } });
  await prisma.userOrganization.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });

  for (const { organizationId } of memberships) {
    // Only if the test was its sole member — never touch a seeded workspace
    // that other tests depend on.
    const remaining = await prisma.userOrganization.count({ where: { organizationId } });
    if (remaining === 0) {
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
  }
}

/** Closes the pool so Playwright's worker process can exit. */
export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
