# Module 12: More Sources And Platforms

> **Sprint 13, Clips AI** | Status: Not started | Size: M (one session)
> **Depends on**: Sprint 12 (Modules 03, 06, 18). No AI module is needed.
> **Stories**: CA-8.1, CA-8.2
> **Next**: [Module 13](module-13-publisher-upgrades.md)

## Goal

After this module the link box and the downloader read more than three sites. Each new site is one small entry behind its own switch, tested from fixtures. Ten are switched on by default and four are built but off (D13-08); the real test decides whether any off site is switched on or any on site is paused. A file can also be picked from Google Drive through Google's own picker, built last behind a key (D13-09). Nothing about how videos are imported, stored or edited changes.

## Read First

- `CLAUDE.md`, Sprint 12's README, then the README in this folder.
- User stories: CA-8.1, CA-8.2; section 5 (a new site fails; Drive not connected).
- Decisions: D13-08 (which sites are on), D13-09 (Google Drive built last, behind a key); Sprint 12's D12-13 and D12-15 (what is refused, and the one switch `CLIPS_PLATFORMS`).
- Research: [`01-reference-features.md`](../research/01-reference-features.md), the section on OpusClip's wider sources: which have a yt-dlp extractor today (Vimeo, Rumble, Loom, Zoom, X, Facebook, LinkedIn, Dailymotion, TikTok, Instagram, Google Drive, Dropbox, and from the later audit Reddit, Pinterest and Threads), which do not (Riverside, StreamYard: upload only, D13-08), and that private Drive files need Google's picker with a narrow scope. Sprint 12's [`04-link-import-and-fetch.md`](../../sprint-12/research/04-link-import-and-fetch.md) (the argument base, the extractor allowlist, the error table) and [`07-legal-limits-cost-and-risks.md`](../../sprint-12/research/07-legal-limits-cost-and-risks.md) (platform terms; no login to get around private content).
- Code: Sprint 12 Module 03 (`recogniseLink`, the yt-dlp binding, fixtures, the platform switch and breaker), Module 06 (the link box and its placeholder), Module 18 (the format menu); `packages/db/prisma/schema.prisma` (`ClipPlatform`); the Google login setup in `.env.example` and the auth module (which Google project and consent screen exist).

## Design

### 1. Sites As Data (`packages/video-engine/src/links/sites.ts`, pure)

Sprint 12 hard-codes three platforms. Turn them into a table without changing their behaviour:

```ts
interface SiteEntry {
  id: string;                         // 'youtube', 'twitch', 'kick', 'vimeo', ...
  name: string;                       // "Vimeo", shown to users
  hosts: string[];                    // exact hosts, lower case
  shapes: Array<{ pattern: RegExp; kind: LinkKind; id: (m: RegExpMatchArray) => string; canonical: (id: string) => string }>;
  extractors: string[];               // the yt-dlp extractor names this site may use
  defaultOn: boolean;
  notes?: string;                     // why it is off by default, shown to operators only
}
```

- `SITES`: the three existing ones (moved, with their tests unchanged and green) plus the new entries. `recogniseLink` walks the table.
- `ClipPlatform` in the database is an enum of three plus UPLOAD. Change the column to a string validated against `SITES` ids (`prisma-change`; a data migration lower-cases the existing values, or keep the enum and add values: choose the smaller change after reading the Sprint 12 code, and record it).
- `CLIPS_PLATFORMS` accepts any site id. Its default becomes the ids with `defaultOn`: the ten sites above plus the Sprint 12 sites as that sprint set them (YouTube stays off in production until the legal read, D12-15; the one env value is the only switch).

### 2. The New Sites

For each, from research 01's table and yt-dlp's current site list (read it again on the day, since extractors change): the link shapes, the extractor names, and a recorded probe fixture (a real probe's JSON shape trimmed by hand; no video is fetched in this module).

| Site | Default | Notes |
|---|---|---|
| Vimeo | on | Public and unlisted-with-link videos; password-protected ones are refused as private |
| Rumble | on | |
| Dailymotion | on | |
| Loom | on | Share links; folders are refused as "not one video" |
| X | on | A post with one video; a post with several is refused with "This post has more than one video." |
| Facebook | on | Public videos and reels; anything behind a login is refused |
| LinkedIn | on | Public post videos |
| Reddit | on | A public post whose media is one Reddit-hosted video (`v.redd.it`); galleries, crossposts to other sites and anything behind a login or an over-18 gate are refused with the private sentence ("This post has more than one video." for a gallery) |
| Pinterest | on | A public pin that is one video; boards and idea pins with several pages are refused as "not one video" |
| Threads | on | A public post with one video; a post with several is refused with "This post has more than one video." Read yt-dlp's current extractor list on the day: if no Threads extractor exists yet, the entry is still written (link shapes, fixture, message) but stays off and the Decision Log says why |
| Zoom | off | Built, off (D13-08): cloud recording share links often need a passcode; tested from fixtures, off until tried for real |
| TikTok | off | Built, off (D13-08): links break often and the site changes its protection; off until tried for real |
| Instagram | off | Built, off (D13-08): needs a login for most posts, and we never use one |
| Dropbox | off | Built, off (D13-08): shared file links |

- Riverside and StreamYard have no extractor (D13-08): they stay "upload the file", and the unsupported message names them when their host is pasted ("Riverside links cannot be read. Download the recording and upload it instead.").
- The rule from Sprint 12 holds for every site: no login, no cookies of a user, nothing private. A site whose public links need a logged-in session is refused with the private sentence.
- Per-site quirks go in the yt-dlp binding as data on the entry (extra extractor arguments), never as scattered `if` statements.
- The error mapper gains each site's common failure strings (from yt-dlp's source for that extractor), all mapped onto the existing codes; a new code only for `link_many_videos`.

