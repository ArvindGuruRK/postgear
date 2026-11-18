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

## Going Live (Staging And Production)

Staging and production each get their own values in the host's settings, never
copied from your laptop's `.env`:

- One Twitch application can serve both (add nothing else to it), or make one each.
- One Google project per environment keeps their quotas apart.
- YouTube import in production stays off until the legal read (`CLIPS_PLATFORMS`,
  decision D12-15); the YouTube key only matters once it is on.
