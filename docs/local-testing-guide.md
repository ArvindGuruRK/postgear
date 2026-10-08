# Local testing guide (free, no paid API keys)

How to run PostGear on your machine and see what has been built so far, using
only free things. Start at section 1 and stop whenever you have seen enough.
Sections 1 to 5 need no social account or API key at all.

For registering each platform's developer app in full detail, see
[social-platform-setup.md](social-platform-setup.md). This guide is the
shortest path to seeing things work.

---

## 0. What you can test today

PostGear is partway through its build, so some screens are real and some are
placeholders.

| Works in the browser | Not available yet |
|---|---|
| Login with the seeded demo account | **Publishing a post from the UI.** The composer saves drafts and queue entries, but nothing sends them out yet. |
| Composer: editor, per-platform previews, character counters, threads, media attach | The Queue page (empty placeholder) |
| Media library: upload, preview, delete | Analytics, SEO analyzer, AI copilot |
| Save a draft, "Add to queue", reopen drafts | |
| Connect a real social account (OAuth) | |
| Channel card, reconnect, "wrong account" guard, disconnect | |

The only way to publish a real post today is the API's test-post endpoint
(section 7).

### What costs money and what does not

- **X** charges for API use (pay-per-use credits, no free tier for new
  developers). Parked until later, see the appendix.
- **LinkedIn, YouTube, Facebook, Instagram, TikTok and Pinterest** have free APIs.
  The hurdles are app review and, for some, localhost redirects being refused.
- **Free-to-test, ranked:**

  | Platform | Free? | Works on localhost? | Verdict |
  |---|---|---|---|
  | LinkedIn (personal) | Yes | Yes (should) | **Do this one first** |
  | YouTube | Yes | Yes | Second. Connects fine, but a real post needs a video. |
  | Facebook | Yes | Needs a free tunnel | Optional, more setup |
  | Instagram | Yes | Needs a tunnel, plus media | Skip for now |
  | Pinterest | Yes | Usually needs a tunnel, plus media | Skip for now |
  | TikTok | Yes | Needs a tunnel and a verified domain; posts are forced private | Skip |

---

## 1. Start the local services (Docker)

PostGear needs three containers: Postgres (database), Redis, and MinIO (file
storage). They are defined in `docker-compose.yml`.

1. Open **Docker Desktop** and wait until it says *Engine running*.
2. From the project folder:

   ```powershell
   docker compose up -d
   docker ps
   ```

   You should see `postgear_postgres`, `postgear_redis` and `postgear_minio`
   with status `Up`.

> The database is already migrated and seeded. If you ever wipe the volumes, run
> `npm run db:migrate` and then `npm run db:seed`.

---

## 2. Check your `.env`