### 3. The UI

- The link box's placeholder becomes "Enter your video link", and a help line under it lists the sites that are on ("YouTube, Twitch, Kick, Vimeo, Rumble and more", with the full list in a tooltip built from `status.sites`).
- The link card's platform badge uses the site's name; kinds read as before ("Video", "Clip", "Past stream", "Short").
- Messages use the site's name: "{Site} is not answering us right now. ...", "{Site} links are paused for now. ...".
- **Download** (Sprint 12 Module 18) works for the same sites with no change beyond the table.
- AI: chat reading stays Twitch only; signals and everything in this sprint work on any imported video.
- `GET /clips/status` gains `sites: [{ id, name, on }]`.

### 4. Google Drive (Build Last; May Be Parked)

- What it needs outside the code: the Drive API and the Picker enabled on the Google project used for login, and the `drive.file` scope added to its consent screen (the narrowest one: PostGear can read only files the user picks). That is Arvind's to do in Google's console; this module writes the steps into the keys guide and builds against simulation. If the consent screen change is refused or not made, park this section in Module 17 and say so in the Decision Log (D13-09: parked if the consent screen is not changed).
- Flow: **Google Drive** (secondary) beside **Upload A Video**. It loads Google's picker in the browser (only when clicked), asking for the scope in a pop-up the first time. The user picks one video file. The browser sends `{ fileId, accessToken }` to `POST /clips/videos/drive`.
- The API checks the size and type from Drive's file facts with that token, applies the upload limits, creates the video row (platform `drive`, treated as an upload: the user's own file, no rights tick, the note shown instead) and an IMPORT job whose first step downloads the file from Drive with the token (a short-lived token in the job's input, never logged, cleared from the row when the job ends) into the private space as the ORIGINAL, then continues as an upload.
- PostGear never lists a Drive, never stores a refresh token, and never keeps the access token past the job.
- Simulated binding: a fake picker in the browser under `CLIPS_SIMULATION` that returns a made-up file id, and a fake Drive download that copies a sample.
- "Connect Google Drive to pick a file." when the picker is not configured (`GOOGLE_DRIVE_PICKER_KEY` unset): the button is absent rather than broken.

### 5. Tests

- Engine: the table (ids unique, hosts lower case), every site's shapes against real-shaped links and look-alikes, the three original sites' tests untouched.
- Tools: the argument builder uses only the entry's extractors; the probe mapper against each new fixture; the error mapper's new strings.
- API: the switch per site, messages with the site's name, the status list; Drive (limits, the token never logged or stored after the job, tenancy).
- Web: the placeholder and help line follow the status, the badge, the Drive button absent when not configured.

## Scope

**In**: sites as data, the new entries with fixtures and switches, the link box wording, the downloader for the same sites, Google Drive behind its key (or parked).
**Out**: any site that needs a login, Riverside and StreamYard links, Dropbox and Zoom switched on, OneDrive, importing a whole channel or playlist (Module 17).

## Tasks

- [ ] `links/sites.ts`; the three existing sites moved with their tests green; `ClipPlatform` widened (record how).
- [ ] The new entries (ten on, four off, including Reddit, Pinterest and Threads) with link shapes, extractors and probe fixtures; quirks as data; the error strings.
- [ ] `CLIPS_PLATFORMS` and its default; `status.sites`.
- [ ] The link box placeholder, help line, badge and messages; the downloader check.
- [ ] Google Drive: the keys guide steps, the picker, the route, the Drive download step, the simulated binding; or park it with a Decision Log row.
- [ ] Title-case test green.
- [ ] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config packages/video-engine/jest.config.js links
npx jest --config packages/media-tools/jest.config.js downloader
npx jest --config apps/api/jest.config.js apps/api/src/modules/clips
npx jest --config apps/web/jest.config.js apps/web/src/components/clips/home
```

## Done When

- Every Sprint 12 link test still passes unchanged.
- A link from each of the ten new sites that is on (Vimeo, Rumble, Dailymotion, Loom, X, Facebook, LinkedIn, Reddit, Pinterest, Threads) is recognised and, under simulation, probes to a card with the site's name; a site that is off (TikTok, Instagram, Zoom, Dropbox) answers the paused sentence.
- Adding a site is one table entry, one fixture and one test file.
- No site uses a login or a user's cookies.
- The link box reads "Enter your video link" and lists the sites that are on.
- Google Drive either brings a picked file in as an upload (in simulation) with no token kept afterwards, or is parked with the reason.

## Hand Check

With `CLIPS_SIMULATION=true` and the demo admin:

1. The Create tab: the new placeholder and help line; the tooltip lists the sites.
2. Paste a Vimeo-shaped, a Rumble-shaped, a Reddit-shaped and a Threads-shaped simulation link: cards with their names. Import one.
3. Paste a TikTok link: "TikTok links are paused for now. You can upload the file instead."
4. Set `CLIPS_PLATFORMS` to include `tiktok`, restart: the same link now probes (from its fixture).
5. Paste a Riverside link: the upload-instead sentence naming Riverside.
6. If Drive is built: Google Drive, pick the fake file, see it come in as an upload.

## Handoff

The real-test plan tries each site that is on with a real link and decides which stay on. Module 17 holds channels, playlists and more cloud drives.
