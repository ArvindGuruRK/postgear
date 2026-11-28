/**
 * Module 17 item 26: the workspace's speech privacy switch. It is read and
 * written on the active workspace only, a change is logged with ids and the
 * new value (never anything said), and the view carries the hosted lane so
 * the settings card can say what the switch changes on this PostGear.
 */
import { Logger } from '@nestjs/common';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { ClipPrivacyController } from './clip-privacy.controller';
import { clipPrivacySchema } from './clip-privacy.schema';
import { ClipPrivacyService } from './clip-privacy.service';

const mockRows = new Map<string, boolean>();

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: {
    organization: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        mockRows.has(where.id) ? { clipsSpeechStaysHere: mockRows.get(where.id) } : null,
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { clipsSpeechStaysHere: boolean };
        }) => {
          mockRows.set(where.id, data.clipsSpeechStaysHere);
          return { id: where.id };
        },
      ),
    },
  },
}));

const LANE = { on: true, provider: 'groq', providerName: 'Groq', aboveMinutes: 55 };

function setup() {
  const probe = { hostedLane: jest.fn(async () => LANE) };
  const service = new ClipPrivacyService(probe as never);
  return { service, probe };
}

beforeEach(() => {
  mockRows.clear();
  mockRows.set('org-a', false);
  mockRows.set('org-b', false);
});

describe('ClipPrivacyService', () => {
  it('reads off by default, with the hosted lane beside it', async () => {
    const { service } = setup();
    await expect(service.view('org-a')).resolves.toEqual({
      speechStaysHere: false,
      hostedLane: LANE,
    });
  });

  it('reads a missing workspace as off', async () => {
    const { service } = setup();
    await expect(service.speechStaysHere('org-gone')).resolves.toBe(false);
  });

  it('turns the switch on for the active workspace only', async () => {
    const { service } = setup();
    const view = await service.set('org-a', true, 'user-1');
    expect(view.speechStaysHere).toBe(true);
    expect(mockRows.get('org-a')).toBe(true);
    expect(mockRows.get('org-b')).toBe(false);
    await service.set('org-a', false, 'user-1');
    expect(mockRows.get('org-a')).toBe(false);
  });

  it('logs a change with ids and the value only', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { service } = setup();
    await service.set('org-a', true, 'user-1');
    const line = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
    expect(line).toEqual({
      event: 'clips.privacy.speech_stays_here',
      orgId: 'org-a',
      by: 'user-1',
      on: true,
    });
    log.mockRestore();
  });
});

describe('PUT /clips/privacy', () => {
  it('takes a boolean and nothing else', () => {
    expect(clipPrivacySchema.safeParse({ speechStaysHere: true }).success).toBe(true);
    expect(clipPrivacySchema.safeParse({ speechStaysHere: 'yes' }).success).toBe(false);
    expect(clipPrivacySchema.safeParse({}).success).toBe(false);
    expect(clipPrivacySchema.safeParse({ speechStaysHere: true, orgId: 'org-b' }).success).toBe(
      false,
    );
  });

  it('is an admin-only change on a route every member can read', () => {
    const roles = (target: object) =>
      Reflect.getMetadata(ROLES_KEY, target) as string[] | undefined;
    expect(roles(ClipPrivacyController)).toEqual(['ADMIN', 'USER', 'EDITOR']);
    expect(roles(ClipPrivacyController.prototype.set)).toEqual(['ADMIN']);
    expect(roles(ClipPrivacyController.prototype.view)).toBeUndefined();
  });

  it('writes the workspace from the session, never from the body', async () => {
    const { service } = setup();
    const controller = new ClipPrivacyController(service);
    const answer = await controller.set({ id: 'org-b' } as never, { id: 'user-2' } as never, {
      speechStaysHere: true,
    });
    expect(answer.privacy.speechStaysHere).toBe(true);
    expect(mockRows.get('org-b')).toBe(true);
    expect(mockRows.get('org-a')).toBe(false);
  });
});
