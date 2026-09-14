# Registering the social platform apps

Everything in [Sprint 3](sprint-documents/sprint-03-social-integrations.md) is
built and tested except the four Definition-of-Done items that need a real
developer app to connect against. This is the guide for closing those.

Work through it in the order below — the first two sections have review queues
measured in weeks, so start them today and do the quick ones while you wait.

> **On accuracy.** The scopes, environment variable names and callback URLs
> below come straight from PostGear's own code and are exact. The developer
> portals themselves get reorganised constantly, so menu names and page layouts
> may not match what you see — treat the navigation as a description of *what to
> find*, not a literal click path.

---

## The one thing that is identical everywhere

Every platform asks for a redirect (callback) URL. PostGear's is always:

```
<API_URL>/channels/connect/<provider>/callback
```

Locally that means:

| Provider | Callback URL to register |
|---|---|
| X | `http://localhost:3001/channels/connect/x/callback` |
| LinkedIn (personal) | `http://localhost:3001/channels/connect/linkedin/callback` |
| LinkedIn Page | `http://localhost:3001/channels/connect/linkedin-page/callback` |
| Facebook | `http://localhost:3001/channels/connect/facebook/callback` |
| Instagram | `http://localhost:3001/channels/connect/instagram/callback` |
| YouTube | `http://localhost:3001/channels/connect/youtube/callback` |
| TikTok | `http://localhost:3001/channels/connect/tiktok/callback` |
| Pinterest | `http://localhost:3001/channels/connect/pinterest/callback` |

**Two apps each serve two providers**, so register both of that pair's callbacks
in the same app:

- **One LinkedIn app** covers `linkedin` and `linkedin-page`.
- **One Meta app** covers `facebook` and `instagram`.

The URL must match byte for byte — a trailing slash or `127.0.0.1` instead of
`localhost` is rejected, usually with an unhelpful error.

## You will probably need an HTTPS tunnel

Several platforms refuse plain `http://localhost` redirect URIs outright. Google
and X generally accept localhost; **Meta, TikTok and Pinterest typically do
not**. If a portal rejects the URL, run a tunnel:

```bash
cloudflared tunnel --url http://localhost:3001     # or: ngrok http 3001
```

Then point PostGear at the public hostname, because the callback URL is built
from `API_URL` and must match what you registered:

```env
API_URL="https://your-tunnel-hostname.example.com"
WEB_URL="http://localhost:3000"
```

Restart the API afterwards. Getting this wrong is the single most common way to
lose an hour here: the consent screen appears, and the platform then refuses the
redirect because the URI does not match the registration.

## Media has to be reachable from the internet, too (Sprint 4)

Connecting a channel only needs the callback to reach PostGear. **Publishing an
image or video** needs more: Instagram, Facebook, Pinterest and TikTok do not
accept uploaded bytes from PostGear — they are handed the media library's URL
and fetch the file themselves. With the default `STORAGE_PROVIDER=local` that URL is
`<API_URL>/uploads/…`, which `localhost` makes unreachable to them, and the post
fails at the platform with a fetch error rather than in PostGear.

Two ways to make it work:

- **A tunnel** — the one set up above. Media URLs are built from `API_URL`, so
  pointing it at the tunnel hostname makes uploads fetchable as well. Fine for
  testing.
- **An S3-compatible bucket** with public read — what production needs anyway.
  Set `STORAGE_PROVIDER=s3` and the `S3_*` variables in `.env.example`, with
  `S3_PUBLIC_URL` as the bucket's public address.

X, LinkedIn and YouTube download the file inside PostGear and upload the bytes,
so they only need PostGear itself to reach the URL. **TikTok is the strictest:**
its `PULL_FROM_URL` upload only accepts a domain verified in the TikTok developer
portal, which in practice means a bucket or CDN on a domain you own — a
throwaway tunnel hostname will not do.

---

## 1. Meta — Facebook Pages + Instagram (start first, longest lead time)

**Portal:** developers.facebook.com → *My Apps* → *Create App* → **Business**

**This must be a different app from your Sprint 2 Facebook login.** That one uses
`FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` and needs only basic profile
scopes. Publishing needs review-gated permissions, and sharing one app would put
sign-in behind that review — a rejection would take down authentication for
everyone.

**Steps**

1. Create the Business app, then add the **Facebook Login** product.
2. Under Facebook Login → Settings, add both callback URLs (`facebook` and
   `instagram`) to *Valid OAuth Redirect URIs*.
