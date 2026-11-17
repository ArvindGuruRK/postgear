# Module 13: Publisher Upgrades

> **Sprint 13, Clips AI** | Status: Not started | Size: L (one full session)
> **Depends on**: Sprint 12. No AI module is needed (the AI label reads `usesAiVoice` from Module 09 when it exists).
> **Stories**: CA-9.1 (now posting slots, windows and weekdays), CA-9.2, CA-9.3 (new: random time of day)
> **Next**: [Module 14](module-14-creator-tools-and-editor-seats.md) (Creator Tools And Editor Seats), then [Module 15](module-15-scale-cost-and-deploy.md)

## Goal

After this module posting looks less like a machine. Each channel's posting times become **posting slots** with a window and the weekdays they run on, so a post goes out at a slightly different minute each time; **Shuffle Times** suggests a week of slots from how many posts a week the user wants; the composer gains **Next Available**; the schedule dialog gains **Pick A Random Time** (Morning, Noon, Afternoon, Evening); and a post with video can be marked **Made With AI**, which reaches the platforms that have a field for it. These are changes to PostGear's scheduler and composer, used by every kind of post, not only clips.

## Read First

- `CLAUDE.md` (the composer and scheduling rules; "the API never publishes"), then the README in this folder.
- [`00-ux-blueprint.md`](00-ux-blueprint.md) section 10.
- User stories: Journey C steps 6 and 7; CA-9.x; section 5 (a platform with no AI label).
- Decisions: D13-10 (the AI label is suggested only for a made-up voice or picture).
- Research: [`01-reference-features.md`](../research/01-reference-features.md), "what PostGear's scheduler already has": `Integration.postingTimes` (a per-channel JSON list of minutes since midnight, the same every day, 1 to 48 entries), `nextFreeSlot()` used only by the workflow step Add To Queue, no Next Available in the composer; StreamLadder's posting slots screens (and the schedule dialog's random time of day). [`07-cost-deploy-and-risks.md`](../research/07-cost-deploy-and-risks.md), the AI label fields per platform with their sources, and YouTube's rule on what needs a label.
- Code: `packages/automation/src/queue/next-free-slot.ts`; `packages/db/prisma/schema.prisma` (`Integration.postingTimes`, `Post`); `apps/api/src/modules/channels/` (the posting times routes and preferences) and `apps/api/src/modules/posts/` (`create`, the DTOs); `packages/scheduling/` (the publish workflow's contract: when a post's time is fixed); `packages/social-core/src/providers/*/` (per-channel settings such as YouTube's "made for kids", and each provider's publish call); `apps/web/src/components/composer/` (the footer, the date control and the schedule dialog, per-channel settings), `apps/web/src/components/channels/posting-times-dialog.tsx` and the channel preferences screen; `apps/api/src/modules/channels/dto/channels.schema.ts` (`postingTimes`); `docs/screenshots/streamladder/` 15, 16, 23, 24 (local; 16 is the random time of day, 24 the slots with windows and weekdays).

## Design

### 1. Posting Slots: Times, Windows And Weekdays (CA-9.1)

A channel's posting times become **posting slots**: each slot has a time of day, its own window and the weekdays it runs on (StreamLadder's "Manage posting time slots", screenshot 24: a time, a "plus or minus 15 min" window, and seven weekday chips per row).

- **Where they live (the smaller migration).** `Integration.postingTimes` is already a validated JSON list stored as text (default `[{"time":120}, {"time":400}, {"time":700}]`), read by about thirty files (the channels API, the public API mapper, Add To Queue, the calendar, the worker). A new `ChannelPostingSlot` table would add a relation, a join in every one of them and a data move. So the slots are **the same JSON list with two optional fields added to each entry**, no new table and no new column:

