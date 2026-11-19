/**
 * The rights request removal (Module 19 section 5): the shared removal path
 * with `rights_request`, a blocked row for a link video (none for an upload),
 * the workspace told with the plain sentence, the operator's record, and the
 * script's by-link form that finds every workspace's copy.
 */
import { NotFoundException } from '@nestjs/common';
import type { ClipRetentionService } from '../../clips/retention/clip-retention.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { OperatorAuditService } from '../operator-audit.service';
import { OperatorClipsService } from './operator-clips.service';

const VIDEO = '11111111-1111-4111-8111-111111111111';
const COPY = '22222222-2222-4222-8222-222222222222';
const actor = { id: 'op-1', email: 'demo@postgear.local' };

const db = {
  findFirst: jest.fn(async (..._args: unknown[]): Promise<unknown> => null),
  findMany: jest.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
  upsert: jest.fn(async (..._args: unknown[]) => ({})),
};
jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: {
    clipVideo: {
      findFirst: (...args: unknown[]) => db.findFirst(...args),
      findMany: (...args: unknown[]) => db.findMany(...args),
    },
    clipBlockedVideo: { upsert: (...args: unknown[]) => db.upsert(...args) },
  },
}));

function removed(
  orgId: string,
  id: string,
  platform = 'TWITCH',
  externalId: string | null = '900000001',
) {
  return {
    id,
    organizationId: orgId,
    title: 'A Long Stream',
    platform,
    externalId,
    createdById: null,
  };
}

function build() {
  const retention = {
    removeVideo: jest.fn(async (orgId: string, id: string) => removed(orgId, id)),
  };
  const notifications = { notify: jest.fn(async () => undefined) };
  const audit = { record: jest.fn(async () => undefined) };
  const service = new OperatorClipsService(
    retention as unknown as ClipRetentionService,
    notifications as unknown as NotificationsService,
    audit as unknown as OperatorAuditService,
  );
  return { service, retention, notifications, audit };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('OperatorClipsService.removeVideo', () => {
  it('removes with rights_request, blocks the link for everyone, tells the workspace and records it', async () => {
    db.findFirst.mockResolvedValue({ id: VIDEO, organizationId: 'org-a' });
    const { service, retention, notifications, audit } = build();

    expect(await service.removeVideo(VIDEO, 'The owner asked by mail.', actor)).toEqual({
      videoId: VIDEO,
      organizationId: 'org-a',
      blocked: true,
    });
    // Found by id alone, in any workspace: the org cookie plays no part.
    expect(db.findFirst).toHaveBeenCalledWith({
      where: { id: VIDEO, deletedAt: null },
      select: { id: true, organizationId: true },
    });
    expect(retention.removeVideo).toHaveBeenCalledWith('org-a', VIDEO, 'rights_request');
    expect(db.upsert).toHaveBeenCalledWith({
      where: { platform_externalId: { platform: 'TWITCH', externalId: '900000001' } },
      create: {
        platform: 'TWITCH',
        externalId: '900000001',
        reason: 'The owner asked by mail.',
        createdBy: 'demo@postgear.local',
      },
      update: {},
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-a',
        type: 'clip_video_removed',
        content: 'A video was removed after a request from its owner.',
        email: false,
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        action: 'clips.video_removed',
        reason: 'The owner asked by mail.',
      }),
    );
  });

  it('blocks nothing for an upload (there is no link to block)', async () => {
    db.findFirst.mockResolvedValue({ id: VIDEO, organizationId: 'org-a' });
    const { service, retention } = build();
    retention.removeVideo.mockResolvedValueOnce(removed('org-a', VIDEO, 'UPLOAD', null));

    expect((await service.removeVideo(VIDEO, 'The owner asked by mail.', actor)).blocked).toBe(
      false,
    );
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown id, a malformed one, or a video removed in between', async () => {
    const { service, retention } = build();
    db.findFirst.mockResolvedValue(null);
    await expect(service.removeVideo(VIDEO, 'reason here!', actor)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.removeVideo('not-a-uuid', 'reason here!', actor)).rejects.toThrow(
      NotFoundException,
    );
    db.findFirst.mockResolvedValue({ id: VIDEO, organizationId: 'org-a' });
    retention.removeVideo.mockResolvedValueOnce(null as never);
    await expect(service.removeVideo(VIDEO, 'reason here!', actor)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('OperatorClipsService.removeByLink (the clips:remove script)', () => {
  it("removes every workspace's copy, then keeps the link blocked", async () => {
    db.findMany.mockResolvedValue([
      { id: VIDEO, organizationId: 'org-a' },
      { id: COPY, organizationId: 'org-b' },
    ]);
    const { service, retention } = build();

    const result = await service.removeByLink(
      'https://www.twitch.tv/videos/900000001',
      'The owner asked by mail.',
      actor,
    );
    expect(result.map((one) => one.organizationId)).toEqual(['org-a', 'org-b']);
    expect(db.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { platform: 'TWITCH', externalId: '900000001', deletedAt: null },
      }),
    );
    expect(retention.removeVideo).toHaveBeenCalledTimes(2);
  });

  it('blocks the link even when no workspace has it yet', async () => {
    db.findMany.mockResolvedValue([]);
    const { service } = build();
    expect(
      await service.removeByLink(
        'https://www.twitch.tv/videos/900000001',
        'The owner asked by mail.',
        actor,
      ),
    ).toEqual([]);
    expect(db.upsert).toHaveBeenCalledTimes(1);
  });

  it('refuses a link it cannot read', async () => {
    const { service } = build();
    await expect(
      service.removeByLink('https://example.com/x', 'The owner asked by mail.', actor),
    ).rejects.toThrow('No workspace has a video from this link.');
  });
});
