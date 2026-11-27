/**
 * The last Editor seat, raced (Sprint 13, Module 14), on the real Postgres.
 *
 * A mock cannot show what two transactions do at once, so this one runs the
 * real advisory lock and the real count. Five people accept an Editor link at
 * the same moment into a workspace with one seat: exactly one becomes an
 * Editor and the other four get the seat sentence. The plan's value is the
 * only stand-in (one seat), so no plan rows are touched.
 *
 * It needs the local database (docker compose up) with every migration
 * applied, so it runs only when EDITOR_SEATS_DB_TEST=1:
 *   EDITOR_SEATS_DB_TEST=1 npx dotenv -e .env -- npx jest --config apps/api/jest.config.js editor-seats.race
 * CI has no Postgres service, so there it shows as skipped. The test makes a
 * throwaway workspace and five throwaway users and deletes them at the end.
 */
import { prisma, Role } from '@postgear/db';
import { EntitlementRefusedException } from '../entitlements/entitlement-refused.exception';
import type { EntitlementResolver } from '../entitlements/entitlement-resolver';
import { EditorSeatsService } from './editor-seats.service';

const RUN = process.env.EDITOR_SEATS_DB_TEST === '1';
const AT_ONCE = 5;

/** One seat, refusing the way the real resolver does. */
function oneSeatResolver(): EntitlementResolver {
  return {
    get: async () => 1,
    assert: async (_org: string, _key: string, fits: (limit: number) => boolean) => {
      if (fits(1)) return 1;
      throw new EntitlementRefusedException(
        'members_editor_seats_full',
        'No editor seats left. Remove an editor or change your plan.',
      );
    },
  } as unknown as EntitlementResolver;
}

(RUN ? describe : describe.skip)('the last editor seat, raced (real Postgres)', () => {
  const stamp = Date.now().toString(36);
  const orgId = `seat-race-${stamp}`;
  const userIds = Array.from({ length: AT_ONCE }, (_, i) => `seat-race-${stamp}-${i}`);
  const seats = new EditorSeatsService(oneSeatResolver());

  beforeAll(async () => {
    await prisma.organization.create({ data: { id: orgId, name: 'Seat Race Test' } });
    for (const id of userIds) {
      await prisma.user.create({
        data: { id, email: `${id}@example.test`, providerName: 'LOCAL', timezone: 0 },
      });
    }
  });

  afterAll(async () => {
    await prisma.userOrganization.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('admits exactly one of five simultaneous accepts', async () => {
    const results = await Promise.allSettled(
      userIds.map((userId) =>
        prisma.$transaction(async (tx) => {
          await seats.assertRoom(orgId, tx);
          await tx.userOrganization.create({
            data: { userId, organizationId: orgId, role: Role.EDITOR },
          });
        }),
      ),
    );

    const admitted = results.filter((result) => result.status === 'fulfilled');
    const refused = results.filter(
      (result) =>
        result.status === 'rejected' && result.reason instanceof EntitlementRefusedException,
    );
    expect(admitted).toHaveLength(1);
    expect(refused).toHaveLength(AT_ONCE - 1);
    await expect(seats.state(orgId)).resolves.toEqual({ used: 1, limit: 1, remaining: 0 });
  });

  it('frees the seat when the Editor is disabled, and counts no admins or members', async () => {
    await prisma.userOrganization.updateMany({
      where: { organizationId: orgId },
      data: { disabled: true },
    });
    await prisma.userOrganization.createMany({
      data: [
        { userId: userIds[3], organizationId: orgId, role: Role.ADMIN },
        { userId: userIds[4], organizationId: orgId, role: Role.USER },
      ],
      skipDuplicates: true,
    });
    await expect(seats.state(orgId)).resolves.toEqual({ used: 0, limit: 1, remaining: 1 });
    await expect(seats.assertRoom(orgId)).resolves.toBeUndefined();
  });
});