```ts
interface PostingSlot {
  time: number;            // minutes since local midnight, 0 to 1439 (the slot's minute of day; the key keeps its stored name)
  windowMinutes: 0 | 5 | 15 | 30;   // default 0: the post goes out at exactly this time
  days: Weekday[];         // ISO weekdays, 1 Monday to 7 Sunday, at least one, no repeats; default all seven
}
```

  The migration is one SQL file (`prisma-change`): change the column default to the new shape and run one idempotent `UPDATE` that gives every existing entry `windowMinutes: 0` and all seven days, so existing channels behave exactly as before. A tolerant reader, `readPostingSlots(json)` in `packages/automation`, also fills those defaults for any legacy entry it meets (an old client, a row written before the migration), and every writer saves the new shape. The old single `Integration.postingWindowMinutes` idea is dropped: the window belongs to the slot.
- **Validation.** The channels API's `postingTimes` schema stays `.strict()` and grows `windowMinutes` (0, 5, 15 or 30) and `days` (1 to 7 distinct ISO weekdays); still 1 to 48 entries. The public API keeps returning the flat `postingTimes` as before (times only) and adds `postingSlots` with the full shape.
- **The rule for the minute** is a pure function in `packages/automation/src/queue/jitter.ts`: `jitteredTime(slotTime, windowMinutes, seed)` returns a time inside `[slot - window, slot + window]` that is never exactly on a five-minute mark and never the same minute as another post already placed for that channel that day. The seed is the post's id, so the same post always gets the same minute (re-saving does not move it). A window of 0 returns the slot's own time.
- **Where it is applied.** When a post is placed in a slot (by Next Available, by Add To Queue, by Shuffle), the stored `publishDate` is the jittered time. The publish workflow is not changed: it publishes at `publishDate` as it always has. A post the user schedules at an exact time by hand is never jittered. `nextFreeSlot()` in `packages/automation/src/queue/next-free-slot.ts` takes slots (a bare number still means a slot on every day with no window), skips a slot on a weekday it does not list, and keeps its rules (the lead time, the clash minute, the daylight-saving handling).
- The calendar shows the real minute. A small "around 7:50 AM" label appears in the slot picker, not on the post.

### 2. Next Available In The Composer