3. Copy the App ID and App Secret from *App Settings → Basic*.
4. Request these permissions under *App Review → Permissions and Features*:

   | Facebook | Instagram |
   |---|---|
   | `pages_show_list` | `instagram_basic` |
   | `pages_manage_posts` | `instagram_content_publish` |
   | `pages_read_engagement` | `pages_show_list` |
   | `business_management` | `pages_read_engagement` |
   | | `business_management` |

5. Complete **Business Verification** — this is the slow part.

```env
FACEBOOK_APP_ID="your-app-id"
FACEBOOK_APP_SECRET="your-app-secret"
```

**Prerequisites on the account side**, and the usual cause of an empty picker:

- You must **administer at least one Facebook Page**.
- For Instagram, the account must be a **Business or Creator** account **linked
  to one of those Pages**. A personal Instagram account cannot be published to
  through any API — the "Finish setup" dialog will show its empty state
  explaining exactly this.

**While in development mode** you can connect Pages you administer with your own
developer account without full review, which is enough to test end to end.

---

## 2. LinkedIn (start second — company pages need approval)

**Portal:** linkedin.com/developers → *Create app*

The app must be associated with a LinkedIn Page you are an admin of. If you do
not have one, create it first; that alone can take a day to verify.

**Steps**

1. Create the app, then register **both** callback URLs (`linkedin` and
   `linkedin-page`) under *Auth → Authorized redirect URLs*.
2. Under *Products*, request:
   - **Sign In with LinkedIn using OpenID Connect** — grants `openid`, `profile`.
     Usually self-serve and instant.
   - **Share on LinkedIn** — grants `w_member_social`. Usually self-serve.
   - **Community Management API** — grants `r_organization_admin` and
     `w_organization_social`. **This one needs an application and approval**, and
     is what `linkedin-page` requires.
3. Copy the Client ID and Client Secret from *Auth*.

```env
LINKEDIN_CLIENT_ID="your-client-id"
LINKEDIN_CLIENT_SECRET="your-client-secret"
```

**Personal posting (`linkedin`) will usually work within the hour.** Company page
posting (`linkedin-page`) waits on the Community Management API approval, so
expect to test them separately.

> **A token quirk worth expecting.** LinkedIn only issues refresh tokens to apps
> approved for its Marketing Developer Platform. Without that, access tokens last
> about 60 days and there is nothing to refresh with — PostGear reports the
> channel as expiring and asks the user to reconnect, which is the honest
> behaviour rather than a refresh that silently never works.

---

## 3. X — the quickest real test, and the best first one

**Portal:** developer.x.com → *Developer Portal* → *Projects & Apps*

Do this one first if you want to see the whole flow working today. It also
exercises the sprint's actual goal — PKCE plus a genuine refresh token — which
none of the others do as cleanly.

**Steps**

1. Create a **Project**, then an **App** inside it.
2. Open *User authentication settings* and enable **OAuth 2.0**.
3. Set **Type of App** to **Web App, Automated App or Bot** — this is the
   confidential-client option, and PostGear sends a client secret via HTTP Basic.
   Choosing the public-client option makes the token exchange fail.
4. Set the callback URL, plus any website URL.
5. Set **App permissions** to **Read and write**. Read-only is the default and
   posting will fail later with a permissions error rather than at connect time.
6. Copy the **OAuth 2.0 Client ID and Client Secret** — *not* the API Key/Secret,
   which are the OAuth 1.0a credentials and will not work here.

```env
X_TWITTER_CLIENT_ID="your-oauth2-client-id"
X_TWITTER_CLIENT_SECRET="your-oauth2-client-secret"
```

Scopes PostGear requests: `tweet.read`, `tweet.write`, `users.read`,
`media.write`, `offline.access`.

> The free tier caps monthly posts (a few hundred), which is ample for testing
> but worth knowing before you point anything automated at it.

---

## 4. YouTube (Google Cloud)

**Portal:** console.cloud.google.com

**Steps**

1. Create a project, then enable **YouTube Data API v3** under *APIs & Services
   → Library*.
2. Configure the **OAuth consent screen**. Choose **External** and leave it in
   **Testing** — that permits up to 100 named test users without Google's
   verification review, which is all you need. Add your own Google account under
   *Test users*.
3. Create credentials → **OAuth client ID** → **Web application**, and add the
   callback URL under *Authorized redirect URIs*.

```env
YOUTUBE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
YOUTUBE_CLIENT_SECRET="your-client-secret"
```

Scopes PostGear requests: `youtube.upload`, `youtube.readonly`,
`youtube.force-ssl`.

Two things to expect:

