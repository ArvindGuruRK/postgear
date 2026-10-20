---
name: add-social-provider
description: Add a new social platform (publishing, OAuth connect, composer rules, preview, analytics) to PostGear across social-core, the API, the worker and the web app. Use for "add Bluesky", "support Threads", "new platform", "add Mastodon / Reddit", "integrate a social network".
---

# Add a social provider

A provider is one class in `packages/social-core`, registered by identifier. The API, the worker and the web dispatch through `IntegrationManager` by that identifier (the value stored in `Integration.providerIdentifier`), so most of the app picks it up for free. The rest is a short list of maps keyed by identifier, listed in step 5.

## 1. Read the contract first

`packages/social-core/src/abstract/`:
- `social.provider.interface.ts`: `SocialProvider` (= `SocialAuthenticator` + `SocialPublisher` + `identifier`, `name`, `scopes`, `usesPkce`, `isConfigured()`, `maxLength()`, `rules`, `checkValidity()`), plus the optional capabilities `SupportsEntitySelection` (`listEntities`, `selectEntity`) and `SocialAnalytics` (`channelAnalytics`, optional `postAnalytics`). The manager detects those two by the methods being present.
- `social.abstract.ts`: `SocialAbstract` base. Use its `fetch`/`fetchJson` (retry and error mapping), `handleErrors` override, `checkScopes`, `generatePkcePair`, `generateState`, `cannotRefresh()`.
- `errors.ts`: throw `RefreshTokenError` (dead token, channel needs reconnect), `BadBodyError` (the post itself is wrong, no retry), `NotEnoughScopesError`, `RetryableError`. The worker branches on these classes.
- `validity.ts`: `checkAgainstRules(this, posts)` so publish-time checks say exactly what the composer says.
- `analytics.ts`: `dayKey`, `windowStart`, `clampDays`, `sumByDay`, `asCount`, `isNotFound` for metric mapping.
- `composer/rules.ts`: `ProviderRules` (`maxLength`, `lengthMethod`, `thread`, `followUpMedia`, `media`, optional `title`).

## 2. Copy an existing provider

Pick the closest sibling in `packages/social-core/src/providers/`:
- `pinterest/index.ts`: plain OAuth 2.0, an entity step (board), analytics. Shortest full example.
- `twitter/index.ts`: PKCE, threads as replies, rotated refresh tokens. Identifier is `x` though the folder is `twitter`.
- `linkedin/index.ts`: two providers in one file (`LinkedInProvider` = `linkedin`, `LinkedInPageProvider` = `linkedin-page`).
- `meta/meta.graph.ts`: shared helpers for Facebook and Instagram.

Create `providers/<folder>/index.ts` with:
- an exported `<NAME>_RULES: ProviderRules` describing exactly what `post()` can publish (declare unsupported media as `0` rather than dropping it later),
- `readonly identifier` (lowercase, `[a-z0-9-]`, never renamed once stored), `name`, `scopes`, `usesPkce`,
- `isConfigured()` reading the two env vars from `process.env`,
- `generateAuthUrl`, `authenticate`, `refreshToken` (return `this.cannotRefresh()` if the platform has no refresh), `post`, and `comment` if threads are comments,
- `override checkValidity(posts) { return checkAgainstRules(this, posts); }`.

Keep the provider free of Nest and Prisma: the worker imports it too, and tokens are encrypted by the API's channels repository, not here.

## 3. Register it

- Add `new <Name>Provider()` to the default list in `packages/social-core/src/manager/integration.manager.ts`.
- Do not export the class from `src/index.ts`; callers go through the manager.

## 4. Post settings (only if the platform has per-post options)

Add fields to `PROVIDER_SETTINGS` in `packages/social-core/src/composer/settings.ts` (title, privacy, link...). Every listed field must be honoured by `post()`, and an unset value must leave the request unchanged. The worker passes settings through (`apps/worker/src/lib/publish-details.ts`).

## 5. Every map keyed by provider id

Search for an existing id to confirm nothing new was added since this list: `git grep -n "'tiktok'\|tiktok:"`.

