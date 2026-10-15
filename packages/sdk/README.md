# @postgear/sdk

A Node.js client for the PostGear public API (`/v1`) and a verifier for the
webhooks PostGear sends. No business logic: every method is one HTTP call,
every error is the API's own message with its status.

```ts
import { PostGear } from '@postgear/sdk';

const postgear = new PostGear({
  apiKey: process.env.POSTGEAR_API_KEY!, // Settings → API keys
  baseUrl: 'https://postgear.example.com', // the API, default http://localhost:3001
});

const me = await postgear.me(); // { workspace, key, plan }
const channels = await postgear.channels.list();

const post = await postgear.posts.create({
  text: 'Shipping the new calendar today.\n\nDrag a post, change its day.',
  channelIds: [channels[0].id],
  publishAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  state: 'queue', // or 'draft'
});

const page = await postgear.posts.list({ page: 1, state: 'QUEUE' });
const detail = await postgear.posts.get(post.id);
await postgear.posts.delete(post.id);

const overview = await postgear.analytics.overview({ range: 30 });
```

Errors:

```ts
import { PostGearError } from '@postgear/sdk';

try {
  await postgear.posts.create({ text: '', channelIds: [] });
} catch (error) {
  if (error instanceof PostGearError) {
    error.status; // 400, 401, 422, 429 …
    error.message; // what the API said
    if (error.isRateLimited) error.retryAfterSeconds; // from Retry-After
  }
}
```

## Receiving webhooks

PostGear signs every delivery. Read the **raw** body, then:

```ts
import { constructWebhookEvent, WEBHOOK_SIGNATURE_HEADER, WEBHOOK_TIMESTAMP_HEADER } from '@postgear/sdk';

app.post('/postgear', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    event = constructWebhookEvent({
      payload: req.body, // Buffer
      secret: process.env.POSTGEAR_WEBHOOK_SECRET!,
      signature: req.header(WEBHOOK_SIGNATURE_HEADER),
      timestamp: req.header(WEBHOOK_TIMESTAMP_HEADER),
    });
  } catch {
    return res.status(400).end();
  }

  switch (event.event) {
    case 'post.published':
      // event.data.post.url, event.data.post.channel.name …
      break;
    case 'post.failed':
      // event.data.error.reason, event.data.error.message
      break;
  }
  res.status(204).end();
});
```

Deliveries that are not answered 2xx are retried (30 s, 2 min, 8 min, 32 min,
2 h). Answer quickly and do the work afterwards.

The full API reference is served by the API itself at `/api/docs`.
