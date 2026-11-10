/**
 * The bodies of the competitor routes: what gets through, in what shape, and
 * what never does. Three of these values end up inside an address the server
 * asks, so the shape is checked here before the service ever sees them.
 */
import {
  COMPETITOR_NAME_MAX,
  createCompetitorSchema,
  discoverFeedsSchema,
  MAX_FEED_URLS,
  NEWS_QUERY_MAX,
  updateCompetitorSchema,
} from './dto/competitors.schema';

const FULL = {
  name: 'Acme Analytics',
  websiteUrl: 'acme.example',
  feedUrls: ['https://acme.example/blog/rss.xml'],
  youtubeChannelId: 'UCacmeSampleChannel00000',
  blueskyHandle: 'acme.example',
  mastodonAcct: 'acme@mastodon.example',
  newsQuery: 'Acme Analytics',
};

function accepts(schema: { safeParse: (value: unknown) => { success: boolean } }, body: unknown) {
  return schema.safeParse(body).success;
}

describe('createCompetitorSchema', () => {
  it('takes a whole competitor as the dialog sends it', () => {
    expect(createCompetitorSchema.parse(FULL)).toEqual(FULL);
  });

  it('needs only a name, and takes null for every field that can be cleared', () => {
    expect(createCompetitorSchema.parse({ name: 'Acme' })).toEqual({ name: 'Acme' });
    expect(
      accepts(createCompetitorSchema, {
        name: 'Acme',
        websiteUrl: null,
        youtubeChannelId: null,
        blueskyHandle: null,
        mastodonAcct: null,
        newsQuery: null,
      }),
    ).toBe(true);
  });

  it('refuses a body with no name, an empty one, a null one or one that is only markup', () => {
    for (const name of [undefined, '', '   ', null, '<b></b>']) {
      expect(accepts(createCompetitorSchema, { ...FULL, name })).toBe(false);
    }
  });

  it('cleans the name to plain text on one line', () => {
    const parsed = createCompetitorSchema.parse({
      name: `  <b>Acme</b>${String.fromCodePoint(0x202e)}  Analytics\n`,
    });

    expect(parsed.name).toBe('Acme Analytics');
  });

  it(`holds the name to ${COMPETITOR_NAME_MAX} characters after cleaning`, () => {
    expect(accepts(createCompetitorSchema, { name: 'a'.repeat(COMPETITOR_NAME_MAX) })).toBe(true);
    expect(accepts(createCompetitorSchema, { name: 'a'.repeat(COMPETITOR_NAME_MAX + 1) })).toBe(
      false,
    );
  });

  it('refuses a key it does not know', () => {
    expect(accepts(createCompetitorSchema, { ...FULL, organizationId: 'org-2' })).toBe(false);
    expect(accepts(createCompetitorSchema, { ...FULL, lastError: 'x' })).toBe(false);
  });

  it('takes an address with or without a scheme, trimmed, and refuses one with a space or a line break', () => {
    expect(createCompetitorSchema.parse({ name: 'A', websiteUrl: '  acme.example  ' })).toEqual({
      name: 'A',
      websiteUrl: 'acme.example',
    });
    for (const websiteUrl of ['', '   ', 'acme example.com', 'acme.example\n/evil', 42]) {
      expect(accepts(createCompetitorSchema, { name: 'A', websiteUrl })).toBe(false);
    }
  });

  it(`takes at most ${MAX_FEED_URLS} feed addresses`, () => {
    const feeds = (count: number) =>
      Array.from({ length: count }, (_, index) => `https://acme.example/${index}.xml`);

    expect(accepts(createCompetitorSchema, { name: 'A', feedUrls: [] })).toBe(true);
    expect(accepts(createCompetitorSchema, { name: 'A', feedUrls: feeds(MAX_FEED_URLS) })).toBe(
      true,
    );
    expect(accepts(createCompetitorSchema, { name: 'A', feedUrls: feeds(MAX_FEED_URLS + 1) })).toBe(
      false,
    );
    expect(accepts(createCompetitorSchema, { name: 'A', feedUrls: null })).toBe(false);
  });

  it('takes a YouTube channel id and nothing that only looks like one', () => {
    for (const youtubeChannelId of [
      'UCacmeSampleChannel0000',
      'UCacmeSampleChannel000000',
      'XXacmeSampleChannel00000',
      'UCacme/../SampleChannel0',
      'UCacmeSampleChannel0000&',
      'https://www.youtube.com/channel/UCacmeSampleChannel00000',
    ]) {
      expect(accepts(createCompetitorSchema, { name: 'A', youtubeChannelId })).toBe(false);
    }
    expect(
      createCompetitorSchema.parse({ name: 'A', youtubeChannelId: ' UCacmeSampleChannel00000 ' })
        .youtubeChannelId,
    ).toBe('UCacmeSampleChannel00000');
  });

  it('stores a Bluesky handle bare and in lower case, and refuses what is not a host name', () => {
    expect(
      createCompetitorSchema.parse({ name: 'A', blueskyHandle: '@Acme.BSKY.social' }).blueskyHandle,
    ).toBe('acme.bsky.social');
    for (const blueskyHandle of [
      'acme',
      'acme.example/feed',
      '127.0.0.1',
      'acme.example:8080',
      '',
    ]) {
      expect(accepts(createCompetitorSchema, { name: 'A', blueskyHandle })).toBe(false);
    }
  });

  it('stores a Mastodon account as user@instance, and refuses a bad user or instance', () => {
    expect(
      createCompetitorSchema.parse({ name: 'A', mastodonAcct: '@acme@Mastodon.Social' })
        .mastodonAcct,
    ).toBe('acme@mastodon.social');
    for (const mastodonAcct of [
      'acme',
      'acme@',
      'acme@localhost',
      'acme@10.0.0.5',
      'acme@mastodon.social:8080',
      'acme@mastodon.social/api',
      'ac me@mastodon.social',
    ]) {
      expect(accepts(createCompetitorSchema, { name: 'A', mastodonAcct })).toBe(false);
    }
  });

  it(`holds the news phrase between 2 and ${NEWS_QUERY_MAX} characters, cleaned`, () => {
    expect(
      createCompetitorSchema.parse({ name: 'A', newsQuery: '  Acme   <i>Analytics</i> ' }),
    ).toEqual({ name: 'A', newsQuery: 'Acme Analytics' });
    expect(accepts(createCompetitorSchema, { name: 'A', newsQuery: 'a' })).toBe(false);
    expect(
      accepts(createCompetitorSchema, { name: 'A', newsQuery: 'a'.repeat(NEWS_QUERY_MAX + 1) }),
    ).toBe(false);
  });
});

describe('updateCompetitorSchema', () => {
  it('takes any one field on its own', () => {
    for (const [key, value] of Object.entries(FULL)) {
      expect(accepts(updateCompetitorSchema, { [key]: value })).toBe(true);
    }
  });

  it('refuses a body with nothing in it', () => {
    expect(accepts(updateCompetitorSchema, {})).toBe(false);
  });

  it('never lets the name be cleared', () => {
    expect(accepts(updateCompetitorSchema, { name: null })).toBe(false);
    expect(accepts(updateCompetitorSchema, { name: '' })).toBe(false);
  });

  it('refuses a key it does not know', () => {
    expect(accepts(updateCompetitorSchema, { name: 'A', deletedAt: null })).toBe(false);
  });
});

describe('discoverFeedsSchema', () => {
  it('takes one address and nothing else', () => {
    expect(discoverFeedsSchema.parse({ url: ' acme.example ' })).toEqual({ url: 'acme.example' });
    expect(accepts(discoverFeedsSchema, {})).toBe(false);
    expect(accepts(discoverFeedsSchema, { url: '' })).toBe(false);
    expect(accepts(discoverFeedsSchema, { url: 'acme.example', depth: 3 })).toBe(false);
  });
});
