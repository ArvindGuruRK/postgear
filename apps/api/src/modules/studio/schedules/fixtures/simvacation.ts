import type { ScheduleFixture } from './fixture.types';

/**
 * A broadcaster on a break from Monday until Thursday: Twitch sends the
 * break and the streams after it, and the zone line reads "On a break until
 * Thu ...". One stream has no title, so its row uses the category.
 */
export const SIMVACATION: ScheduleFixture = {
  kind: 'found',
  login: 'simvacation',
  displayName: 'SimVacation',
  homeZone: 'Asia/Kolkata',
  vacation: { fromDay: 0, untilDay: 3 },
  segments: [
    {
      day: 3,
      at: '19:30',
      minutes: 120,
      title: 'Back From The Break',
      category: 'Just Chatting',
      recurring: false,
    },
    { day: 4, at: '20:00', minutes: 180, title: '', category: 'Minecraft', recurring: true },
    { day: 5, at: '16:00', minutes: 180, title: 'Speedruns', category: 'Celeste', recurring: true },
  ],
};
