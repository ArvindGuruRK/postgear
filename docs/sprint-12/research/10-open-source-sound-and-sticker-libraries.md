# Sprint 12 Research: The Open-Source Sound And Sticker Libraries

> **Written**: 2026-11-17. This is not legal advice. It is the engineering reading of each source's own pages and API, and a design for the catalogue and the ingest that those readings allow. It replaces the small bundled packs and the Klipy search in Modules 12 and 14, as the decision brief asks (D5 and D6).
> **Rule of the file**: an item goes into the catalogue only if its licence is CC0, public domain, or a permissive licence we can credit on a page, and only if we can show the evidence. Where a licence or a site's terms are unclear, the file says so and the call is **exclude**.

## 1. The Short Answer

- **There is a real, safe catalogue to build, but it has two speeds.** A first tier needs nobody's permission: PostGear's own sounds and art, Kenney's CC0 packs, Noto animated emoji (CC BY 4.0), Open Peeps (CC0) and hand-picked OpenGameArt CC0 files. A second tier is large (Freesound alone shows 386,395 CC0 sounds) but sits behind the terms of two services (Openverse and Freesound) that ask for written permission for commercial use. We start the emails now and build the ingest so the second tier plugs in later without new code.
- **Realistic launch size**: about 650 sound effects and 150 music tracks without any permission; about 1,000 sound effects with it. About 1,600 stickers, of which 881 animated (section 11).
- **Honest gap**: the catalogue has no film, TV, meme or pop-culture GIFs. Those are copyrighted clips, so no open source holds them. Giphy and Klipy are far bigger because they host exactly that. Our catalogue is emoji, shapes, our own reaction art and cartoon sets. Openverse found only 2 CC0 or public-domain GIFs for "emoji" and 9 for "reaction" (section 4.4).
- **Music is the thin part.** CC0 music that sounds like a finished song is rare. Jamendo returned zero CC0 or public-domain tracks (section 3.2). Plan on short loops and jingles, not a song catalogue.
- **StreamLadder's own sound list shows the trap**: its Audio screen lists "Nintendo Switch Click" and "Windows 10 Notification" ([`streamladder/09`](../../screenshots/streamladder/09-clip-editor-audio-sound-effects-music.png)). Those are other companies' sounds. Our guard refuses items named after brands and products (section 8.3).

## 2. How This Was Checked

- Pages and docs were fetched on 2026-11-17. Where a page would not load for our reader (Musopen returned 403, OpenGameArt's FAQ returned 403, Internet Archive's terms page was empty) the line says **(reported)** and the call is the cautious one.
- The Openverse API was called anonymously about 25 times with a generic client name, small page sizes only. Its response headers showed the real limits (section 3.2). Nothing large was downloaded. One Noto emoji (a 369 KB WebP and a 836 KB GIF) and one 2 second generated tone were used to test the conversion steps with FFmpeg 9.0.2 on this machine.

## 3. Sound And Music Sources

### 3.1 Verdict Table

| Source | Licence and terms, as read | Verdict |
|---|---|---|
| PostGear's own sounds, made with FFmpeg (tones, noise, filtered sweeps) | Ours, CC0 by our own choice | **Pick** |
| Kenney audio packs (8 sound packs, 595 files, plus 90 voice files) | CC0 (kenney.nl/support, verified 2026-11-17) | **Pick** |
| Openverse audio API (indexes Freesound, Wikimedia Commons, Jamendo) | Metadata only; licence filter works; terms ask us not to scrape and reserve fees for commercial use (docs.openverse.org/terms_of_service.html, verified 2026-11-17) | **Pick, optional**, after a written OK |
| OpenGameArt, CC0 items chosen by hand | CC0 per item; no official API (opengameart.org/content/faq, reported via search) | **Pick, optional** (manual only) |
| Freesound API (CC0 filter) | CC0 sounds are free to use; the API's commercial use is "negotiated on a case by case basis" (freesound.org/help/tos_api, verified 2026-11-17) | **Later**, needs UPF's answer |
| Internet Archive public-domain audio | Rights are stated per item; terms page would not load | **Later**, per curated collection |
| Musopen public-domain recordings | Reported public domain; sources disagree on direct sale and credit; page returned 403 | **Later**, exclude until read |
| Free Music Archive | Artist chooses the licence, NC and the retired FMA-Limited exist (freemusicarchive.org/faq, verified 2026-11-17) | **Later**, CC0 filter only, API unread |
| ccMixter | Per-track licence; terms forbid using a track to promote anyone but yourself (ccmixter.org/terms, verified 2026-11-17) | **Reject** |
| Jamendo | Free API is for non-commercial use only; commercial needs a quote (devportal.jamendo.com/api_terms_of_use, reported); Openverse found 0 CC0 or PDM tracks from it | **Reject** |
| Pixabay | "You cannot sell or distribute Content [...] on a Standalone basis" (pixabay.com/service/license-summary, verified 2026-11-17) | **Reject** |
| Mixkit | A separate licence per item type; the text did not load; reported to forbid redistribution (mixkit.co/license, reported) | **Reject** |
| YouTube Audio Library | Grants nothing for use inside another product (support.google.com/youtube/answer/3376882, verified 2026-11-14 in file 07) | **Reject** |
| Sonniss GDC bundles | Commercial use fine, but no resale or redistribution "inside a sound library, sample pack, asset pack or anything similar" (sonniss.com/gameaudiogdc, verified 2026-11-17) | **Reject** |

### 3.2 Openverse, In Detail