The `.env` file in the project root drives everything. Make sure these are set
(they are the defaults):

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgear_db?schema=public"
API_URL="http://localhost:3001"
WEB_URL="http://localhost:3000"
NEXT_PUBLIC_API_URL="http://localhost:3001"
STORAGE_PROVIDER="local"
```

**Security keys must be real values, not placeholders.** `.env.example` ships
with descriptive text such as `32-byte-hex-string-for-...`. The API refuses to
start if `ENCRYPTION_KEY_AES256` is not exactly 64 hex characters. If the API
complains about that or about `JWT_SECRET` in the next step:

```powershell
npm run generate:keys -- --write
```

This rewrites those secrets in `.env`. Only run it if the API complained,
because a new encryption key makes any tokens already in the local database
unreadable. (Harmless here: you would just reconnect the channel.)

> The API reads `.env` only when it starts. **Every time you edit `.env`, stop
> the API with Ctrl+C and start it again.**

---

## 3. Start the app

Two terminals, both in the project folder.

**Terminal 1: API (port 3001)**

```powershell
npm run dev:api
```

Wait for it to say it is listening. Any `.env` problem appears here, with the
variable named.

**Terminal 2: website (port 3000)**

```powershell
npm run dev --workspace=@postgear/web
```

---

## 4. Log in

Open **<http://localhost:3000>** and use the seeded account:

| | |
|---|---|
| Email | `demo@postgear.local` |
| Password | `DemoPassword123!` |

The workspace is `seed-demo-org`. You will see three **fake** channels on the
Channels page (*Acme Marketing*, *Acme on X*, *Acme Studio*). They are seed data
with fake tokens, not real connections.

Other seeded accounts, if you want to test roles: `member@postgear.local` and
`onboarding@postgear.local` (same password).

---

## 5. Test with no social account at all

This covers most of Sprint 4 and costs nothing.

### The composer
Open **<http://localhost:3000/seed-demo-org/composer>**.

1. Pick a channel in the channel picker.
2. Type text and watch the **live preview** and the **character counter**.
   Limits differ by platform. For example X counts every link as 23 characters
   and each emoji as 2, while LinkedIn allows 3,000 and YouTube descriptions 5,000.
3. Go over a platform's limit and see how the editor flags it.
4. Add a second part to make a **thread** and watch the preview change.
5. Attach media. Each platform has its own limits (X: up to 4 images, or 1 GIF,
   or 1 video; LinkedIn: up to 20 images and no video yet).
6. **Save draft**, reload the page, then reopen it from the drafts list. It
   should still be there.
7. **Add to queue** with a future date. It saves as queued. It will not
   actually publish yet.

### The media library
Open **<http://localhost:3000/seed-demo-org/media>**.

- Upload an image. It should appear as a tile.
- Upload something that is not an image or video. It should be rejected.
- Delete one.
- With `STORAGE_PROVIDER="local"`, files are stored in `apps/api/uploads/`.

---

## 6. Connect LinkedIn (recommended first real test)

Free, usually instant, and it exercises the real connect flow end to end.

### 6a. Create the LinkedIn developer app

1. **LinkedIn Page.** The app must be associated with a LinkedIn Page that you
   administer. If you have none, create a free one at
   linkedin.com/company/setup/new (any name will do).
2. Go to **<https://www.linkedin.com/developers>** and click **Create app**.
   Name it `postgear-local`, choose your Page, upload any logo, and accept the
   terms.
3. Open the **Auth** tab. Under **Authorized redirect URLs for your app**, add
   this exactly (no trailing slash, `localhost` not `127.0.0.1`):

   ```
   http://localhost:3001/channels/connect/linkedin/callback
   ```

4. Open the **Products** tab and request:
   - **Sign In with LinkedIn using OpenID Connect** (gives `openid`, `profile`)
   - **Share on LinkedIn** (gives `w_member_social`)

   Both are normally self-serve and approve immediately.

   *Skip "Community Management API". That is only for company pages
   (`linkedin-page`), needs approval, and is not required for personal posting.*
5. Back on the **Auth** tab, copy the **Client ID** and the **Primary Client
   Secret**.

### 6b. Add the keys

In `.env`:

```env
LINKEDIN_CLIENT_ID="your-client-id"
LINKEDIN_CLIENT_SECRET="your-client-secret"
```

Restart the API (Ctrl+C, then `npm run dev:api`).

### 6c. Connect in the browser

1. Open **<http://localhost:3000/seed-demo-org/channels>**.
2. Click **Connect a channel**. **LinkedIn** should be a normal button. If it is
   greyed out with a "not configured" reason, the API did not pick up the keys.
3. Click **LinkedIn**, review the consent screen and click **Allow**.
4. You come back to PostGear with a green banner, **"<your name> is connected."**,
   and a new LinkedIn card with your name and avatar.

   (The dialog also lists **LinkedIn Page**. Ignore it, since it needs the
   approval skipped above.)

### 6d. Things to try once connected

- **Reconnect with a different account.** Kebab (⋮) → **Reconnect**, then sign
  in as a *different* LinkedIn user. PostGear must refuse with *"That is a
  different account…"* and keep the original. Doing it again with the same
  account should say *Channel reconnected*.
- **The composer with LinkedIn selected.** Check the LinkedIn preview and the
  3,000-character limit.
- **Publish one real post** (section 7).

> **LinkedIn token note.** Without Marketing Developer Platform approval,
> LinkedIn tokens last about 60 days with no refresh. PostGear then shows the
> channel as expiring and asks you to reconnect. That is expected, not a bug.

### If it goes wrong

| What you see | Cause |
|---|---|
| LinkedIn greyed out | Keys missing, or the API was not restarted after editing `.env` |
| LinkedIn error about the redirect URL | The URL in the LinkedIn Auth tab does not match exactly |
| "Couldn't connect" banner back in PostGear | Check the API terminal for the reason. Often the **Share on LinkedIn** or **Sign In** product is not approved yet. |
| `unauthorized_scope_error` on LinkedIn | A required product was not added in the Products tab |

---

## 7. Publish one real test post (API only)

The UI cannot publish yet, but the API can. This posts **publicly to the
connected account**, so use a test account or delete the post afterwards.

Open a **third** PowerShell window:

```powershell
$base = "http://localhost:3001"
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession

