# Clips: Getting Your Channel Keys

> **For**: Arvind, setting up the optional keys for My Channels (Sprint 12, Module 03).
> **Checked on**: 2026-11-18. Button names on the two consoles change now and then. If a screen looks a little different, look for the same words nearby.

Clips already works with **no keys at all**. These keys only change **where My
Channels gets its lists of streams, videos and clips** when simulation is off.
Without them, the worker's yt-dlp reads the lists instead (slower, and it can
be refused by a platform now and then).

**While `CLIPS_SIMULATION="true"`** (your laptop today) the keys are not used
at all: My Channels answers from the recorded `acme` channel. Setting them is
safe; nothing calls Twitch or YouTube until you switch simulation off.

---

## The Short Version

| Recipe | What it switches on | Cost | Time | When |
|---|---|---|---|---|
| [1. Twitch application](#recipe-1-twitch-application) | Twitch lists from Twitch's own API (Helix) | 🆓 Free | 10 min | 🟡 Before real Twitch tests |
| [2. YouTube key for Clips](#recipe-2-youtube-data-api-key-for-clips) | YouTube lists from the YouTube Data API | 🆓 Free (a daily quota) | 10 min | 🟡 Before real YouTube tests |
| [4. Groq key for long listening](#recipe-4-groq-key-for-long-listening-sprint-13-module-15) | Long speech turned into text by Groq instead of our own machine (`TRANSCRIBER=auto`) | 💵 Paid per audio hour ($0.04, read 2026-11-14) | 5 min | 🟡 Before a real long Find Clips run, only with your OK |

Kick has no official list API, so Kick always uses the yt-dlp list. Nothing to set up.

---

## Before You Start

Both recipes end with the same move: paste a line into **`.env`** at the top of
the project (`D:\rk-personal-projects\postgear\.env`), save, and restart the API
(`npm run dev:api`). The lines are already there, empty:

```text
TWITCH_CLIENT_ID=""
TWITCH_CLIENT_SECRET=""
CLIPS_YOUTUBE_API_KEY=""
```

Git never uploads `.env`, and the API never writes these values to its logs.

---

## Recipe 1: Twitch Application

A Twitch application of its own for Clips, separate from anything used for
logging in, so their limits and reviews never mix.

1. Open **dev.twitch.tv/console** and log in with your Twitch account. Twitch
   asks for two-factor sign-in on developer accounts; turn it on if asked.
2. Click **Register Your Application**.
3. Fill in:
   - **Name**: `PostGear Clips` (it must be unique on Twitch; add a word if taken).
   - **OAuth Redirect URLs**: `http://localhost` (Clips never sends anyone there; the field is required).
   - **Category**: Website Integration.
   - **Client Type**: Confidential.
4. Click **Create**, then **Manage** on the new application.
5. Copy the **Client ID** into `TWITCH_CLIENT_ID`.
6. Click **New Secret**, confirm, and copy it into `TWITCH_CLIENT_SECRET`.
   Twitch shows it once; if you lose it, make a new one.
7. Restart the API. Its log line `clips.channels.bindings` now says `"twitch":"helix"`
   (it says `"flat"` without the keys, and `"mode":"simulation"` while simulating).

- [ ] Twitch keys set, the log says `helix`.

### The Same Keys For The Schedule Maker (Sprint 13)

The Schedule Maker (Clips, Creator Tools) reads a channel's weekly schedule
with the same two values: no new variable, and no second application. If the
application above already exists, skip to step 6 of this list.

1. Sign in at **dev.twitch.tv/console**. Turn on two-factor sign-in if Twitch
   asks for it.
2. Click **Register Your Application**.
3. Give it any name (it must be unique on Twitch).
4. Set the redirect address to `http://localhost`. The app token flow never
   sends anyone there; Twitch only requires the field.
5. Set **Category** to Website Integration and **Client Type** to
   Confidential, then **Create**.
6. Open **Manage**, click **New Secret**, and copy the **Client ID** and the
   secret into `.env` as `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`.
7. Restart the API. Its log line `studio.schedules.binding` now says
   `"mode":"helix"` (it says `"simulation"` without the keys outside
   production, or under `CLIPS_SIMULATION=true`, and `"off"` in production
   without them).

An app token needs no user login and no scope: it reads only public data
(the channel's id and its published schedule). The token and the secret are
never logged and never sent to the browser; the token is kept in Redis and
shared with the channel browser.

Arvind: please confirm each step above against the live Twitch console the
first time you do it, since that page changes, and correct this list where it
differs.

- [ ] Schedule Maker reads a real channel's week, the log says `helix`.

## Recipe 2: YouTube Data API Key For Clips

A key from a **separate Google project** from the one used for publishing and
for Discover, so Clips' list quota can never use up theirs (decision D12-17).

1. Open **console.cloud.google.com** and pick **New Project** from the project
   menu at the top. Name it `PostGear Clips`.
2. With that project selected, open **APIs & Services**, then **Library**,
   search **YouTube Data API v3**, and click **Enable**.
3. Open **APIs & Services**, then **Credentials**, then **Create Credentials**,
   then **API key**.
4. Click the new key and, under **API restrictions**, choose **Restrict key**
   and tick only **YouTube Data API v3**. Save.
5. Copy the key into `CLIPS_YOUTUBE_API_KEY`.
6. Restart the API. The `clips.channels.bindings` line now says `"youtube":"data_api"`.

The default quota is a set number of units a day, shared by every workspace.
Clips stops using the key at 60 percent of the day's quota and falls back to
the yt-dlp list, so a busy day never runs it dry.

**On your laptop only**: without `CLIPS_YOUTUBE_API_KEY`, Clips borrows
Discover's `YOUTUBE_API_KEY` if that is set. Production never borrows it.

- [ ] YouTube key set, the log says `data_api`.

---

## Recipe 3: Google Drive Picker (Sprint 13, Module 12)

This turns on **Pick From Google Drive** on the Clips home. A person picks
one video in Google's own picker and it comes in like an upload. PostGear
asks only for the `drive.file` scope (it can read the files the person picks,
nothing else), never lists a Drive and never keeps a token past the import.

Use the Google Cloud project that already holds the Google login app.

1. In **APIs And Services, Library**, enable the **Google Drive API** and the
   **Google Picker API**.
2. In **APIs And Services, Credentials**, choose **Create Credentials, API
   Key**. Restrict it: **Application restrictions**, Websites, add
   `http://localhost:3000/*` (and the staging and production web addresses
   later); **API restrictions**, the Google Picker API only. This key is
   public by design (it runs in the browser).
3. Open the login's **OAuth 2.0 Client ID** (Web application) and add
   `http://localhost:3000` under **Authorised JavaScript origins**.
4. In **OAuth Consent Screen, Data Access** (or Scopes), add
   `https://www.googleapis.com/auth/drive.file`. It is a non-sensitive scope,
   so it needs no security review; while the app is in Testing only the named
   test users can use it.
5. Note the **Project number** from the project's **Dashboard** (a long
   number, not the project id).
6. In `.env`:

   ```
   GOOGLE_DRIVE_PICKER_KEY="<the API key from step 2>"
   GOOGLE_DRIVE_APP_ID="<the project number from step 5>"
   ```

   `GOOGLE_CLIENT_ID` is the login one, already set. Restart the API.

With `CLIPS_SIMULATION="true"` the button opens a stand-in picker with
made-up files instead, whatever is set here: set `CLIPS_SIMULATION="false"`
for the real test.

- [ ] Drive API and Picker API on, key restricted, origin added, `drive.file` on the consent screen.
- [ ] A real video picked from your own Drive comes in as an upload.

---

## Recipe 4: Groq Key For Long Listening (Sprint 13, Module 15)

This turns on the **hosted lane** for speech to text. With
`TRANSCRIBER="auto"`, the media service listens on our own machine to any job
of up to `TRANSCRIBE_HOSTED_ABOVE_MINUTES` of sound (55 by default) and sends
longer ones to Groq, which is much faster. If Groq fails for a job (busy,
refused, down), that job goes back to our own machine by itself. Without a key
everything stays on our own machine.

⚠️ **This one costs money and sends sound out.** Groq bills per hour of audio:
$0.04 for `whisper-large-v3-turbo`, the model we use, with at least 10 seconds
billed per request (console.groq.com/docs/speech-to-text, read 2026-11-14 in
`docs/sprint-13/research/04-transcription.md`). While the lane is on, the
privacy hint in Clip Setup names Groq, and long speech leaves our servers.
Do not set the key until you want a real long run (D13-03).

1. Sign in at **console.groq.com** (Groq's own console, where its speech to
   text documentation lives).
2. Open **API Keys** and create a key. Name it `PostGear Clips`. Copy it at
   once: the console shows it only once.
3. In `.env`:

   ```
   TRANSCRIBER="auto"
   GROQ_API_KEY="<the key from step 2>"
   ```

   Keep `TRANSCRIBE_HOSTED_ABOVE_MINUTES="55"` unless the box was measured
   (see below). Restart the media service (`npm run dev:media`).
4. Check: with `MEDIA_SIMULATION="false"`, `GET /tools` on the media service
   shows `"hostedTranscriber": { "state": "live", "name": "groq" }` and
   `"hostedAboveMinutes": 55`; `GET /clips/status` shows
   `ai.hostedLane.on: true` with `providerName: "Groq"`.

**While `MEDIA_SIMULATION="true"`** (your laptop today) the key is never used:
every listen answers from recorded files and the lane reads as off.

**The threshold.** 55 minutes comes from Module 02's benchmark of the `small`
model (0.17 seconds a second of sound on a 4 processor container), so about
ten minutes of waiting at most on our own machine. `large-v3-turbo` (the
default `WHISPER_MODEL`) is slower and was not measured: run
`npm run clips:listen-benchmark` on the real box and use the sum in
`docs/launch-readiness/06-clips-and-clips-ai.md`.

The sound Groq receives is cut into chunks of at most ten minutes (16 kHz mono,
about 19 MB each), under the 25 MB a request may carry on Groq's free tier, so
the free tier works; its rate limits may slow a long job, and a job that keeps
failing there goes back to our own machine.

- [ ] Key created and in `.env`, `TRANSCRIBER="auto"`, media service restarted.
- [ ] `/tools` says the hosted lane is live; Clip Setup's privacy hint names Groq.

---

## Going Live (Staging And Production)

Staging and production each get their own values in the host's settings, never
copied from your laptop's `.env`:

- One Twitch application can serve both (add nothing else to it), or make one each.
- One Google project per environment keeps their quotas apart.
- YouTube import in production stays off until the legal read (`CLIPS_PLATFORMS`,
  decision D12-15); the YouTube key only matters once it is on.
- The Groq key belongs to the media service only (never the API or the web app).
  Turning it on in production also needs Groq named in the privacy policy as a
  sub-processor (research 07, section 7.1; needs a legal read).
