# Sprint 4 — Completion Checklist & Test Guide

Companion to [sprint-04-post-composer-and-media.md](../sprint-documents/sprint-04-post-composer-and-media.md).
Status as of **2026-09-14**.

Sprint 4 started from stubs: `composer/page.tsx` and `media/page.tsx` were
`return null`, `apps/api/src/modules/posts/` held only a `.gitkeep`, there was no
media module at all, and `components/composer/` and `components/previews/` were
empty folders. The `Post` and `Media` tables existed (Sprint 1) but had never
been written to.

The **[Pre-existing]** things worth not re-testing: the `Post`/`Media` models
and the `State` enum, Sprint 3's providers and channels API, the design-system
components, and `sharp` (already present as a dependency of Next).

**All four Definition of Done items are met and each has a browser test.**
Nothing is published to a real platform in this sprint — that is Sprint 5's
scheduler, and it still needs the developer apps Sprint 3's gaps describe — so
the [Known gaps](#known-gaps) are about what the composer hands to Sprint 5, not
about what the composer does.

---

## Prerequisites

```bash
docker compose up -d          # Postgres, Redis, MinIO
npm install
npm run db:generate
npm run db:migrate            # one new migration: 20260914074756_sprint4_media_metadata
npm run db:seed               # now also seeds an Instagram channel
```

Then, in separate terminals:

```bash
npm run dev:api               # API on :3001
npm run dev                   # web on :3000
```

Seeded accounts keep the password **`DemoPassword123!`**. `seed-demo-org` now
has three channels, chosen because their rules differ in every way the composer
has to handle:

| Channel | Provider | Why it is there |
|---|---|---|
| Acme on X | `x` | Weighted length, native threads, media on every part — and flagged `needs_reconnect` |
| Acme Marketing | `linkedin` | Later parts become comments, which carry no media |
| Acme Studio | `instagram` | **New.** No post without an image; JPEG only; 4:5–1.91:1 |

---

## 1. Shared composer layer — one set of rules, run everywhere (Task 1 groundwork + the Risk)

| # | Item | Status |
|---|---|---|
| 1.1 | `packages/social-core/src/composer/` — a browser-safe entry point | ✅ [New] |
| 1.2 | Post **document**: a closed JSON tree, not HTML | ✅ [New] |
| 1.3 | `renderPlainText` — document → the exact text a platform receives | ✅ [New] |
| 1.4 | X's weighted length (URLs 23, CJK/emoji 2) and `overflowIndex` | ✅ [New] |
| 1.5 | Declarative `ProviderRules` on all eight providers | ✅ [New] |
| 1.6 | One validator, used by the browser, the API and every `checkValidity` | ✅ [New] |
| 1.7 | `GET /channels/providers` sends each provider's rules | ✅ [New] |

### 1.5 — the sprint's own risk, retired rather than worked around

The sprint document names the risk: *"providers should expose maxLength/media
constraints so this sprint's validation doesn't hardcode platform rules in the
UI layer."* Sprint 3's providers expressed their rules as imperative
`checkValidity` code that only the API could run. Each now declares a
`ProviderRules` object beside the code that publishes, `checkValidity` in every
provider is the shared validator run against it, and the API sends the same
object to the browser. **There is no platform rule anywhere in `apps/web`.**

A test asserts the equivalence directly: for every provider, `checkValidity` on
a too-long post returns exactly the message the shared validator gives.

### 1.2 — why a JSON document

The reference stores editor HTML and renders every preview through
`dangerouslySetInnerHTML`. That makes the post body a stored-XSS surface, and
sanitizing untrusted HTML in Node without a DOM is exactly the code that is
wrong without anyone noticing. PostGear stores a TipTap/ProseMirror JSON tree
that the API holds to an allowlist of six node types, three marks and
`http`/`https` links; previews render text nodes as text. Nothing in PostGear
turns a post into HTML.

### 1.4 — the counter errs high, deliberately

A counter that reads low lets a post be queued that X rejects hours later with
the user gone; one that reads high asks for a trim that was not strictly needed.
Where PostGear does not reproduce `twitter-text` exactly, it over-counts: an
email's domain counts as a link, a keycap emoji counts more than 2. The one
under-count left is a bare domain on an uncommon generic TLD shorter than 23
characters — see [Known gaps](#known-gaps).

**How to test:**

```bash
cd packages/social-core && npx jest
```

Expect **121 passed** across six suites (was 45): 64 new composer tests and 12
new provider tests.

---

## 2. Three Sprint 3 publishing gaps this sprint surfaced and closed

Declaring rules as data meant reading each `post()` to see what it *actually*
does. Three providers accepted media they could not publish:

| Provider | What Sprint 3 did | What Sprint 4 does |
|---|---|---|
| **LinkedIn** | `createPost` sent `commentary` only — an attached image passed `checkValidity` and was **silently dropped** | **Implemented** the Images API: `initializeUpload` → PUT bytes → `content.media` for one image, `content.multiImage` for 2–20. Uploads are owned by the author URN, so company pages work unchanged. Video is declared unsupported. |
| **Pinterest** | Sent a video URL where the API expects a `media_id` from its upload flow — every video Pin would fail | Video **declared unsupported** until that flow exists |
| **TikTok** | Counted videos only; an attached image was ignored | Images **declared unsupported** (photo mode is a different API) |

Facebook's rules also record something its code already did: with a video
attached, photos are dropped (the `/videos` edge carries the video alone), so
mixing is refused up front.

**How to test:**

```bash
cd packages/social-core && npx jest providers
```

The four `LinkedIn image publishing` tests pin the request sequence, the
`media`/`multiImage` choice, and organization ownership for pages.

---

## 3. Media pipeline (Task 4)

| # | Item | Status |
|---|---|---|
| 3.1 | `POST /media` — streamed to disk, one file, no extra fields | ✅ [New] |
| 3.2 | Type decided by **content sniffing**, never the name or claimed type | ✅ [New] |
| 3.3 | `sharp` pipeline: orient → strip metadata → fit 2048 px → JPEG/PNG → WebP thumbnail | ✅ [New] |
| 3.4 | Decoder must agree with the sniffer (disguised files refused) | ✅ [New] |
| 3.5 | Storage factory: `STORAGE_PROVIDER=local \| s3`, validated at boot | ✅ [New] |
| 3.6 | Local backend + static `/uploads` route with cross-origin + sandbox headers | ✅ [New] |
| 3.7 | S3 backend (AWS / R2 / MinIO), immutable cache headers | ✅ [New] |
| 3.8 | `GET /media` (search, type filter, pages), `GET /media/:id`, `GET /media/:id/usage`, `DELETE /media/:id` | ✅ [New] |
| 3.9 | Failed DB write removes stored objects; temp file always removed | ✅ [New] |
| 3.10 | `Media.mimeType`, `width`, `height` — the sprint's one migration | ✅ [New] |

### 3.3 — compression on the server, not in the browser

The sprint document says the reference compresses with `sharp`. Its upload
path does not: the reference compresses in its **frontend**, and its own
LinkedIn provider warns that self-hosters who switch that off send full-size
images to platforms. PostGear compresses in the API, so no client can skip it —
and stripping a phone photo's GPS location is a privacy guarantee only if the
client cannot opt out.

### 3.6 — two headers that are easy to get wrong

Helmet's default `Cross-Origin-Resource-Policy: same-origin` makes the browser
refuse to render images from `:3001` inside the app on `:3000`. The `/uploads`
route overrides it to `cross-origin`, and adds `Content-Security-Policy:
default-src 'none'; sandbox` so that nothing served from that path could run
script on the API's origin even if a non-image ever got stored there.

**How to test — the compression and privacy claim, against a raw file:**

```bash
# a 4000×3000 photo carrying an EXIF block with GPS text
node -e "require('sharp')({create:{width:4000,height:3000,channels:3,background:'#808080',noise:{type:'gaussian',mean:128,sigma:40}}}).jpeg({quality:95}).withMetadata({exif:{IFD0:{Copyright:'GPSLatitude 51.5007N'}}}).toFile('big-photo.jpg')"

curl -s -c /tmp/demo.txt -o /dev/null -X POST localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@postgear.local","password":"DemoPassword123!"}'
curl -s -b /tmp/demo.txt -c /tmp/demo.txt -o /dev/null -X POST localhost:3001/orgs/seed-demo-org/switch

curl -s -b /tmp/demo.txt -X POST localhost:3001/media -F file=@big-photo.jpg
```

Verified: a **10,176,665-byte** upload stored as **708,546 bytes (−93%)** at
**2048×1536**, `mimeType: image/jpeg`, with a `.thumb.webp` beside it. Then:

```bash
grep -c GPSLatitude apps/api/uploads/2026/09/<key>.jpg        # 0
curl -s -D - -o /dev/null localhost:3001/uploads/2026/09/<key>.jpg
```

Verified `0`, and headers `Content-Type: image/jpeg`,
`Cross-Origin-Resource-Policy: cross-origin`,
`Content-Security-Policy: default-src 'none'; sandbox`,
`X-Content-Type-Options: nosniff`,
`Cache-Control: public, max-age=31536000, immutable`.

**What is refused, and how:**

| Request | Verified response |
|---|---|
| No session | **401**, before a byte reaches disk (guards run before interceptors) |
| An SVG named `photo.jpg`, sent as `image/jpeg` | **415** "That file type is not supported…" |
| Two files in one request | **400** "Too many files" |
| An extra form field | **400** "Too many fields" |
| `/uploads/../package.json`, `%2e%2e` variants | **404** JSON, nothing served |
| A media id from another workspace (`GET`, `usage`, `DELETE`) | **404** |

A UTF-8 filename (`Écran — café 日本.png`) is stored intact; Multer's Latin-1
default would have garbled it, so `defParamCharset: 'utf8'` is set.

**The S3 backend, against the MinIO in `docker-compose.yml`:**

Run a second API with `STORAGE_PROVIDER=s3`, `S3_ENDPOINT=http://localhost:9000`,
`S3_BUCKET_NAME=postgear-media` (public-read policy), `S3_PUBLIC_URL=http://localhost:9000/postgear-media`.

Verified: upload **201** with a MinIO URL; an **anonymous** `GET` of that URL
**200** `image/jpeg`, 708,546 bytes, immutable cache header; the thumbnail
**200** `image/webp`; `DELETE` → both objects **404**. A 3 MB MP4 streamed from
the temp file came back **byte-identical**.

```bash
cd apps/api && npx jest src/modules/media
```

Expect **46 passed** across four suites — including real `sharp` runs proving
EXIF removal, CMYK→sRGB, transparency kept only when used, GIFs stored
byte-for-byte, truncated and disguised images refused, and orphan cleanup when
the database write fails.

---

## 4. Posts API and the draft lifecycle (Task 3, backend)

| # | Item | Status |
|---|---|---|
| 4.1 | `GET /posts`, `GET /posts/:group`, `POST /posts`, `PUT /posts/:group`, `DELETE /posts/:group` | ✅ [New] |
| 4.2 | **One group id per post**, across every channel | ✅ [New] |
| 4.3 | Threads as `parentPostId` chains, rows reused **by position** | ✅ [New] |
| 4.4 | Client never sends a row id | ✅ [New] |
| 4.5 | Document schema built to a fixed depth (no recursive validator) | ✅ [New] |
| 4.6 | `DRAFT` accepts unfinished work; `QUEUE` enforces every platform rule | ✅ [New] |
| 4.7 | State table: person sets only `DRAFT`/`QUEUE`; `PUBLISHED` is locked | ✅ [New] |
| 4.8 | Optimistic concurrency (`expectedUpdatedAt`) inside a serializable transaction | ✅ [New] |
| 4.9 | Media stored as id references; resolved (and org-scoped) at read time | ✅ [New] |
| 4.10 | Channel connect scoped to `organizationId` + `deletedAt: null` inside the insert | ✅ [New] |
| 4.11 | `@Roles(ADMIN, USER)`: membership required, writing open to members | ✅ [New] |

### 4.2 and 4.4 — two reference bugs this is written against

- **The group that is not a group.** The reference's `createOrUpdatePost` mints
  a fresh `uuidv4()` inside its per-channel loop, so a post sent to three
  channels is stored as three unrelated groups. PostGear mints the group once.
- **Client-chosen row ids.** The reference upserts by an id from the request
  body with no organization in the `where`, so a crafted save can overwrite
  another workspace's post. PostGear's schema has no row-id field at all, and
  rows are matched by position inside a group already filtered by organization.

**How to test — the whole lifecycle against a real API and database:**

Every step is an ordinary JSON request with the demo session from section 3.
The first, for example:

```bash
curl -s -b /tmp/demo.txt -X POST localhost:3001/posts -H 'Content-Type: application/json' -d '{
  "state": "DRAFT",
  "publishDate": "2026-12-01T09:00:00.000Z",
  "shared": [
    { "content": {"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Part one"}]}]}, "media": [] },
    { "content": {"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Part two"}]}]}, "media": [] }
  ],
  "channels": [
    { "channelId": "seed-channel-x", "customized": false },
    { "channelId": "seed-channel-linkedin", "customized": false }
  ]
}'
```

Later saves are `PUT /posts/<group>` with the same shape plus the
`expectedUpdatedAt` the previous response returned. These outcomes were verified
by a scripted walk through the sequence:

| Step | Result |
|---|---|
| Create a 3-part draft thread with an image for X + LinkedIn | **201**, 3 shared parts, 2 channels, media resolved to URLs |
| `GET /posts?state=DRAFT` | the post, preview rendered with Unicode bold, `parts: 3` |
| Save with `expectedUpdatedAt` from 2020 | **409** "Someone else changed this post…" |
| Reorder to 3-1-2 and customize LinkedIn to one part | **200**; X shows the new order, LinkedIn `customized: true` |
| Queue with 281 characters for X | **422** "Acme on X: X allows 280 characters; this post has 281." |
| Queue for a time in the past | **422** "Choose a time in the future…" |
| **Two concurrent saves from the same version** | exactly one **200**, one **409** |
| Queue a valid post | **200**, `state: QUEUE` (to an X channel needing reconnection — allowed, see 5.3) |
| `member@postgear.local` (USER role) creates a draft | **201** |
| Read the post from `seed-second-org` | **404** |
| A channel id that is not the workspace's | **400** "One of the selected channels is no longer connected…" |
| A `javascript:` link in the document | **400** |
| `GET /media/:id/usage` | `{ "posts": 1 }` |

**The rows themselves:**

```bash
docker exec postgear_postgres psql -U postgres -d postgear_db -c \
  'SELECT id, "integrationId", "parentPostId", state, "deletedAt" IS NOT NULL AS deleted,
          left(content, 40), image, settings
   FROM "Post" WHERE "group" = '"'"'<group>'"'"' ORDER BY "integrationId", "createdAt";'
```

Verified after the reorder, customize and queue: X's three rows form one chain
from a root whose **id never changed**, content moved between them; LinkedIn's
root is `{"customized":true}` and its two surplus rows are soft-deleted **and
detached** (`parentPostId` null); `image` holds only `[{"id":"…"}]`, never a URL;
`content` is a `{"type":"doc",…}` document. Every row shares one `group`.

```bash
cd apps/api && npx jest src/modules/posts
```

Expect **48 passed** across four suites: the schema rejecting hostile input
(including 20,000-deep nesting without a stack overflow), the state table, the
repository's chain writes and conflict mapping, and the service's draft/queue
rules against the real provider rules.

---

## 5. Frontend (Tasks 1–4)

| # | Item | Status |
|---|---|---|
| 5.1 | `/[orgId]/composer` — a route, not a modal; `?group=` reopens, `?media=` attaches | ✅ [New] |
| 5.2 | TipTap editor, configured down to what the document can hold | ✅ [New] |
| 5.3 | Channel picker with health: setup-needed unpickable, reconnect-needed warned | ✅ [New] |
| 5.4 | Shared thread + per-channel customize / "use the shared post" | ✅ [New] |
| 5.5 | Thread builder: add, remove, move up/down, drag-and-drop (pointer **and** keyboard) | ✅ [New] |
| 5.6 | Per-part, per-channel counters measured on rendered text | ✅ [New] |
| 5.7 | Previews: X, LinkedIn (+ Page), Facebook, Instagram, YouTube, TikTok, Pinterest, generic | ✅ [New] |
| 5.8 | Overflow marked in place; feed folds ("…see more") reproduced | ✅ [New] |
| 5.9 | Queue blockers listed per channel before any request | ✅ [New] |
| 5.10 | Saved posts sheet (drafts + queued) | ✅ [New] |
| 5.11 | Stale-save conflict shown with a Reload action | ✅ [New] |
| 5.12 | Media library page: upload with progress + compression result, search, type filter, pages, delete with usage count | ✅ [New] |
| 5.13 | Media picker in the composer (library or fresh upload) | ✅ [New] |
| 5.14 | Unsaved-changes warning on close/reload; Ctrl/⌘+S saves | ✅ [New] |
| 5.15 | `buttonVariants` exported from `@postgear/ui` for links styled as buttons | ✅ [New] |

### 5.2 — why the editor is uncontrolled

Each part owns a TipTap instance keyed by a client-only id that travels with the
part. Content enters an editor only when it mounts — on create, copy or load —
and is never pushed back while mounted. Pushing on every keystroke is the
classic cause of a cursor jumping to the end; keying by position would hand one
part's editor and undo history to another part's text on every drag.

### 5.7 — previews render the post, not the editor

Every preview shows `renderPlainText` output as text: styled Unicode bold,
list bullets, links expanded to `words (url)`. Threads are drawn the way each
platform publishes them — a reply chain on X, the post plus comments on
LinkedIn, Facebook and Instagram, and only part 1 on YouTube, TikTok and
Pinterest with a note saying so.

### 5.9 — what happens on "Add to queue"

The composer runs the same validator the API will and lists every blocker at
once, labelled by channel. The API still decides; if it disagrees, its message
is shown.

**How to test in the browser:** sign in as `demo@postgear.local`, open
**Composer**, pick all three channels, and type a line. Then:

- the **Instagram** preview tab shows a red issue count until an image is added;
- **Media → Upload** a large photo from the picker: the row reports
  "Compressed 9.7 MB → 692 KB" or similar, and it attaches;
- **Add to thread** twice, reorder with the arrows or by dragging the handle
  (Space, arrow keys, Space works too), and watch the X preview reorder;
- open the **Acme Marketing** tab → **Customize**, change the text, and the
  preview follows the tab;
- **Save draft**, reload the page: everything comes back; **Saved posts** lists it.

### 5.3 — reconnect-needed channels can be queued to

The API and the composer draw the same line: a channel still being set up has
nowhere to post and cannot be queued to; a channel needing reconnection can be,
because it can be fixed before the post is due. The picker warns, with a link to
Channels.

---

## 6. Tests

| # | Item | Status |
|---|---|---|
| 6.1 | 64 composer tests (document, render, length, validate) | ✅ [New] |
| 6.2 | 12 provider tests (rules equivalence, X premium/CJK, LinkedIn images, Instagram rules) | ✅ [New] |
| 6.3 | 46 media tests (sniffing, real `sharp` pipeline, storage, service) | ✅ [New] |
| 6.4 | 48 posts tests (schema, state, repository, service) | ✅ [New] |
| 6.5 | 16 web tests — composer reducer, payload, reports (first tests in `apps/web`) | ✅ [New] |
| 6.6 | 6 Playwright composer journeys + 2 media journeys | ✅ [New] |
| 6.7 | Everything from Sprints 0–3 still green | ✅ [Pre-existing] |

```bash
npm run validate
```

Expect `Tasks: 28 successful, 28 total`, now covering **377 unit tests**
(214 API + 121 social-core + 26 crypto + 16 web), up from 191.

```bash
docker compose up -d && npm run db:seed
npm run dev:api:e2e      # :e2e — relaxed login throttles
npm run test:e2e
```

Expect **42 passed**, up from 34. The new specs clean up after themselves
through the API — posts and media, including the uploaded files.

`next build` also succeeds, which is the check that the composer's
`@postgear/social-core/composer` alias bundles for the browser without pulling
in `node:crypto`.

---

## 7. Bugs found during verification, and fixed

Each of these passed every unit test and failed only when exercised for real:

1. **Every upload was refused with "Too many parts".** Busboy signals its
   `parts` limit when the count *reaches* it, and Multer treats that as an error,
   so `parts: 1` rejected the one file it was meant to allow. The limit is gone;
   `files: 1` and `fields: 0` bound the request, and both were re-verified.
2. **A React hydration mismatch on every composer load.** dnd-kit numbers its
   `aria-describedby` ids from a module-level counter that differs between the
   server render and the browser. `DndContext` now gets a React `useId()`.
3. **A long post's overflow mark was hidden behind "…see more".** Previews no
   longer fold text that is over the limit.
4. **The preview did not follow the channel being edited.** Opening a channel's
   tab now previews that channel.

---

## Known gaps

**1. Nothing is published yet.** "Add to queue" sets `QUEUE` and stops; Sprint 5's
scheduler reads the queue. Everything the publisher needs is in place — rendered
text from `renderPlainText`, media descriptors with type, size and dimensions,
rules enforced by `checkValidity` — but no post has reached a real platform,
because no developer app is registered (Sprint 3's gap 1).

**2. LinkedIn image upload is implemented, not proven.** It follows LinkedIn's
Images API and the reference's production code and is pinned by unit tests, but
it has never run against LinkedIn. Test it first once a LinkedIn app exists.

**3. Local storage cannot publish media to four platforms.** Instagram, Facebook,
Pinterest and TikTok fetch media from its URL themselves, which `localhost`
cannot serve them. Use a tunnel for testing or `STORAGE_PROVIDER=s3` with a
public bucket; TikTok additionally requires a verified domain. See
[docs/social-platform-setup.md](../social-platform-setup.md#media-has-to-be-reachable-from-the-internet-too-sprint-4).

**4. Video is stored, not processed.** No transcoding, no poster frames, no
dimension probing. LinkedIn and Pinterest video are declared unsupported
(section 2). HEIC photos and WebM video are refused with an explanation rather
than converted.

**5. One compressed master, not per-platform variants.** Every image is stored
once, fitted to 2048 px. The PRD's P1 "resize for each platform's
requirements" would add variants; today, platform shape rules are *validated*
(Instagram's 4:5–1.91:1) rather than auto-cropped.

**6. Provider-specific options are not in the composer.** A YouTube title
comes from the first line and privacy defaults to public; Pinterest links and
TikTok privacy use defaults. The providers already read these from
`Post.settings`; the composer has no fields for them yet.

**7. P1/P2 composer features not built:** @mention autocomplete, emoji picker,
tags, signatures, content sets, auto-split into a thread.

**8. X Premium limits.** The composer validates X at 280. A Premium account's
higher limit exists in the provider (`maxLength({ premium: true })`) but nothing
records which accounts are Premium.

**9. The X counter's one under-count.** A bare domain on an uncommon generic TLD
(`acme.photography` is listed; `acme.lawyer` is not), written without `https://`
and shorter than 23 characters, counts as its real length where X counts 23.

**10. Deleting media is immediate for unpublished posts.** The confirmation
states how many drafts and queued posts use the file, and those posts then show
the attachment as removed. There is no undo.

**11. No upload quotas.** Storage per workspace is unbounded until Sprint 8's
billing limits exist.

**12. In-app navigation does not warn about unsaved changes.** Closing the tab or
reloading does; clicking a sidebar link does not, because the App Router has no
blocking navigation API.

**13. Customization is per channel, not per part.** A channel either follows the
whole shared thread or has its own whole thread.

**14. The E2E suite is still not in CI** — unchanged from Sprint 2.

---

## Files changed in this pass

**Added — `packages/social-core`**
- `src/composer/{document,render,length,rules,unicode,validate,index}.ts` (+ four test files)
- `src/abstract/validity.ts`

**Added — API**
- `src/modules/media/{media.module,media.controller,media.service,media.repository,media.messages,file-type,image-processor}.ts`, `dto/media.schema.ts`
- `src/modules/media/storage/{storage.interface,storage-keys,local.storage,s3.storage,storage.factory}.ts`
- `src/modules/posts/{posts.module,posts.controller,posts.service,posts.repository,posts.messages,post-state}.ts`, `dto/posts.schema.ts`
- Tests: `file-type`, `image-processor`, `media.service`, `storage`, `posts.schema`, `post-state`, `posts.repository`, `posts.service`

**Added — web**
- `src/components/composer/{composer,composer-state,channel-report,channel-picker,editor,thread-editor,media-picker-dialog,preview-panel,drafts-sheet}.tsx|ts` (+ `composer-state.test.ts`)
- `src/components/previews/{x,linkedin,facebook,instagram,youtube,tiktok,pinterest,generic}.preview.tsx`, `channel-preview.tsx`, `comment-list.tsx`, `preview-parts.tsx`
- `src/components/media/{media-library,media-tile,media-uploader,delete-media-dialog,use-media-list,media-limits}.tsx|ts`
- `src/types/{post,media}.ts`

**Added — database, tests & docs**
- `packages/db/prisma/migrations/20260914074756_sprint4_media_metadata/`
- `e2e/composer.spec.ts`, `e2e/media.spec.ts`, `e2e/helpers/media.ts`
- this file

**Modified**
- `packages/social-core` — all eight providers declare `rules`; LinkedIn uploads images; `MediaDescriptor` gains `mimeType`/`bytes`/`width`/`height`; the registry lists rules
- `packages/db/prisma/schema.prisma` — `Media.mimeType`, `width`, `height`; `seeds/index.ts` — Instagram channel
- `apps/api/src/config/env.ts` — storage variables, S3 settings required together
- `apps/api/src/main.ts` — 1 MB JSON limit, `/uploads` static route
- `apps/api/src/app.module.ts` — `MediaModule`, `PostsModule`; `security-logger.ts` — two events
- `apps/web` — composer and media pages, `lib/api.ts` (`PUT`, `uploadFile`), `types/channel.ts`, `globals.css` (editor styles), tsconfig/next/jest config for the composer alias
- `packages/ui/src/components/button.tsx` — export `buttonVariants`
- `.env.example`, `.gitignore`, `project_structure.md`, `packages/db/prisma/SCHEMA_NOTES.md`, `docs/social-platform-setup.md`, the Sprint 4 document
- Dependencies: API — `sharp`, `@aws-sdk/client-s3`, `multer` (was transitive), `@types/multer`; web — `@tiptap/{react,pm,core,starter-kit,extensions}`, `@dnd-kit/{core,sortable,utilities}`, `@postgear/social-core`