- **What it is**: a search index of open media. It does not host the files (Freesound, Wikimedia Commons and Jamendo do). Audio sources and sizes: Jamendo 644,709, Wikimedia Commons 3,986,828, Freesound 591,898 records (api.openverse.org/v1/audio/stats, verified 2026-11-17).
- **Licence filter**: `license=cc0,pdm` and `license_type=commercial` both work. Allowed `license` values: `by, by-nc, by-nc-nd, by-nc-sa, by-nd, by-sa, cc0, nc-sampling+, pdm, sampling+`. Use `license=cc0,pdm`, never `license_type=commercial` alone, because that also lets CC BY and CC BY-SA through (API schema at api.openverse.org/v1/schema, verified 2026-11-17).
- **What the filter returned**: `license=cc0,pdm` gave results from Freesound and Wikimedia Commons only. `source=jamendo` with the same filter gave 0. The Wikimedia hits were mostly Lingualibre word pronunciations (category `pronunciation`), useless as sound effects, so the adapter excludes that source for audio.
- **A trap in the `category` filter**: `category` accepts `audiobook, music, news, podcast, pronunciation, sound_effect`, but Freesound items arrive with `category: null`, so `category=sound_effect&license=cc0,pdm` returned 0. We search by query words and `length` (`shortest, short, medium, long`), and classify by our own taxonomy.
- **Anonymous limits** (response headers, verified 2026-11-17): 20 requests a minute burst and 200 a day sustained; `page_size` may not exceed 20; a query shows at most 240 results. So one anonymous day reaches 4,000 records at best. Registered clients get "slightly higher limits" and may ask for more; the exact numbers are not on the docs page (api.openverse.org/v1 tag auth, verified 2026-11-17). Registration is `POST /v1/auth_tokens/register/` then `POST /v1/auth_tokens/token/`; the contact address on the throttling page is `openverse@wordpress.org`.
- **Fields returned** (checked on a real "whoosh" result): `id, title, creator, creator_url, license, license_version, license_url, source, foreign_landing_url, url, filetype, filesize, duration (ms), bit_rate, sample_rate, tags[], genres, category, audio_set, mature, attribution, alt_files[], waveform, indexed_on`. This is enough licence evidence for our record.
- **Downloading and storing**: the `url` for a Freesound item points to Freesound's own 128 kbps MP3 preview on `cdn.freesound.org` (the example was 69 KB for a 3.2 second sound). The original WAV is in `alt_files` at `freesound.org/apiv2/sounds/<id>/download/`, which needs a Freesound login (section 3.3). So an Openverse ingest stores a lossy preview and re-encodes it to AAC. For short effects the loss is small; say so in the licence report.
- **Terms**: "You must not scrape the content in the Openverse catalog"; "You must not use multiple machines to circumvent rate limits"; "Openverse reserves the right to charge fees for commercial uses"; an app built on the API must say it was made with Openverse and is not endorsed by it; and Openverse "does not verify its licensing status or make any representations or warranties" (docs.openverse.org/terms_of_service.html, effective 2022-05-05, verified 2026-11-17).
- **Reading of those terms**: a few hundred curated, query-driven fetches by an operator is ordinary API use, not scraping. A bulk walk of the whole index is scraping. We cap each run (`--limit 200`), register a client, send one request at a time, and write to `openverse@wordpress.org` before the first production run. **Ambiguity**: whether PostGear counts as a "commercial use" that may be charged. Until they answer, Openverse is **Pick, optional**, off by default (`CLIPS_INGEST_OPENVERSE_OK`).

### 3.3 Freesound

