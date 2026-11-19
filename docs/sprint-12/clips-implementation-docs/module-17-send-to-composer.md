# Module 17: Send To Composer

> **Sprint 12, Clips** | Status: Not started | Size: M (one session)
> **Depends on**: [Module 15](module-15-export.md) (and the Create tab of [Module 06](module-06-clips-home-and-videos.md) and the Clips tab of [Module 07](module-07-manual-clipping-and-clips-library.md))
> **Stories**: CL-11.1; CL-11.2 (Pick An Exported Clip In The Composer); CL-11.3 (See What Is Coming Up)
> **Next**: [Module 19](module-19-retention-quotas-and-safety.md), [Module 20](module-20-hardening-e2e-worker-image-closeout.md)

## Goal

After this module an exported clip goes to the composer in one step: a dialog with the channel picker and a caption, each channel that cannot take this clip greyed with a plain reason, a draft post created with the clip attached, and the composer opened on it. The clip then shows as Scheduled, and links to the live post once it is out. PostGear's posting rules learn about video length and shape for the first time. The composer's media picker gets a **Clips** tab, so any exported clip can be attached from inside a post, and the Create tab gets a **Coming Up** panel that lists the posts that will use clips in the next two weeks.

## Read First

- `CLAUDE.md`, then the README in this folder (rules, names).
- [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 8 (the result card), 10 (the Send To Composer dialog).
- User stories: CL-11.1, CL-11.2, CL-11.3; Journey A step 9.
- Research: [`13-screenshot-coverage.md`](../research/13-screenshot-coverage.md), StreamLadder screens 02, 19 and 20 (the scheduled panel with **View calendar**, the "Select a clip" modal with **Sort** and list or grid).
- Sprint doc: API Routes (`send`); Database (`ClipPost`).
- Research: [`07-legal-limits-cost-and-risks.md`](../research/07-legal-limits-cost-and-risks.md), the per-platform upload limits table with its sources and the ones marked reported (length, size and shape for Instagram Reels, Facebook Reels, YouTube Shorts, TikTok, X, Threads; Instagram's 300 MB cap; widths above 1920 refused by Instagram and Threads).
- Code: `packages/social-core/src/composer/rules.ts` (`MediaRules`), `validate.ts`, and each provider's rules in `packages/social-core/src/providers/*/index.ts`; `apps/api/src/modules/studio/studio.service.ts` (`prepareSend`, `nextFullHour`) and `dto/studio.schema.ts` (`sendDesignSchema`); `apps/api/src/modules/posts/posts.service.ts` (`create`, `parseImageIds`) and `dto/posts.schema.ts`; `apps/web/src/components/studio/send-dialog.tsx` and `studio-editor.tsx` (`openComposer`, the focus return); `apps/web/src/components/composer/media-picker-dialog.tsx` (the picker that gets the Clips tab) and `apps/web/src/components/media/use-media-list.ts`; the calendar's week route in `apps/web/src/app/(dashboard)/[orgId]/calendar/`; `apps/web/src/lib/composer-data.ts`; the published post link added in commit `a6a95b0` (where a post's live address is shown).

## Design

### 1. Video Rules In `social-core` (pure, browser-safe)

- `MediaRules` gains optional video fields: `videoMinMs`, `videoMaxMs`, `videoRatios` (allowed shapes as `'9:16' | '16:9' | '1:1' | '4:5'`, or `'any'`), `videoMaxWidth`. Each provider's rules get the values from research 07's table, with a comment naming the source and the date it was read; a value the research marks reported is still set, with "reported" in the comment so the real-test plan checks it.
- Providers that do not take video here today (LinkedIn and Pinterest have `maxVideos: 0`) are left as they are; their reason is "does not take video here".
- `videoFit(rules, facts)` in `composer/video-fit.ts`: `facts` is `{ durationMs, width, height, bytes }`; it returns `{ ok: true }` or `{ ok: false, reason }` with one of the reasons `no_video`, `too_long`, `too_short`, `wrong_shape`, `too_big`, `too_wide`, and the limit that was hit, so the caller can write the sentence.
- `validate.ts` uses `videoFit` when a post's video has facts (`Media.durationMs` and size are filled for exported clips since Module 05, and for other videos after Module 19's backfill). A video without facts is not blocked: behaviour for old media does not change.
- The composer's own validation messages gain the same sentences, so a clip that slipped through is still caught there.
- Tests: `videoFit` per reason; each provider's table values are present; old media without facts passes as before.

### 2. The Send Route

`POST /clips/:clipId/send` `{ channelIds, caption }` (a `.strict()` schema; `caption` cleaned like Studio's, at most the composer's shared limit; one to twenty channels):

1. The clip must be exported and current (Module 15's fingerprint rule), else 409 `clip_not_exported` with "Export this clip first." The web offers to export.
2. Load the exported `Media`; check every channel belongs to the workspace; run `videoFit` for each and refuse the request (422 `clip_does_not_fit`, naming the channels) if any chosen channel fails, since the dialog should never have allowed it.
3. `PostsService.create` with `state: 'DRAFT'`, `publishDate: nextFullHour()`, `shared: [{ content: caption, media: [{ id: mediaId }] }]` and the channels, exactly as Studio's `prepareSend` does.
4. Write `ClipPost { clipId, postGroup, mediaId }`.
5. Answer `{ group }`.

No SSE is needed: the export already happened.

### 3. The Dialog (`components/clips/editor/send-dialog.tsx`)

Built from Studio's `SendDialog` pieces:

- The channel picker lists the workspace's channels. Each is checked in the browser with `videoFit` against the clip's facts. A channel that does not fit is greyed, cannot be ticked, and shows its reason in `type-muted` under its name:
  - "{Platform} does not take video here."
  - "This clip is 2 min 10 s. {Platform} takes up to 90 seconds."
  - "This clip is shorter than {Platform} allows."
  - "{Platform} needs a vertical or square video."
  - "This file is 340 MB. {Platform} takes up to 300 MB."
- **Caption**: a `Textarea` ("Enter your caption") with the count. It is the starting text for every channel; per-channel edits happen in the composer.
- A help line: "The composer opens next. You can set the time and the details for each channel there."
- **Open In Composer** (primary, disabled until one channel is ticked) and **Cancel**. On success: `router.push('/{orgId}/composer?group=...')`. When the composer closes, focus returns to the Send button (Studio's `backFromComposer` pattern).
- When the clip is out of date the dialog opens on a first step instead: "You changed this clip after the last export." with **Export Again** (starts the export and shows its progress; the dialog continues when it is done) and **Send The Old Version** (secondary).
- With no channels connected: an `EmptyState` in the dialog, "Connect a channel to post this clip.", with a link to the channels page.

### 4. Where Send Appears

- The Export tab's result card (enabled now), the clip card's menu in the Clips tab and on the video page (**Send To Composer**, only for exported clips), and the toast after an export finishes.
- The clip card shows **Scheduled** while a post that uses it is waiting, and afterwards a **View Post** item in its menu that opens the live post's address (from the post's stored link, the same one the calendar shows). A clip sent three times lists its posts in a small popover.

### 5. Select A Clip: The Clips Tab In The Media Picker (CL-11.2)

The composer's media picker (`media-picker-dialog.tsx`, "Insert Media") gets a second tab, **Clips**, beside the Media Library, titled **Select A Clip**. It lists the workspace's **exported** clips so a clip can be attached from inside any post without going through Clips first (StreamLadder's "Select a clip" modal).

- **The list**: the poster in the clip's shape, the name, "0:42, 9:16", the date it was exported, and a small state `Badge` (**Exported**, **Scheduled**). **Sort** (Newest, Oldest) and a **list or grid** switch (the same `Segmented` and memory as the Clips tab of Module 07). It reads `GET /clips?status=exported&sort=newest|oldest&page`, 24 a page, with a `SearchInput` over the clip name. A clip changed since its last export is still listed with the note "Changed since the last export. The old version will be used." because the file that posts is the exported one.
- **Picking**: a click selects; **Add Selected Media** attaches the clip's exported `Media` row (`exportedMediaId`) exactly as a Media pick would, so the composer's existing rules, previews and `videoFit` checks apply (the row's facts are filled since Module 05). Only video fits a part that takes video; a part that is images only shows the tab with the sentence "This post part takes pictures only." and nothing selectable. `single` and `imagesOnly` behave as they do for the library.
- **Empty**: an `EmptyState` "No exported clips yet. Export a clip in Clips and it will appear here." with a link to the Clips page.
- **The link back**: when a post is saved with an exported clip's media on it (from this picker or from Send To Composer), `PostsService` calls `ClipPostsService.syncForPost(group, mediaIds)`, which finds clips whose `exportedMediaId` is in that list and upserts a `ClipPost { clipId, postGroup, mediaId }` for each (and removes the ones no longer attached). So a clip shows **Scheduled**, and **View Post** later, however it got into the post.

### 6. Coming Up (CL-11.3)

A panel on the **Create** tab (an `AnalyticsPanel` group like Recent Videos, under the link box) that answers "what is about to go out?" (StreamLadder's "Scheduled posts, next 14 days" with **View calendar**).

- **What it lists**: scheduled posts, in the next 14 days, that use at least one exported clip: the clip's poster, its name, the channel marks it goes to, and the date and time ("Thu 20 Nov, 6:00 pm" in the workspace's time zone), soonest first, at most five rows and a line "and 3 more" when there are more.
- **Route**: `GET /clips/coming-up` answers `{ items, total }` from one query over `ClipPost` joined to the post groups that still have a post waiting with a publish date between now and 14 days ahead (the same "waiting" rule the Scheduled state of Module 07 uses), so it never counts a published, failed or draft post. Tenancy by workspace like every route.
- **Actions**: **View Calendar** (secondary, small) opens the calendar on the week of the first item (`/[orgId]/calendar`, week view, with the date in the query); a row opens that post in the composer.
- **Empty**: "Nothing scheduled yet. Send a clip to the composer and it will show up here." with **Send A Clip** only when there is at least one exported clip (it opens the Clips tab on Exported). The panel is always drawn once the workspace has an exported clip, and not before.

### 7. Tests

- `social-core`: section 1.
- API: not exported, out of date, a channel from another workspace, a channel that does not fit, the draft's shape (state, media id, channels), `ClipPost` written, tenancy.
- API: `GET /clips/coming-up` (only waiting posts, only the next 14 days, soonest first, a draft or published post is left out, tenancy); `syncForPost` (a clip attached through the picker gets a `ClipPost`, a removed one loses it, nothing is written twice); `GET /clips?status=exported` sorted both ways.
- Web: the dialog (reasons per channel, nothing tickable that does not fit, the out-of-date first step, no channels, the push to the composer), the card's Scheduled badge and View Post; the picker's Clips tab (sort, list and grid, search, the changed-since-export note, the pictures-only part, the empty state, attaching the exported media), the Coming Up panel (rows, "and N more", empty, **View Calendar** goes to the right week).

## Scope

**In**: video rules and `videoFit` in `social-core`, the composer's use of them, the send route, the dialog, `ClipPost`, the Scheduled and View Post links, the Clips tab in the media picker (with the `ClipPost` sync that goes with it), and the Coming Up panel.
**Out**: per-platform fields in the dialog (title, privacy, made for kids: those stay in the composer), posting directly without the composer, posting slots and the AI label (Sprint 13), re-encoding a clip to fit a platform's size cap (Module 21).

## Tasks

- [x] `MediaRules` video fields and each provider's values with sources; `videoFit`; `validate.ts`; composer messages.
- [x] `POST /clips/:clipId/send` and its schema; `ClipPost`.
- [x] The dialog with reasons, the out-of-date step and the empty state.
- [x] Send on the result card, the card menus and the export toast; Scheduled and View Post.
- [x] The Clips tab (**Select A Clip**) in `media-picker-dialog.tsx`: sort, list and grid, search, empty state; `ClipPostsService.syncForPost` called from the post save path.
- [x] `GET /clips/coming-up` and the **Coming Up** panel with **View Calendar**.
- [x] Title-case test green.
- [x] Playwright once under simulation (`PUBLISH_SIMULATION=true`): export, send to two channels, see the composer open with the clip, schedule it, see Scheduled on the card and the post in Coming Up, let it publish, open View Post; in a new post pick a clip from the Clips tab of the picker. Screenshots in `screenshots/`.
- [x] `verify-change` (it must include `social-core`'s dependants); update the Progress table and the Decision Log.

**Gaps at close (2026-11-19)**: Everything ran under `PUBLISH_SIMULATION` and `CLIPS_SIMULATION`: no real platform post was made, and the address View Post opened is the stand-in's. Of the two channels sent to, Acme Studio published and Acme on X failed with "needs reconnecting" (the seed channel's own state; the failure path is Sprint 5's). No shipped provider has a 90 second limit or sets `videoRatios` yet, so hand check step 6 (a 2 minute horizontal clip) shows only LinkedIn's reason; the 90 second rule is covered in `social-core`'s `video-fit` and `validate` tests with a test rule, and the API's refusal by an 11 minute clip sent to TikTok (`clip-send`, 422 in the dialog's words). TikTok's 10 minutes, 4 GB and 4096 px are as reported, not tested. The composer's default time is the next full hour in UTC, which lands on a half hour in India (shared with Studio's send, not changed here). `type-heading`'s `text-wrap: balance` beats `truncate`, so long names wrap instead of ending in dots; fixed in the new Clips spots, left in 14 older ones (changing the role would move approved headings). The picker's footer button reads Add Selected Media on both tabs (one shared footer). The light and Lilac themes are left to the hand check.

## Tests

```powershell
npx jest --config packages/social-core/jest.config.js composer
npx jest --config apps/api/jest.config.js apps/api/src/modules/clips apps/api/src/modules/posts
npx jest --config apps/web/jest.config.js apps/web/src/components/clips apps/web/src/components/composer
```

## Done When

- Send To Composer on an exported clip opens the dialog; channels that cannot take the clip are greyed with a reason and cannot be ticked.
- Open In Composer creates a draft with the clip attached to the chosen channels and opens the composer on it.
- After scheduling, the clip shows Scheduled; after it is published (in simulation), View Post opens its address.
- An out-of-date clip offers Export Again first.
- A 2 minute clip cannot be sent to a channel whose limit is 90 seconds, in the dialog or by calling the API directly.
- Posts with images and old videos validate exactly as before.
- In any post, **Insert Media** has a Clips tab that lists exported clips newest first (and oldest first on request), in list or grid, and attaching one puts its exported video on the post; the clip then shows Scheduled.
- The Create tab's Coming Up panel lists the scheduled posts that use clips in the next 14 days, soonest first, and **View Calendar** opens the right week; it never lists a draft, a published or a failed post.

## Hand Check

With `CLIPS_SIMULATION=true`, `PUBLISH_SIMULATION=true` and the demo admin with at least a YouTube, an Instagram and a LinkedIn channel:

1. Export a 40 second vertical clip. Press Send To Composer.
2. LinkedIn is greyed: "LinkedIn does not take video here." Tick YouTube and Instagram, type a caption, Open In Composer.
3. The composer opens with the clip and the caption on both channels. Schedule it a few minutes ahead.
4. Clips tab: the clip is under Scheduled.
5. After it publishes: the card's menu has View Post.
6. Make a 2 minute horizontal clip, export, Send To Composer: the channels that only take short or vertical video show their reasons.
7. Create tab: the Coming Up panel lists the post from step 3 with its poster, channels and time. **View Calendar** opens that week.
8. Open the composer fresh, Insert Media, Clips tab: the exported clips show; switch Sort and the list or grid view; attach one. Save the post as scheduled: that clip now shows Scheduled.

## Handoff

Sprint 13's publisher module adds posting slots, the AI label and Next Available in the composer; this dialog stays as it is. Module 19's backfill gives older videos their facts so `videoFit` covers them too.
