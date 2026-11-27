/**
 * The Emote Maker's routes (Sprint 13, Module 14): who may call them, which
 * guards run, and the status each answer carries.
 */
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Role } from '@postgear/db';
import type { Response } from 'express';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { ClipsCreateGuard } from '../limits/clips-create.guard';
import { ClipsEnabledGuard } from '../limits/clips-enabled.guard';
import { TEST_ORG, TEST_USER } from '../testing/rows';
import { ClipEmotesController } from './clip-emotes.controller';
import type { ClipEmotesService } from './clip-emotes.service';

function response() {
  const res = { status: jest.fn(), setHeader: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

const org = { id: TEST_ORG } as never;
const user = { id: TEST_USER } as never;

describe('ClipEmotesController', () => {
  it('lives at /clips/emotes, for admins, members and editor seats, behind the Clips switch', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ClipEmotesController)).toBe('clips/emotes');
    expect(Reflect.getMetadata(ROLES_KEY, ClipEmotesController)).toEqual([
      Role.ADMIN,
      Role.USER,
      Role.EDITOR,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, ClipEmotesController)).toContain(ClipsEnabledGuard);
    // An export is a start: the per-person throttle and the busy check apply.
    const exportGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      ClipEmotesController.prototype.export,
    );
    expect(exportGuards).toContain(ClipsCreateGuard);
  });

  it('answers 200 for a finished export and 202 for one still being made, never cached', async () => {
    const emotes = {
      export: jest
        .fn()
        .mockResolvedValueOnce({ job: {}, emote: {}, finished: true })
        .mockResolvedValueOnce({ job: {}, emote: null, finished: false }),
      get: jest.fn().mockResolvedValue({ job: {}, emote: null }),
    };
    const controller = new ClipEmotesController(emotes as unknown as ClipEmotesService);
    const done = response();
    await controller.export(org, user, {} as never, done as unknown as Response);
    expect(done.status).toHaveBeenCalledWith(200);
    expect(done.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    const running = response();
    await controller.export(org, user, {} as never, running as unknown as Response);
    expect(running.status).toHaveBeenCalledWith(202);
    expect(emotes.export).toHaveBeenCalledWith(TEST_ORG, TEST_USER, {});

    const read = response();
    await controller.get(org, 'job-1', read as unknown as Response);
    expect(emotes.get).toHaveBeenCalledWith(TEST_ORG, 'job-1');
    expect(read.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});