- **API key or OAuth**: a token (API key) is enough to search and read metadata; downloading the original file at `/apiv2/sounds/<id>/download/` "requires OAuth2". Previews come in four forms, `preview-hq-mp3` about 128 kbps, `preview-lq-mp3` 64 kbps, `preview-hq-ogg` 192 kbps, `preview-lq-ogg` 80 kbps (freesound.org/docs/api/resources_apiv2.html, verified 2026-11-17). Search takes `filter=license:"Creative Commons 0"`, `duration:[0 TO 10]`, `type:wav`; `page_size` up to 150. Limits are a per-minute burst and a per-day sustained figure, shown by `/apiv2/usage/`, applied per user.
- **The CC0 sounds themselves**: "you can do pretty much what you want with the sound. You could even sell the sound" (freesound.org/help/faq, verified 2026-11-17). The search page shows 386,395 CC0 sounds (verified 2026-11-17).
- **The API terms are the gate**: "Terms for commercial use of the API will be negotiated on a case by case basis with UPF"; "Do not make full copies of the database"; the user may not "use robots, spiders, scraping" or "distribute, publish, or allow access or linking to the Freesound API or Content" (freesound.org/help/tos_api, no date shown, verified 2026-11-17). Taking copies of CC0 sounds into our storage is a copyright question (CC0 allows it) and an API-terms question (needs UPF's say). **Ambiguity**: the free key may be non-commercial. Exclude until UPF replies in writing. Freesound's FAQ also admits the risk: users "are required to follow the rules and not upload any copyrighted material", with only a "Flag it!" link to report a problem. That is why our guard still screens CC0 items (section 8.3).

### 3.4 Kenney, OpenGameArt And The Rest

- **Kenney**: "all game assets on the asset pages are public domain licensed (CC0)", "free to use [...] even in commercial projects", credit not required; asks that the "Kenney" logo is not used separately (kenney.nl/support, verified 2026-11-17). Pack pages show the CC0 licence and file counts (verified 2026-11-17): Impact Sounds 130, Interface Sounds 100, RPG Audio 85, Sci-fi Sounds 70, Digital Audio 60, UI Audio 50, Music Jingles 50, Casino Audio 50 (total 595), Voiceover Pack 90. Formats were not stated on the pages. The operator downloads each zip by hand (not a bulk crawl) and the adapter reads the pack's own `License.txt` and refuses the pack if it does not say CC0.
- **OpenGameArt**: its FAQ (read through search, the page returned 403) says art may be used commercially if the licence is followed, asks for a link back even for CC0, and warns that CC-BY-SA and GPL derivatives carry conditions. There is no official API and no stated scraping rule, so we use it only by hand: the operator lists page addresses in a JSON file, the adapter checks the file, and the operator confirms the licence line on the page before each item. CC0 only; CC-BY, CC-BY-SA, GPL and OGA-BY are refused.
- **Internet Archive, Musopen, FMA**: see the table. All three have licences that differ item by item or track by track. A recording can be public domain in the United States and not in the EU, which matters for a product sold worldwide. They stay **Later**, one curated collection at a time, with a written check of each.

## 4. Sticker And GIF Sources

### 4.1 Verdict Table

| Source | Licence and terms, as read | Verdict |
|---|---|---|
| PostGear's own art (arrows, shapes, reaction words, simple animated pops) | Ours | **Pick** |
| Noto animated emoji (881 emoji) | CC BY 4.0 (developers.googleblog.com, verified 2026-11-17) | **Pick**, with the credit |
| Kenney Emotes Pack (480 files) and other Kenney 2D packs | CC0 (kenney.nl/assets/emotes-pack, verified 2026-11-17) | **Pick** |
| Open Peeps (about 93 ready-made, SVG and PNG) | CC0, "even for commercial purposes, without asking permission" (openpeeps.com, verified 2026-11-17) | **Pick, optional** |
| Openverse images, `extension=gif`, `license=cc0,pdm` | Per item; tiny usable yield; same Openverse terms as 3.2 | **Pick, optional**, after the OK |
| Noto static emoji images | Apache-2.0 for "most image resources" (github.com/googlefonts/noto-emoji, verified 2026-11-17) | **Later** |
| Twemoji (jdecked fork), static | Graphics CC-BY 4.0, code MIT; a README mention is enough credit (github.com/jdecked/twemoji, verified 2026-11-17) | **Later** |
| Fluent Emoji (Microsoft) | MIT (GitHub licence field, verified 2026-11-17); formats 3D, colour, flat, high contrast (reported) | **Later** |
| Wikimedia Commons animated GIFs | Licence per file (CC BY, CC BY-SA, GFDL, public domain), "no warranty" (commons.wikimedia.org, verified 2026-11-17) | **Later**, only through the CC0 or PDM Openverse filter |
| OpenMoji | CC BY-SA 4.0 (github.com/hfg-gmuend/openmoji, verified 2026-11-17) | **Reject** |
| LottieFiles free animations | "Lottie Simple License" (lottiefiles.com/page/license, verified 2026-11-17) | **Reject** |
| Tenor | API shut down 2026-06-30, no new keys since 2026-01-13 (news reports, reported) | **Reject** |
| Giphy | "Do not cache media URLs or copies of GIPHY media assets" without written approval; "Powered by GIPHY" required (developers.giphy.com best practices, reported) | **Reject** |
| Klipy | Consumer terms allow "personal and non-commercial" use; API terms unread (file 07, verified 2026-11-14) | **Reject** |

### 4.2 Noto Animated Emoji

- **Count and formats**: the collection's own index, `googlefonts.github.io/noto-emoji-animation/data/api.json`, lists 881 emoji with codepoint, categories (for example "Smileys and emotions") and tags (for example `:smile:`) (verified 2026-11-17). Files are on Google's CDN: `https://fonts.gstatic.com/s/e/notoemoji/latest/<codepoint>/lottie.json`, `.../512.gif`, `.../512.webp`, and `.../emoji.svg` (all four returned 200 for `1f600` on 2026-11-17). Sizes for that one emoji: Lottie 37 KB, WebP 369 KB, GIF 836 KB, all 512 x 512.
- **Licence**: "The artwork is available under the CC BY 4.0 license" (Google Developers Blog, 2022-09, verified 2026-11-17). The blog does not say whether we may host the files ourselves; CC BY 4.0 itself allows sharing copies (section 3 of the legal code). **Ambiguity, small**: we host our own converted copies and credit Google. Recommend yes.
- **What CC BY 4.0 asks for** (creativecommons.org/licenses/by/4.0/legalcode.en, verified 2026-11-17): credit, a link to the licence, a note that we changed the files, and no extra terms on users that stop them using the material. Section 3(a)(2) says attribution may be given "in any reasonable manner based on the medium, means, and context", for example "a URI or hyperlink to a resource" with the information. A credits page is that resource. If Google asks, we must remove the credit details where practicable.
- **Converting to APNG** (tested with FFmpeg 9.0.2 today): the animated WebP decodes (codec `webp_anim`) and writes APNG with `rgba` and full alpha. At 512 px and the source's 33 fps the APNG was 2.97 MB. At 256 px and 20 fps (`-vf "fps=20,scale=256:256:flags=lanczos" -plays 0 -f apng`) it was 1.28 MB for 42 frames. The GIF input also converts (4.2 MB at full size) but a GIF has 1-bit transparency, so use the WebP. FFmpeg cannot read the Lottie JSON. 881 stickers at about 1.3 MB is about 1.1 GB, which is fine for the public bucket.

### 4.3 The Other Art Sets

- **Kenney**: the Emotes Pack has 480 files under CC0; the page did not say the format or whether they animate, so treat them as static until the first ingest checks. Other 2D packs (Input Prompts, Flag Pack and so on) are CC0 and useful for Arrows And Shapes; their counts were not shown (reported).
- **OpenMoji**: CC BY-SA 4.0 requires the licence of "Adapted Material" to be BY-SA. CC's own text does not say whether placing an emoji in a video is an adaptation ("the text doesn't say whether the result is Adapted Material", legal code, verified 2026-11-17). If it were, every user's exported video would have to be BY-SA. That risk is too big for a paid product. **Excluded.**

### 4.4 Openverse Images And Commons GIFs

A `q=sticker` search with `license=cc0,pdm` and `extension=gif` found 26 results; `q=emoji` found 2 and `q=reaction` found 9 (api.openverse.org/v1/images, verified 2026-11-17). The first hit was a 9.5 MB GIF of a clay-hardness test from Wikimedia Commons: real, but not a sticker, and over our size cap. Keep the adapter so an operator can pull a handful by hand, and do not count on it for volume.

### 4.5 Why Not Lottie Libraries

LottieFiles' licence says distributed Files "must contain (and be subject to) the same terms" and excludes collecting Files "to replicate or develop a similar" service (lottiefiles.com/page/license, verified 2026-11-17). A sticker library built from their files is the case it fences off. **Excluded.** The Noto Lottie files come from Google's CDN under CC BY, and we do not use Lottie at runtime anyway (decision D2).

## 5. The Licence Allow-List

The guard works on a normalised code, checked against two lists: what the kind may carry and what the source adapter may carry. An item must pass both.

| Code | Meaning | Sounds | Stickers | Credit needed |
|---|---|---|---|---|
| `OWN` | Made by PostGear | yes | yes | no |
| `CC0-1.0` | CC0 1.0 | yes | yes | no (courtesy line) |
| `PDM-1.0` | Public Domain Mark | yes | yes | no (courtesy line) |
| `CC-BY-4.0` | Attribution | **no** | yes | yes, on the credits page |
| `MIT`, `Apache-2.0` | Permissive licence on art | no | yes | notice on the credits page |

- **Why sounds never take CC BY**: a credit cannot ride along inside a sound in a finished video, and file 07 reached the same call. Stickers are visible and come from a few named collections, so one credits page works.
- **Always refused**: anything NC, ND, SA, GPL, "sampling+", "royalty free" without a stated licence, "free for personal use", "all rights reserved", unknown, and any item whose licence text we cannot fetch or whose `license_url` does not point at creativecommons.org (for CC) or the source's own licence file.

## 6. The Data Model

Names follow the existing `Clip*` models. Ids are `uuid()` like the rest of the schema. Prisma cannot declare a generated `tsvector` column, so the migration holds raw SQL for it.

```prisma
enum ClipSoundKind    { SFX MUSIC }
enum ClipStickerKind  { STATIC ANIMATED }
enum ClipLibraryStatus { STAGED ACTIVE HIDDEN REMOVED }   // STAGED = ingested, not yet published

model ClipLibrarySource {              // one row per collection that shares a credit
  id            String  @id @default(uuid())
  code          String  @unique      // "noto-animated", "kenney-impact-sounds", "own"
  name          String               // "Noto Emoji Animation"
  author        String               // "Google"
  url           String
  licence       String               // CC-BY-4.0
  licenceUrl    String
  creditLine    String?              // the exact words for the credits page
  changeNote    String?              // "Resized and converted to APNG"
  noticeText    String?              // MIT or Apache notice, when required
  requiresCredit Boolean @default(false)
  creditPerItem Boolean @default(false)  // list each author (several creators in one source)
}

model ClipSound {
  id            String   @id @default(uuid())
  sourceId      String                         // ClipLibrarySource
  kind          ClipSoundKind
  name          String
  tags          String[]
  category      String                         // taxonomy slug, section 9
  durationMs    Int
  bpm           Int?                           // music, optional
  loudnessLufs  Float                          // measured, after normalising
  truePeakDb    Float
  peaks         Json                           // 100 integers 0 to 255 for the row waveform
  fileKey       String   @unique               // library/sounds/ab/<sha256>.m4a
  bytes         Int
  featured      Int      @default(0)
  // licence evidence
  licence       String                         // allow-list code
  licenceUrl    String
  author        String
  authorUrl     String?
  origin        String                         // openverse, kenney, opengameart, own
  originId      String?                        // the id at the origin
  sourceUrl     String                         // the item's own page
  originalWork  Boolean                        // the adapter judged this an original work
  retrievedAt   DateTime
  sourceChecksum String  @unique               // sha256 of the downloaded file (dedupe)
  runId         String                         // ClipLibraryRun
  status        ClipLibraryStatus @default(STAGED)
  statusReason  String?
  statusById    String?
  statusAt      DateTime?
  createdAt     DateTime @default(now())
  search        Unsupported("tsvector")?       // generated, see section 7
  @@unique([origin, originId])
  @@index([kind, category, status])
  @@index([search], type: Gin)
}

model ClipSticker {
  id            String   @id @default(uuid())
  sourceId      String
  kind          ClipStickerKind
  name          String
  tags          String[]
  category      String
  width         Int
  height        Int
  durationMs    Int?                           // animated only
  frames        Int?
  fps           Int?
  fileKey       String   @unique               // library/stickers/ab/<sha256>.apng or .png
  previewKey    String?                        // library/previews/ab/<sha256>.webp, 128 px, for the grid
  bytes         Int
  featured      Int      @default(0)
  licence String; licenceUrl String; author String; authorUrl String?   // as ClipSound
  origin String; originId String?; sourceUrl String; retrievedAt DateTime
  sourceChecksum String @unique
  runId String
  status        ClipLibraryStatus @default(STAGED)
  statusReason String?; statusById String?; statusAt DateTime?
  createdAt     DateTime @default(now())
  search        Unsupported("tsvector")?
  @@unique([origin, originId])
  @@index([kind, category, status])
  @@index([search], type: Gin)
}

model ClipFavourite {                  // per workspace, as the brief says
  id             String   @id @default(uuid())
  organizationId String
  soundId        String?
  stickerId      String?
  createdById    String
  createdAt      DateTime @default(now())
  @@unique([organizationId, soundId])
  @@unique([organizationId, stickerId])
  @@index([organizationId, createdAt])   // migration adds CHECK ((soundId IS NULL) <> (stickerId IS NULL))
}

model ClipLibraryRun {                 // one ingest run and its licence report
  id String @id @default(uuid()); origin String; args Json
  startedAt DateTime @default(now()); finishedAt DateTime?
  accepted Int @default(0); rejected Int @default(0)
  rejectionsByReason Json?             // { licence_not_allowed: 41, brand_name: 6, ... }
  reportKey String?                    // the Markdown and JSON report in the private bucket
}

model ClipLibraryDeny {                // a removed item cannot come back
  id String @id @default(uuid()); sourceChecksum String? @unique
  origin String?; originId String?; reason String; createdAt DateTime @default(now())
  @@unique([origin, originId])
}

model ClipLibraryMiss { term String; kind String; count Int @default(1); lastAt DateTime @updatedAt; @@id([term, kind]) }  // searches with no result
```

- **User uploads stay out of these tables.** They remain `ClipAsset` rows of kind `AUDIO` or `STICKER` in the private space, shown in the **Uploaded** tab (one `ClipAsset` already carries `organizationId`, `key`, `bytes`, `meta`). Add `meta.name` and `meta.tags` there. A clip item points to `{ library: 'sound', id }` or `{ asset: 'asset id' }`, never mixes the two. Upload limit: 20 MB for sounds and 8 MB for stickers, a little above StreamLadder's 5 MB, checked by real bytes as Module 14 already does.
- **Status meaning**: `STAGED` (just ingested, invisible), `ACTIVE` (listed), `HIDDEN` (not listed, existing clips keep working), `REMOVED` (files deleted, a clip that uses it shows a notice and the export asks before dropping it).

## 7. Search

A generated column and two indexes, written by hand in the migration (the `prisma-change` skill covers the steps):

```sql
ALTER TABLE "ClipSound" ADD COLUMN search tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', coalesce(name,'')), 'A') ||
  setweight(to_tsvector('simple', array_to_string(tags,' ')), 'B') ||
  setweight(to_tsvector('simple', coalesce(category,'')), 'C')) STORED;
CREATE INDEX "ClipSound_search_idx" ON "ClipSound" USING GIN (search);
CREATE EXTENSION IF NOT EXISTS pg_trgm;                       -- optional
CREATE INDEX "ClipSound_name_trgm" ON "ClipSound" USING GIN (name gin_trgm_ops);
```

- Use the `simple` configuration, not `english`, so tags and non-English names are not stemmed away. The query reuses `apps/api/src/common/search-terms.ts` to clean the words, then `websearch_to_tsquery('simple', q)` with a prefix match on the last word (`word:*`) so typing "woo" finds "whoosh". Order: `ts_rank_cd` descending, then `featured` descending, then `name`.
- With no `q`, the list is `featured desc, name`, filtered by `kind`, `category` and `status = ACTIVE`.
- Trigram is optional (turn on if people mistype; `pg_trgm` is trusted on Postgres 13 and later). `ClipSticker` gets the same columns and indexes.

## 8. The Ingest

### 8.1 The Command

```
npm run clips:library:ingest -- --source openverse --query "whoosh" --kind sfx --limit 200
npm run clips:library:ingest -- --source kenney --path D:/imports/kenney-impact-sounds --kind sfx
npm run clips:library:ingest -- --source noto-animated --kind animated-sticker
npm run clips:library:publish -- --run <runId>        # STAGED to ACTIVE after review
npm run clips:library:remove  -- --id <id> --reason "..."
```

- It lives in `apps/worker/src/scripts/` because the worker image already holds FFmpeg, and it runs on the media worker box with the production database and bucket. It is **operator only**: no API route accepts a source address, and it refuses to start unless `CLIPS_LIBRARY_INGEST=true` is set in that shell. Users never trigger it.
- Flags: `--dry-run` (everything except writing), `--category`, `--min-ms`, `--max-ms`, `--limit`. Operator routes (hide, remove, list runs) sit on Module 19's SUPERADMIN screen and call the same service.

- Source adapters: `own` (repo folder plus `licences.json`), `kenney` (an unzipped pack), `openverse`, `noto-animated` (the `api.json` index and CDN pattern), `opengameart` (a hand-made list), `open-peeps`. Each returns candidates as `{ name, tags, creator, creatorUrl, licenceRaw, licenceUrl, sourceUrl, originId, downloadUrl or path, mature }`.

### 8.2 The Steps

1. **Fetch** through the safe fetcher (`fetchBinarySafely` in `packages/seo-engine/src/crawler/safe-fetch.ts`): size cap (audio 12 MB, sticker 6 MB), timeout, no private addresses, one request at a time, a generic User-Agent. Sniff the real type, then `ffprobe` to confirm it decodes.
2. **Licence guard** (8.3) runs before any transcoding, so a refused item costs nothing.
3. **Dedupe**: sha256 of the downloaded bytes (`sourceChecksum`, unique) and the `(origin, originId)` pair. Items on `ClipLibraryDeny` are skipped.
4. **Normalise audio**: decode, mix to stereo (mono sources stay mono, duplicated at play time), resample to 48 kHz (the render's rate), trim silence at the start and the end (`silenceremove` start and stop, with `areverse` for the tail; filter present in FFmpeg 9.0.2), add a 5 ms fade in and out to avoid clicks, then measure with `ebur128`. Targets: music and ambient to about -16 LUFS integrated with a true peak of -1.5 dB; effects shorter than 3 seconds are peak-normalised to -3 dBFS because loudness is unreliable on very short sounds. The final export pass still runs `loudnorm` to about -14 LUFS (Module 14). Limits: effects 0.1 to 15 seconds, music 5 seconds to 10 minutes; outside that, rejected.
5. **Encode** to AAC-LC in `.m4a` at 128 kbps (a test tone encoded and normalised cleanly today with `silenceremove,loudnorm,libmp3lame`; the AAC step uses the same chain). One fixed format keeps the editor and the render simple. Strip tags (`-map_metadata -1`).
6. **Waveform**: 100 peak values (0 to 255) read from the decoded samples, stored in `peaks`. No image file. (`showwavespic` also exists if a picture is wanted.)
7. **Normalise stickers**: still images to PNG, longest side at most 512 px, at most 300 KB (SVG is rasterised first). Animated sources (WebP, GIF) go through FFmpeg to APNG: `fps=min(source,20)`, scale to 256 px for emoji-like items or 512 px as a ceiling, `-plays 0`, at most 6 seconds and 120 frames, at most 2 MB. If over, step down to 192 px and 15 fps once, then reject (`too_large`). A 128 px animated WebP is made for the grid preview. Metadata is stripped.
8. **Store** in the public media bucket under `library/`: `library/sounds/<first 2 hex>/<sha256>.m4a`, `library/stickers/<first 2 hex>/<sha256>.apng` or `.png`, `library/previews/<first 2 hex>/<sha256>.webp`. The key is the content hash, so files are immutable and cached for a year. Production uses the S3-compatible bucket (decision D3); development uses MinIO.
9. **Write** the row as `STAGED` with the full evidence (section 6) and the run id.
10. **Report**: a JSON and Markdown licence report in the private bucket, with one line per accepted item (name, licence, author, source address, retrieved date, checksum) and the counts of each rejection reason. The operator reads the sample (at least 20 items or 10 percent) and runs `clips:library:publish`, which flips the run's items to `ACTIVE`. The `own` and `kenney` adapters may use `--auto-publish`; Openverse and OpenGameArt never may.

### 8.3 The Licence Guard

The guard rejects, and records the reason code, when any of these is true:

- `licence_not_allowed`: the normalised code is not on the kind's list (section 5). Openverse's `license` plus `license_version` become `CC0-1.0`; `pdm` becomes `PDM-1.0`. The `license_url` must match, or the item is refused (`licence_url_mismatch`).
- `missing_metadata`: no title, no `sourceUrl`, no licence, or no creator (the own pack and Kenney carry a fixed creator in their manifest).
- `mature`: the source flags it mature or sensitive.
- `brand_name`: the title or tags hit a block list of company and product names and game, film and show names (the list starts with `nintendo, windows, mario, zelda, pokemon, minecraft, netflix, disney, marvel, apple, iphone, android, youtube, tiktok`; the operator extends it). This is what keeps "Windows 10 Notification" out.
- `derivative_signal`: title, tags or description contain `cover, remix, bootleg, ripped, rip, from the game, from the movie, theme from, ost, soundtrack, sample from, mashup, "by <artist>"` patterns. Combined with the next rule, this is how we meet the brief's "keep only items whose source metadata says original work".
- `not_original`: for Openverse and OpenGameArt the adapter sets `originalWork = true` only when the creator is a named individual account, the text has no derivative signal, and (for music) the item has a creator page. Items that fail go to the report as `needs_review`, not into the catalogue. Kenney and own items are original by construction.
- `no_category`: the tag and word mapping (section 9) cannot place it.
- `too_short_or_long`, `too_large`, `not_decodable`, `duplicate`, `denied`.

## 9. Categories And Tags

The first-level names match the StreamLadder chips. Slugs are kebab-case, names Title Case.

| Kind | Categories (name, slug) |
|---|---|
| Sound effects | Alerts And Notifications (`alerts`), Ambient Sounds (`ambient`), Reactions (`reactions`), Transitions (`transitions`), Gaming (`gaming`), Comedy (`comedy`), Impacts (`impacts`), Whooshes (`whooshes`) |
| Music | Calm (`calm`), Upbeat (`upbeat`), Tense (`tense`), Cinematic (`cinematic`), Lo-Fi (`lofi`), Epic (`epic`) |
| Stickers | Reactions (`reactions`), Arrows And Shapes (`arrows-shapes`), Social (`social`), Gaming (`gaming`), Animated Emoji (`animated-emoji`) |

- **Mapping**: a `taxonomy.ts` table in the ingest maps source words to a category (for example `whoosh, swoosh, swish, sweep` to `whooshes`; `hit, punch, slam, thud, crash` to `impacts`; `bell, ding, notification, alert, chime, click, ui, interface` to `alerts`; `rain, wind, crowd, forest, room tone` to `ambient`; `laugh, boing, honk, slip, cartoon` to `comedy`; `coin, jump, power-up, laser, 8-bit` to `gaming`; `riser, swipe, glitch, transition` to `transitions`). For Noto emoji, `api.json` categories map to `animated-emoji`, with the Noto category kept as a tag. Kenney's pack name is a strong hint: Impact Sounds to `impacts`, Interface Sounds and UI Audio to `alerts`, Sci-fi and Digital Audio to `gaming`, Voiceover to `gaming`, Music Jingles to `upbeat` or `cinematic` by tag.
- **Tags**: lowercase, deduplicated, at most 12, drawn from source tags plus the name's words; the guard strips brand words. Music also gets mood tags and an optional `bpm`.

## 10. The Credits Page

- **What must be shown** (CC BY 4.0, section 4.2): for each collection, the creator, a link to the work, the licence name with a link, and a note that we changed it. For Noto: "Animated emoji: Noto Emoji Animation by Google, CC BY 4.0 (link), resized and converted to APNG." Twemoji, when added: a mention of the project and the CC-BY 4.0 licence (the maintainers accept a README or About mention). MIT and Apache items: the copyright line and licence text from `noticeText`.
- **What is shown but not required**: CC0 sources, as a courtesy ("Sound packs by Kenney, CC0"). Not required, and we say so.
- **Generated, never hand-written**: `GET /clips/library/credits` (public, no login) reads `ClipLibrarySource` joined with a count of `ACTIVE` items, and prints the groups below. A source with `creditPerItem` lists each author and item. A source with no `ACTIVE` items is left off. The web page is `/credits/clips`, linked from the Audio and Elements panels ("Credits"), the app footer and the export panel.
- **Groups**: Attribution Required (stickers only), Notices (MIT, Apache), Public Domain And CC0 (courtesy), PostGear's Own.
- **In exported videos**: we do not burn credits in. Section 3(a)(2) lets a URI satisfy attribution, so the page is the reasonable manner for a catalogue. A helpful extra: Send To Composer can offer a caption line ("Emoji art: Noto Emoji by Google, CC BY 4.0") when a clip uses a CC BY sticker. **Needs a legal read**: whether the credit must travel with each exported video. Until then the line is offered and not forced.

## 11. Launch Volume And Growth

| Kind | No permission needed | With the Openverse and Freesound OKs | How |
|---|---|---|---|
| Sound effects | about 650 | about 1,000 | Kenney 595 plus 90 voice (about 450 kept after hiding clicks and silence), own about 80 made with FFmpeg, then about 40 per category from Openverse |
| Music | about 150 | about 250 | Kenney Music Jingles 50, about 60 CC0 loops and tracks picked by hand from OpenGameArt, about 12 own loops, then Freesound loops |
| Animated stickers | about 1,000 | about 1,050 | Noto 881, own pops about 60, Kenney animated pieces if any |
| Static stickers | about 600 | about 650 | Kenney Emotes 480, Open Peeps 93, own arrows, shapes and words about 120 |

- **The gap against Giphy, plainly**: Giphy and Klipy offer licensed film, TV and meme clips and are orders of magnitude larger (the exact counts were not verified). We offer about 1,600 stickers and no pop culture. That is a product difference to say in the Elements panel's empty states and the Credits page, not hide.
- **The gap in music**: 150 is a few hours of loops and jingles. A paid commercial licence that allows use inside a SaaS can be bought later and added through the same table (`licence: "COMMERCIAL"` is not on the allow-list yet, so it needs a decision first).
- **Seed at install**: the seed runs the `own`, `kenney` and `noto-animated` adapters with `--auto-publish` from a release bundle (no Openverse call). **Growth**: the operator runs one source and one category at a time, reviews, publishes. A realistic rhythm is a run a month adding 50 to 150 reviewed items, driven by `ClipLibraryMiss`. Noto updates are re-checked against `api.json` each quarter. Own art grows with the brand. Nothing grows by itself and nothing a user uploads enters the shared catalogue.

## 12. Takedown

1. A report arrives at `copyright@rkay.in` (decision D12-16), or an operator spots a problem.
2. **Hide** within the hour: `clips:library:remove --id <id> --hide`, or the Hide button on the Module 19 operator screen. The item leaves search at once. Clips that already use it keep working. `statusReason`, `statusById` and `statusAt` are written.
3. **Decide**: keep (set `ACTIVE`, note why) or remove.
4. **Remove**: status `REMOVED`, delete `fileKey` and `previewKey` from the public bucket, purge the CDN path, add the checksum and `(origin, originId)` to `ClipLibraryDeny`, keep the row and its evidence for the record.
5. **Affected clips**: a JSON containment query on the clip documents lists them. The editor shows "This sound was removed" on the item, and Export asks before dropping it, so a video never changes silently.
6. If the source changes its licence or the creator withdraws it (Freesound's FAQ says a licence change must come from the user), the same path applies to every item from that creator (`--creator`).

## 13. The Search API

All routes sit behind the default `JwtAuthGuard`; the workspace comes from `@CurrentOrg()`. Query strings use a strict Zod schema. Previews are public bucket addresses (immutable, so cacheable).

| Route | Query or body | Answer |
|---|---|---|
| `GET /clips/library/sounds` | `q`, `kind=sfx\|music`, `category`, `favourites=true`, `page` (default 1), `pageSize` (default 24, max 60) | `{ items, page, pageSize, total, hasMore }` |
| `GET /clips/library/stickers` | `q`, `kind=animated\|static`, `category`, `favourites=true`, `page`, `pageSize` | same shape |
| `GET /clips/library/categories` | `type=sound\|sticker`, `kind` | `[{ slug, name, count }]` for the chips |
| `PUT /clips/library/favourites` | `{ type, itemId }` | `{ favourite: true }` |
| `DELETE /clips/library/favourites/:type/:itemId` | none | `204` |
| `GET /clips/library/credits` | none, `@Public()` | the grouped credits (section 10) |

- A sound item: `{ id, name, kind, category, tags, durationMs, bpm, previewUrl, peaks, isFavourite, credit: null }`. A sticker item: `{ id, name, kind, category, tags, width, height, durationMs, previewUrl, fileUrl, isFavourite, credit }` with `credit` set only for CC BY items, so the panel can show a small "i".
- The query adds `status = 'ACTIVE'` always. `favourites=true` joins `ClipFavourite` for the caller's workspace.
- Throttle 60 requests a minute per workspace. Search with no matches returns an empty list plus a `suggest` array of the nearest categories, and records a `ClipLibraryMiss`.

## 14. Legal And Risk Notes

- **CC0 is a waiver by the person who uploaded the file.** If that person did not own the sound, the waiver means nothing. Freesound's own FAQ says uploads must not be copyrighted material and offers only a "Flag it!" link; Openverse says it "does not verify its licensing status"; Wikimedia says it gives "no warranty on copyright status or licence accuracy" (all verified 2026-11-17). So CC0 from an aggregator is a claim, not a clearance. The guard (section 8.3), the review sample and the takedown path are the control.
- **Sounds that match copyrighted works** (a game jingle, a song hook, a ringtone) can sit inside a CC0 dump. The ingest keeps only items whose source metadata supports "original work", drops brand and derivative words, never auto-publishes Openverse or OpenGameArt items, and the operator listens to the review sample. Kenney and our own sounds carry the least risk.
- **Music is higher risk than effects.** A track can contain a sample. Prefer instrument loops from a named individual; avoid anything described as a remix, cover or "inspired by".
- **CC BY credit for exported videos** is open (section 10). It touches only Noto animated emoji (and Twemoji later).
- **Third-party terms are not the same as copyright.** CC0 settles copyright. Openverse's and UPF's terms still govern how we may use their services. We ask in writing and wait.

## 15. Risks

| Risk | Likelihood | Effect | Handling |
|---|---|---|---|
| A CC0 sound turns out to be someone else's work | medium | A claim against a customer's video | Original-work guard, brand block list, reviewed sample, hide in an hour, remove, deny list |
| Openverse or UPF refuses commercial use, or wants a fee | medium | Second tier unavailable or priced | Launch on tier one; adapters stay behind a flag; budget a fee line |
| Our scraping is judged "scraping" by Openverse or Freesound | low | Key revoked | Capped runs, one request at a time, registered client, written OK first |
| Openverse changes limits, fields or the `unstable__` parameters | medium | Ingest breaks | Use only stable parameters; adapter tests with recorded answers (as Discover's simulation does) |
| Credit does not reach viewers of exported videos | open | A CC BY complaint | Credits page, optional caption line, legal read |
| The catalogue feels small next to StreamLadder's | high | Weak first impression | Say so plainly in the UI; strong search; Uploaded tab; own art in the product's look; a paid music pack later |
| Large animated files slow the editor | medium | Janky grid | 128 px WebP grid previews, APNG only on placement, 2 MB cap |
| Operator ingest mistake (wrong source or licence) | low | Bad items live | Everything lands `STAGED`; review before `publish`; runs are reversible by `run id` |

## 16. Changes To The Earlier Plan

- **Module 14 (sound)**: replace the `SOUND_PACK` manifest and the files in `video-compositions/public/sounds/` with `ClipSound` rows, the library routes above, and the Sound Credits dialog becoming `/credits/clips`. Keep upload, volume, fades and the loudness pass. Music is no longer an `EmptyState`: Kenney jingles and the OpenGameArt picks fill it at launch.
- **Module 12 (stickers and GIFs)**: replace the Klipy provider, `STICKER_PACK` and the `GIFs` tab behind a switch with `ClipSticker` rows and one catalogue with the five groups. The `StickerProvider` interface stays so a commercial provider can be added later (decision D6, P2). `art.format` shrinks to `png` and `apng`.
- **Contradictions with the brief**:
  1. D5 names Openverse and Freesound as the main intake. Their terms make both conditional on written permission, so launch stands on Kenney, our own sounds and a few hand-picked OpenGameArt files.
  2. D5 says "a few hundred sounds at install": about 650 effects is right; music is about 150, not "a few hundred".
  3. D6 lists "Openverse CC0/PDM GIFs": the yield is a handful, so they are decoration, not a pillar.
  4. D2's APNG step is confirmed with FFmpeg 9.0.2, but Lottie cannot be read by FFmpeg, so Noto comes in as WebP.
  5. The brief allows attribution-required items. We allow them for stickers only, never for sounds.

## 17. Questions For The Owner

1. **May we send the two permission emails?** One to `openverse@wordpress.org` (commercial use and a higher limit for a few hundred curated items), one to Freesound through its contact form (commercial API terms and original-file downloads). Nothing else in this file needs a reply to start.
2. **Is a thin music shelf acceptable at launch?** About 150 loops and jingles, no song catalogue. If not, the alternative is a one-off paid licence that allows redistribution inside a SaaS (to be read before buying). Who curates the roughly 60 OpenGameArt tracks (about two hours, each page open to confirm CC0) also needs an owner.
3. **Credit in exported videos**: do we send the Noto question to a lawyer with the other legal reads, or accept "credits page plus an optional caption line"?