| Where | What to add |
|---|---|
| `apps/api/src/config/env.ts` | the two credential vars as `z.string().optional()` |
| `.env.example` | the vars with a comment on app review limits, and the id in the callback list near the top |
| `apps/api/src/modules/notifications/notifications.types.ts` | `PROVIDER_NAMES` (may already hold it) |
| `apps/web/public/icon/<id>.svg` + `apps/web/src/components/platforms/platform-icon.tsx` | `BRANDS` entry (`darkSrc` if the logo is dark) |
| `apps/web/src/components/channels/connect-channel-dialog.tsx` | `ACCOUNT_KIND` label and a place in `POPULARITY` |
| `apps/web/src/components/previews/<id>.preview.tsx` + `channel-preview.tsx` | a preview on `PlatformPreviewProps` (`preview-parts.tsx`), registered in `PREVIEWS`. Without one, `GenericPreview` is used |
| `apps/web/src/lib/onboarding-questions.ts` | `CHANNEL_OPTIONS`, only if it belongs in the onboarding question |
| `apps/web/src/components/onboarding/welcome-screen.tsx` | optional floating icon |
| `apps/worker/src/lib/analytics-source.ts` | add to `VIDEO_PLATFORMS` if it is a video platform (simulated views) |
| `docs/social-platform-setup.md` | a numbered section like "## 6. Pinterest": app registration, scopes, callback URL, review limits |

The channels module, composer validation, scheduler, publisher and analytics sync need no change: they resolve the provider by id.

## 6. OAuth callback

The API owns the flow: `GET /channels/connect/:provider` and `@Public() GET /channels/connect/:provider/callback` in `apps/api/src/modules/channels/channels.controller.ts`. The URL to register with the platform is:

```
<API_URL>/channels/connect/<identifier>/callback      (locally http://localhost:3001/...)
```

Many platforms refuse localhost, so the callback must be registered on a deployed `API_URL` (production `postgear.rkay.in`, staging `postgear-staging.rkay.in`). Where the API sits on those domains (an `api.` subdomain or an `/api` path) is not decided yet, so confirm `API_URL` with the user before giving them a callback URL. Platforms that fetch media by URL (Instagram, Facebook, Pinterest, TikTok style) also need publicly reachable media, see "Media has to be reachable" in `docs/social-platform-setup.md`.

## 7. Simulation

- `PUBLISH_SIMULATION=true`: the worker's `createPublisher` wraps any provider found by `manager.find(id)` in a stand-in (`apps/worker/src/lib/publisher.ts`), so the new provider publishes locally with no keys. `[simulate:429]` style directives work for it automatically.
- `ANALYTICS_SIMULATION`: every platform gets simulated metrics (`analytics-source.ts`).
- So the only thing that needs real keys is the OAuth connect itself. Never call a paid API to test.

## 8. Rules worth keeping

- **LinkedIn stays two picker options**: personal profile (`linkedin`) and company Page (`linkedin-page`) are separate providers and separate tiles. A merged tile was built and reverted on 2026-10-18; do not merge them, and do not model a new platform's "profile vs page" split as one tile either unless asked.
- One identifier per row, forever: changing it orphans every connected channel.
- Don't copy Postiz provider code (AGPL). Read the platform's own API docs.

## 9. Tests and checks

In `packages/social-core/src/providers/` (all with `fetch` mocked, no network):
- `providers.test.ts`: auth URL (scopes, PKCE, consent params), token exchange and refresh, entity selection, validation. Add the id to the "registers all ... channel types" list and set the env vars in `beforeEach`.
- `post-settings.test.ts`: one test per `PROVIDER_SETTINGS` field proving it changes the request.
- `analytics.test.ts`: field names map to PostGear metric names, a deleted post reads as null, dead tokens and missing scopes raise the right error classes.
- `composer/settings.test.ts` if you added settings fields.

Run: `npm test --workspace=@postgear/social-core -- providers`, then
`npx turbo run lint typecheck test --filter=@postgear/social-core --filter=@postgear/web --filter=@postgear/api --filter=@postgear/worker`.

Finally connect it once by hand in the browser (the user tests UI), and remind the user which env vars and callback URL to register.