- **`youtube.upload` is a sensitive scope.** In Testing mode you will see an
  "unverified app" warning and can proceed; publishing the app to production
  needs Google's verification, which for upload scopes can include a security
  assessment.
- **The Google account must own a YouTube channel.** If it does not, PostGear
  says so explicitly rather than failing obscurely.

---

## 5. TikTok

**Portal:** developers.tiktok.com

**Steps**

1. Create an app and add the **Content Posting API** product.
2. Register the callback URL.
3. Copy the **Client Key** and **Client Secret**.

```env
TIKTOK_CLIENT_KEY="your-client-key"
TIKTOK_CLIENT_SECRET="your-client-secret"
```

Note the variable is `TIKTOK_CLIENT_KEY`, not `..._CLIENT_ID` — TikTok calls it a
client key in every request, and using the conventional name fails with an
unhelpful error. PostGear follows TikTok's naming.

Scopes: `user.info.basic`, `video.publish`, `video.upload`.

**Two constraints that will surprise you:**

- **Until the app passes TikTok's content-posting audit, everything it publishes
  is forced to private**, regardless of the requested privacy level. The
  integration will appear to work perfectly while nothing is publicly visible.
- PostGear uploads via `PULL_FROM_URL`, which has TikTok fetch the file itself
  rather than streaming it through the API. That requires **verifying ownership
  of the domain** the media is served from — so a localhost media URL will not
  work, and this is not really testable until Sprint 4's media library is on a
  real hostname.

---

## 6. Pinterest

**Portal:** developers.pinterest.com

**Steps**

1. Create an app and register the callback URL.
2. Copy the App ID and App Secret.

```env
PINTEREST_APP_ID="your-app-id"
PINTEREST_APP_SECRET="your-app-secret"
```

Scopes: `boards:read`, `boards:write`, `pins:read`, `pins:write`,
`user_accounts:read`.

New apps get **trial access**, which is rate-limited but sufficient to connect
and create a Pin. Standard access needs a separate request.

A Pin cannot exist outside a board, so Pinterest is one of the five providers
with a second setup step — you pick the board after authorising, and it becomes
the channel's target.

---

## After adding credentials

```bash
# restart the API so the new env vars are read
npm run dev:api
```

Then confirm PostGear sees them:

```bash
curl -s -c /tmp/c.txt -o /dev/null -X POST localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@postgear.local","password":"DemoPassword123!"}'
curl -s -b /tmp/c.txt -c /tmp/c.txt -X POST localhost:3001/orgs/seed-demo-org/switch -o /dev/null
curl -s -b /tmp/c.txt localhost:3001/channels/providers
```

> `"configured": true` only means a credential is **present**, not that it is
> valid — PostGear cannot tell a placeholder from a real key without calling the
> platform. A handshake started with a placeholder reaches the platform and is
> rejected there.

Then connect through the UI at `/seed-demo-org/channels`.

### Three things worth testing deliberately once one platform works

1. **Reconnect with a different account.** Use the kebab → *Reconnect* on a
   connected channel, then authorise a *different* account on the platform. It
   must be refused with "That is a different account…". Without that guard, the
   wrong account's credentials silently replace the right ones and every
   scheduled post afterwards goes somewhere unintended.

2. **Publish a test post.** This is the Definition-of-Done item that needs a live
   channel:

   ```bash
   curl -s -b /tmp/c.txt -X POST localhost:3001/channels/<channel-id>/test-post \
     -H 'Content-Type: application/json' \
     -d '{"message":"Hello from PostGear"}'
   ```

   Text-only works today for X, LinkedIn and Facebook. Instagram, YouTube,
   TikTok and Pinterest all require media, which arrives with Sprint 4's media
   library.

3. **Check the raw row again.** A real token from a real platform must be just as
   unreadable as the seeded one:

   ```bash
   docker exec postgear_postgres psql -U postgres -d postgear_db -c \
     'SELECT "providerIdentifier", left(token, 30) FROM "Integration";'
   ```

---

## Going to production

- Every callback URL has to be re-registered against the production `API_URL`.
  Most portals accept several redirect URIs per app, so local and production can
  coexist in one app.
- App review is per-app, not per-environment. Budget for Meta's review and
  Google's verification well before launch.
- Client secrets belong in the deployment's secret store, never in the repo.
  `.env.example` carries placeholders only.
- `ENCRYPTION_KEY_AES256` must be **generated fresh for production** and then
  never rotated casually: rotating it makes every stored token permanently
  undecryptable and forces every user to reconnect every channel. See the
  encryption boundary section in
  [SCHEMA_NOTES](../packages/db/prisma/SCHEMA_NOTES.md).