- `nextFreeSlot()` already finds the next free time of a channel. Expose it: `GET /channels/next-slot?channelIds=...` answers the next free slot of the first channel listed (and each channel's own next slot, for the tooltip), honouring the slots' weekdays and jittered by that slot's window, using the workspace's time zone as the existing function does.
- The composer's footer gains **Next Available** (secondary) beside the date control. Pressing it sets the date to the answer and shows it ("Tue 17 Nov, 7:52 AM"); the user can still change it. With several channels chosen, the first channel's slot is used for all (a post has one time today); the tooltip says so.
- A channel with no posting times: the button is disabled with "Set posting times for this channel first." and a link to the channel's preferences.
- The same slot is not handed out twice: the route takes into account drafts and scheduled posts, as `nextFreeSlot()` does, and the composer asks again on save if the slot was taken meanwhile.

### 3. Shuffle Times, And The Posting Slots Dialog

- Channel preferences, Posting Times opens the **Manage Posting Time Slots** dialog (the existing `posting-times-dialog.tsx`, extended). Each slot is a row: a time field, a window `Select` (**Exact**, **Within 5 Minutes**, **Within 15 Minutes**, **Within 30 Minutes**) and seven weekday chips (Mon to Sun, all on by default, at least one must stay on) and a remove button; **Add Another Time** adds a row. A help line under the rows: "Each post goes out at a natural minute within the window you set, never exactly on the hour and never two at once, so your schedule never looks automated." A **Back To Suggested Times** link returns to Shuffle.
- **Shuffle Times** (secondary) opens a dialog: "How many posts a week?" (a `Slider`, 1 to 35, read as "21 a week"), a preview of the suggested slots, **Use These Times**. The suggestion is a pure function, `suggestSlots(perWeek, seed)` in `packages/automation`: the posts are shared across the week as evenly as possible (`floor(perWeek / 7)` slots on every day, and the remainder as one more slot on that many days, starting with Tuesday, Wednesday and Thursday); times are spread across the waking day (7:00 to 22:00 in the workspace's time zone), each nudged off round numbers (7:50, not 8:00), at least two hours apart on one day; slots with the same time on several days are merged into one slot with those weekdays (21 a week is three slots on all seven days; 10 a week is one slot on all seven and one on Tuesday, Wednesday and Thursday). Generated slots start with a window of 15 minutes. Pressing Shuffle again gives another set.
- The dialogs are desktop and mobile friendly like the rest of the composer; nothing here is a canvas.

### 3a. The Schedule Dialog: Pick A Random Time (CA-9.3)

- The composer's schedule dialog (the date and time picker opened from the footer) gains **Pick A Random Time** beside **Choose A Time**, as in StreamLadder's schedule dialog (screenshot 16): four buttons, **Morning**, **Noon**, **Afternoon**, **Evening**, with a list "Scheduled on this day" showing the times already placed that day for the chosen channel.
- Pressing one picks a random time on the chosen date inside that part of the day, in the workspace's time zone: Morning 6:00 to 11:59, Noon 12:00 to 13:59, Afternoon 14:00 to 17:59, Evening 18:00 to 21:59. It uses `randomTimeOfDay(part, day, seed, taken)` in `packages/automation/src/queue/random-time.ts` (pure): never on a five-minute mark, never within a minute of a post already placed that day, never earlier than the lead time on today's date. Pressing the same button again gives another time (a new seed). The result fills the time field and the line "Your post will be scheduled for 15 November 2026 at 7:58 AM." The user can still edit it, and a time picked this way counts as a hand-picked exact time (it is not jittered again).
- Works for posts of every kind, not only clips.

### 4. Made With AI

- A per-post flag: `Post.madeWithAi Boolean @default(false)` (`prisma-change`), set from the composer and sent to every channel of the post.
- `social-core`: each provider declares `aiLabel: 'field' | 'none'` and, when it has a field, maps the flag in its publish call. From research 07 (read on the platforms' own pages unless marked): YouTube `status.containsSyntheticMedia`; Instagram `is_ai_generated` on the media container; Facebook Reels `is_ai_generated` on the finish call. TikTok's and Pinterest's fields are marked reported in the research: confirm each against its developer page in this session before wiring it; if it cannot be confirmed, leave that provider as `'none'` and note it. X, Threads and LinkedIn: `'none'`.
- The composer: for a post that has a video, a **Made With AI** `Toggle` in the post's settings with the help line "Captions and cuts do not need this. A made-up voice or picture does." Under it, for each chosen channel whose provider is `'none'`: "{Platform} has no label for AI. Say it in your caption if you need to."
- It is suggested, not forced: when the post's video is a clip with `usesAiVoice` (Module 09), the toggle starts on with a small note, "This clip uses a made-up voice."; the user may turn it off. It is never turned on for captions, cuts, layouts or Follow The Speaker (YouTube's own rule draws the line there).
- The simulated publisher records the flag in its stand-in answer so e2e can assert it.
- The public API's post routes accept `madeWithAi` too (check the Sprint 8 contract document and add it there).

### 5. Tests

- `packages/automation`: `readPostingSlots` (a legacy entry reads as all days, window 0), `jitteredTime` (inside the window, never on a five-minute mark, stable for a seed, no two posts in one minute, a window of 0 is exact), `nextFreeSlot` with slots (skips a weekday not listed, still skips taken minutes, daylight saving), `suggestSlots` (21 a week is three slots on all days; 10 a week merges as described; spacing; the day's bounds), `randomTimeOfDay` (inside the part of the day, never on a five-minute mark, not near a taken post, not before the lead time).
- API: slots on a channel (window values 0, 5, 15, 30 only; days 1 to 7 distinct and at least one; strict body; the migrated data reads back as all days), `next-slot` (weekday and jitter applied, no slot handed out twice, no posting times), the public API's `postingSlots`, `madeWithAi` on create and update, tenancy.
- `social-core`: each provider's mapping (the field is present only when the flag is on; `'none'` providers send nothing).
- Web: Next Available sets the date and handles no posting times; the slots dialog (window select, weekday chips, at least one day, Add Another Time); Shuffle's preview and apply; the schedule dialog's four random-time buttons (a time inside each part of the day, a second press gives another); the Made With AI toggle, its notes, the suggestion from `usesAiVoice`.
- Worker: a post placed by Next Available publishes at its jittered minute (the publish workflow untouched).

## Scope

**In**: posting slots (time, window, weekdays) in the existing JSON list with its migration, jitter when a slot is taken, Next Available in the composer, Shuffle Times, Pick A Random Time in the schedule dialog, the Made With AI flag and its provider mapping.
**Out**: best-time suggestions from analytics, caption and title templates with colours (Signatures already cover saved text; a fuller template feature is Module 17), auto-posting without the composer, a separate slots table.

## Tasks

- [ ] Posting slots: the migration (default and `UPDATE`, no new table), `readPostingSlots`, the extended `postingTimes` schema and public API field, `jitteredTime`, `nextFreeSlot` with weekdays and windows, jitter applied where a slot is taken.
- [ ] `GET /channels/next-slot`; Next Available in the composer.
- [ ] The slots dialog (window select, weekday chips) and Shuffle Times (`suggestSlots`, the dialog).
- [ ] Pick A Random Time in the schedule dialog (`randomTimeOfDay`).
- [ ] `Post.madeWithAi`; provider `aiLabel` and mappings (confirm the reported fields first); the composer toggle, notes and suggestion; the public API field.
- [ ] Title-case test green.
- [ ] Playwright once (`PUBLISH_SIMULATION=true`): set a slot window and weekdays, Shuffle, Next Available on two posts (different minutes), Pick A Random Time, Made With AI on a video post to YouTube, publish, see the flag in the stand-in. Screenshots in `screenshots/`.
- [ ] `verify-change` (it must include `social-core`'s and `automation`'s dependants); update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config packages/automation/jest.config.js queue
npx jest --config packages/social-core/jest.config.js
npx jest --config apps/api/jest.config.js apps/api/src/modules/channels apps/api/src/modules/posts
npx jest --config apps/web/jest.config.js apps/web/src/components/composer
```

## Done When

- With a 15 minute window, two posts placed by Next Available land at different minutes near their slots, never on a round five minutes.
- A slot that runs only on Tuesday and Thursday is never given for another weekday.
- Every channel that existed before the migration still has the same times, on all seven days, with no window.
- A post scheduled by hand at 8:00 goes out at 8:00.
- Shuffle Times at 21 a week suggests three slots on every day and saves them to the channel; at 10 a week it suggests the merged weekday slots.
- Pick A Random Time with Evening fills a time between 6:00 PM and 9:59 PM, not on a five-minute mark, and a second press gives another.
- Next Available with no posting times explains what to do.
- A video post marked Made With AI sends YouTube's, Instagram's and Facebook's fields (seen in the simulated publisher), and shows the "no label" line for channels without one.
- Scheduling, the calendar and publishing behave as before for posts that use none of this.

## Hand Check

With `PUBLISH_SIMULATION=true` and the demo admin:

1. Channel preferences, Posting Times: set a slot to Within 15 Minutes and untick Saturday and Sunday on it. Shuffle Times: move the slider to 21, read the preview, Use These Times; then 10 and read the merged slots.
2. Composer: write a post, Next Available: the date fills with a time near a slot, not on it. Save. Do it again for a second post: a different slot.
3. Schedule a third post by hand at an exact time: it stays exact.
3a. Open the schedule dialog on a fourth post: press Evening, then Evening again: two different times in the evening, neither on a five-minute mark.
4. A post with a video to YouTube and LinkedIn: turn on Made With AI: LinkedIn shows the "no label" line.
5. Let it publish in simulation and check the worker's log or the stand-in for the flag.

## Handoff

Module 16's e2e covers these flows. Module 17 holds templates (the per-weekday times are built here).
