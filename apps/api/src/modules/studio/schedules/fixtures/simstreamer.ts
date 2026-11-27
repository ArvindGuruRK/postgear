import type { ScheduleFixture } from './fixture.types';

/**
 * A normal week: one cancelled stream (Tuesday) and a day with two
 * (Friday). Read in Asia/Kolkata on a 12 hour clock it is exactly the
 * design engine's `SAMPLE_WEEK`, which is what Try A Sample fills in
 * (`schedule-fixtures.spec.ts` holds the two together).
 */
export const SIMSTREAMER: ScheduleFixture = {
  kind: 'found',
  login: 'simstreamer',
  displayName: 'SimStreamer',
  homeZone: 'Asia/Kolkata',
  segments: [
    {
      day: 0,
      at: '19:00',
      minutes: 180,
      title: 'Minecraft Hardcore',
      category: 'Minecraft',
      recurring: true,
    },
    {
      day: 1,
      at: '19:00',
      minutes: 120,
      title: 'Collab Night',
      category: 'Just Chatting',
      cancelled: true,
      recurring: true,
    },
    {
      day: 2,
      at: '19:00',
      minutes: 120,
      title: 'Just Chatting',
      category: 'Just Chatting',
      recurring: true,
    },
    {
      day: 3,
      at: '20:00',
      minutes: 150,
      title: 'Viewer Games',
      category: 'Fall Guys',
      recurring: true,
    },
    {
      day: 4,
      at: '19:00',
      minutes: 150,
      title: 'Minecraft',
      category: 'Minecraft',
      recurring: true,
    },
    {
      day: 4,
      at: '22:00',
      minutes: 90,
      title: 'Chat',
      category: 'Just Chatting',
      recurring: false,
    },
    {
      day: 5,
      at: '15:00',
      minutes: 240,
      title: 'Variety Saturday',
      category: 'Variety',
      recurring: true,
    },
  ],
};
