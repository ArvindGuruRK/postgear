/**
 * `GET /channels/next-slot` (Sprint 13 Module 13): the first channel's next
 * free slot on a weekday it runs, at a natural minute inside its window;
 * each channel's own slot; a slot already holding a post is skipped; another
 * workspace's channel is not there; a bad zone is refused.
 */
import { UnprocessableEntityException } from '@nestjs/common';
import { zonedTime, zonedToEpoch } from '@postgear/automation';
import { ChannelNextSlotService } from './channel-next-slot.service';
import type { ChannelSummary, ChannelsRepository } from './channels.repository';
import { nextSlotQuerySchema } from './dto/channels.schema';

const ZONE = 'Europe/London';
const ALL = [1, 2, 3, 4, 5, 6, 7];
/** Monday 16 November 2026, 06:00 in London. */
const MONDAY_6AM = zonedToEpoch(
  { year: 2026, month: 11, day: 16, hour: 6, minute: 0, second: 0 },
  ZONE,
);
const at = (day: number, hour: number, minute: number) =>
  zonedToEpoch({ year: 2026, month: 11, day, hour, minute, second: 0 }, ZONE);

function summary(id: string, postingTimes: ChannelSummary['postingTimes']): ChannelSummary {
  return { id, name: id, postingTimes } as unknown as ChannelSummary;
}

function setup(channels: ChannelSummary[], taken: number[] = []) {
  const listForOrg = jest.fn(async (orgId: string) => (orgId === 'org-1' ? channels : []));
  const queuedTimes = jest.fn(async () => taken);
  const service = new ChannelNextSlotService({
    listForOrg,
    queuedTimes,
  } as unknown as ChannelsRepository);
  const ask = (query: Record<string, string>, orgId = 'org-1') =>
    service.nextSlot(orgId, nextSlotQuerySchema.parse({ timeZone: ZONE, ...query }), MONDAY_6AM);
  return { ask, queuedTimes };
}

describe('ChannelNextSlotService', () => {
  const tuesThurs = summary('yt', [{ time: 540, windowMinutes: 15, days: [2, 4] }]);
  const daily = summary('li', [{ time: 600, windowMinutes: 0, days: ALL }]);

  it('answers the first channel’s slot on a weekday it runs, inside its window, off the five-minute marks', async () => {
    const { ask, queuedTimes } = setup([tuesThurs, daily]);
    const answer = await ask({ channelIds: 'yt,li', seed: 'post-a' });

    expect(answer.channelId).toBe('yt');
    expect(answer.windowMinutes).toBe(15);
    const time = Date.parse(answer.at as string);
    expect(zonedTime(time, ZONE).weekday).toBe(2);
    expect(Math.abs(time - at(17, 9, 0))).toBeLessThanOrEqual(15 * 60_000);
    expect(new Date(time).getUTCMinutes() % 5).not.toBe(0);
    // Each channel's own slot: LinkedIn's exact 10:00 on Monday.
    expect(answer.channels.find((entry) => entry.channelId === 'li')?.at).toBe(
      new Date(at(16, 10, 0)).toISOString(),
    );
    // Queued posts on every chosen channel are counted.
    expect(queuedTimes).toHaveBeenCalledWith('org-1', ['yt', 'li'], expect.any(Date));
  });

  it('is stable for a seed, and never hands out a slot that already holds a post', async () => {
    const first = await setup([tuesThurs]).ask({ channelIds: 'yt', seed: 'post-a' });
    const again = await setup([tuesThurs]).ask({ channelIds: 'yt', seed: 'post-a' });
    expect(again.at).toBe(first.at);

    const taken = Date.parse(first.at as string);
    const next = await setup([tuesThurs], [taken]).ask({ channelIds: 'yt', seed: 'post-b' });
    expect(zonedTime(Date.parse(next.at as string), ZONE).weekday).toBe(4);
  });

  it('answers null when a channel has no posting times', async () => {
    const answer = await setup([summary('x', [])]).ask({ channelIds: 'x' });
    expect(answer.at).toBeNull();
  });

  it('refuses another workspace’s channel and a zone no browser sends', async () => {
    await expect(setup([tuesThurs]).ask({ channelIds: 'yt' }, 'org-2')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(
      setup([tuesThurs]).ask({ channelIds: 'yt', timeZone: 'Mars/Olympus' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('takes only a short, plain list of ids', () => {
    expect(nextSlotQuerySchema.safeParse({ channelIds: 'a,b', timeZone: ZONE }).success).toBe(true);
    expect(nextSlotQuerySchema.safeParse({ channelIds: 'a;drop', timeZone: ZONE }).success).toBe(
      false,
    );
    expect(
      nextSlotQuerySchema.safeParse({ channelIds: 'a', timeZone: ZONE, extra: '1' }).success,
    ).toBe(false);
  });
});