Invoke-RestMethod "$base/auth/login" -Method Post -WebSession $s `
  -ContentType "application/json" `
  -Body '{"email":"demo@postgear.local","password":"DemoPassword123!"}' | Out-Null
Invoke-RestMethod "$base/orgs/seed-demo-org/switch" -Method Post -WebSession $s | Out-Null

# list channels and find the id of your REAL LinkedIn one (the seeded ones are fake)
Invoke-RestMethod "$base/channels" -WebSession $s | ConvertTo-Json -Depth 5
```

Copy your LinkedIn channel's `id`, then:

```powershell
$id = "paste-the-channel-id-here"
Invoke-RestMethod "$base/channels/$id/test-post" -Method Post -WebSession $s `
  -ContentType "application/json" `
  -Body '{"message":"Hello from PostGear, testing locally"}'
```

The response should contain a link to the post. Open it to see it on LinkedIn.

**Check the token is stored encrypted:**

```powershell
docker exec postgear_postgres psql -U postgres -d postgear_db -c 'SELECT "providerIdentifier", left(token, 30) FROM "Integration";'
```

Your real row should show unreadable ciphertext, never a readable access token.

---

## 8. Optional: YouTube (free, connect flow only)

Google accepts localhost, so no tunnel is needed.

1. Go to **<https://console.cloud.google.com>**, create a project, and enable
   **YouTube Data API v3** (APIs & Services → Library).
2. **OAuth consent screen**: choose **External**, leave it in **Testing**, and
   add your own Google account under **Test users**.
3. **Credentials → Create credentials → OAuth client ID → Web application.**
   Add this under *Authorized redirect URIs*:

   ```
   http://localhost:3001/channels/connect/youtube/callback
   ```

4. Put the keys in `.env` and restart the API:

   ```env
   YOUTUBE_CLIENT_ID="....apps.googleusercontent.com"
   YOUTUBE_CLIENT_SECRET="..."
   ```

5. Connect it from the Channels page. You will see an **"unverified app"**
   warning. That is normal in Testing mode, so click through it.
6. After authorising, YouTube asks you to **finish setup** by picking the
   channel. Your Google account must own a YouTube channel, or PostGear says so.

A real upload needs a video and is not worth testing from the UI yet.

---

## 9. Troubleshooting cheat-sheet

| Symptom | Likely cause |
|---|---|
| `docker compose up` errors about the engine | Docker Desktop is not running yet |
| Port 5432, 6379 or 9000 already in use | Another Postgres, Redis or MinIO is running |
| API will not start | Read the first error. It names the bad `.env` variable. See section 2. |
| Website loads but login fails | The API is not running on 3001 |
| Platform greyed out in the connect dialog | Keys not read. Restart the API. |
| Redirect or callback error on the platform | The registered URL must exactly equal `<API_URL>/channels/connect/<provider>/callback` |
| "Your connection has expired" | Token invalid. Use **Reconnect**. |

---

## 10. Clean up

```powershell
# stop the API and website with Ctrl+C in their terminals, then:
docker compose stop        # keeps your data
# docker compose down -v   # also deletes ALL local data (migrate and seed again afterwards)
```

To revoke PostGear's access to your LinkedIn account, use **Disconnect** on the
channel card. It revokes the token where the platform supports it.

---

## Appendix: X (parked until you can pay)

X is pay-per-use, so it is left out of the free path. When you are ready, the
setup is:

- Create the app at <https://developer.x.com>. Under *User authentication
  settings* choose **OAuth 2.0**, **Read and write**, and type **Web App,
  Automated App or Bot**.
- Callback URL: `http://localhost:3001/channels/connect/x/callback`.
- Use the **OAuth 2.0 Client ID and Client Secret** (not the API Key or Bearer
  Token) in `X_TWITTER_CLIENT_ID` and `X_TWITTER_CLIENT_SECRET`.
- Add a small credit balance in the console's Billing section. Check
  [X's pricing page](https://docs.x.com/x-api/getting-started/pricing) for the
  current rates and any new-developer credit offers.

Full details are in section 3 of [social-platform-setup.md](social-platform-setup.md).
