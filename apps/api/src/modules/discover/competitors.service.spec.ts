/**
 * The competitor rules, against a table held in memory, a fake Redis with real
 * expiry, and the real private-network guard with its lookups answered here, so
 * nothing in this file reaches a network or a name server.
 *
 * What matters most is what does not happen: a private address is refused before
 * anything is saved or fetched, the twenty-first competitor is refused before any
 * address is looked at, and another workspace's id learns nothing.
 */
import { HttpException } from '@nestjs/common';
import {
  COMPETITOR_SAMPLE,
  createFixtureFetch,
  type SourceItem,
  type SourceResult,
} from '@postgear/discover-engine';
import { assertSafeUrl, SeoCrawlError } from '@postgear/seo-engine';
import { securityLogger } from '../../common/logging/security-logger';
import type { CompetitorEngine } from './competitors.engine';
import type {
  CompetitorRow,
  CompetitorsRepository,
  CompetitorWrite,
  CreateOutcome,
} from './competitors.repository';
import {
  COMPETITOR_FRESH_MS,
  CompetitorsService,
  FEED_DISCOVERY_PER_MINUTE,
  ITEMS_PER_COMPETITOR,
  COMPETITOR_READS_PER_MINUTE,
  ITEMS_PER_SOURCE,
} from './competitors.service';
import { DiscoverCache } from './discover.cache';
import { DiscoverGate } from './discover.gate';
import { MAX_COMPETITORS } from './dto/competitors.schema';
import type { DiscoverSettingsRepository, SettingsRow } from './settings.repository';
import { DiscoverSettingsService } from './settings.service';
import { FakeRedis } from './testing/fake-redis';

const NOW = new Date('2026-11-10T10:00:00Z');
const MINUTE = 60_000;
const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const USER = 'user-1';
const PUBLIC_ADDRESS = '93.184.216.34';
const PRIVATE_SENTENCE = 'This address is private or on your own network.';
const MISSING_ID = '00000000-0000-4000-8000-00000000ffff';

const ACME: CompetitorWrite = {
  name: 'Acme Analytics',
  websiteUrl: 'https://acme.example/',
  feedUrls: ['https://acme.example/blog/rss.xml'],
  youtubeChannelId: 'UCacmeSampleChannel00000',
  blueskyHandle: 'acme.example',
  mastodonAcct: 'acme@mastodon.example',
  newsQuery: null,
};

function post(source: SourceItem['source']['id'], title: string, minutesAgo: number): SourceItem {
  const isNews = source === 'google-news';
  const address = `https://${source}.example/${encodeURIComponent(title)}`;
  return {
    kind: 'competitor',
    source: { id: source, name: isNews ? 'Sample Daily' : source },
    title,
    ...(isNews ? { opaqueUrl: address } : { url: address }),
    publishedAt: new Date(NOW.getTime() - minutesAgo * MINUTE).toISOString(),
  };
}

function ok(items: SourceItem[]): SourceResult {
  return { items, attribution: { name: 'A source' }, warnings: [] };
}

function failed(failure: 'upstream' | 'not_found', unreadable = false): SourceResult {
  return {
    items: [],
    attribution: { name: 'A source' },
    warnings: [],
    failed: failure,
    ...(unreadable ? { unreadable: true } : {}),
  };
}

function reader(id: SourceItem['source']['id'], result: SourceResult) {
  const read = jest.fn(
    async (_reference: string, _signal?: AbortSignal): Promise<SourceResult> => result,
  );
  return { id, name: id, read };
}

/** The table, as far as the service uses it: scoped by workspace, soft deleted, capped. */
function fakeRepository() {
  const rows = new Map<string, CompetitorRow & { orgId: string; deleted: boolean }>();
  let next = 1;

  const live = (orgId: string) =>
    [...rows.values()].filter((row) => row.orgId === orgId && !row.deleted);
  const idOf = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

  const table = {
    rows,
    /** Puts a row straight in, as an earlier request would have. */
    seed(orgId: string, write: Partial<CompetitorWrite> = {}): CompetitorRow {
      const id = idOf(next);
      next += 1;
      const row = {
        ...ACME,
        ...write,
        id,
        orgId,
        deleted: false,
        lastCheckedAt: null,
        lastError: null,
        createdAt: NOW,
        updatedAt: NOW,
      };
      rows.set(id, row);
      return row;
    },
    list: jest.fn(async (orgId: string) => live(orgId)),
    count: jest.fn(async (orgId: string) => live(orgId).length),
    find: jest.fn(
      async (orgId: string, id: string) => live(orgId).find((row) => row.id === id) ?? null,
    ),
    create: jest.fn(
      async (
        orgId: string,
        _userId: string | null,
        write: CompetitorWrite,
        limit: number,
      ): Promise<CreateOutcome> => {
        if (live(orgId).length >= limit) return { outcome: 'limit' };
        return { outcome: 'created', row: table.seed(orgId, write) };
      },
    ),
    update: jest.fn(async (orgId: string, id: string, write: Partial<CompetitorWrite>) => {
      const row = live(orgId).find((candidate) => candidate.id === id);
      if (!row) return null;
      Object.assign(row, write);
      return row;
    }),
    softDelete: jest.fn(async (orgId: string, id: string) => {
      const row = live(orgId).find((candidate) => candidate.id === id);
      if (!row) return false;
      row.deleted = true;
      return true;
    }),
    noteCheck: jest.fn(
      async (
        orgId: string,
        id: string,
        note: { lastCheckedAt: Date; lastError: string | null },
      ) => {
        const row = live(orgId).find((candidate) => candidate.id === id);
        if (row) Object.assign(row, note);
      },
    ),
  };
  return table;
}

function build(
  options: {
    /** What a host resolves to. A host not named here is public; `null` does not resolve. */
    dns?: Record<string, string[] | null>;
    gate?: DiscoverGate;
    settings?: SettingsRow | null;
  } = {},
) {
  const redis = new FakeRedis();
  const repository = fakeRepository();
  const resolve = jest.fn(async (host: string) => {
    const answer = options.dns && host in options.dns ? options.dns[host] : [PUBLIC_ADDRESS];
    if (answer === null) throw new Error('ENOTFOUND');
    return answer as string[];
  });
  const engine = {
    simulation: false,
    guard: jest.fn((url: string) => assertSafeUrl(url, { resolve })),
    fetch: jest.fn(),
    feeds: reader('rss', ok([post('rss', 'A blog post', 60)])),
    youtube: reader('youtube', ok([post('youtube', 'A video', 120)])),
    bluesky: reader('bluesky', ok([post('bluesky', 'A Bluesky post', 30)])),
    mastodon: reader('mastodon', ok([post('mastodon', 'A Mastodon post', 90)])),
    news: {
      search: jest.fn(
        async (): Promise<SourceResult> => ok([post('google-news', 'A story about them', 45)]),
      ),
    },
  };
  const settingsTable = { find: jest.fn(async () => options.settings ?? null), upsert: jest.fn() };
  const gate = options.gate ?? new DiscoverGate(4, 4_000);
  const service = new CompetitorsService(
    engine as unknown as CompetitorEngine,
    repository as unknown as CompetitorsRepository,
    new DiscoverCache(redis.asService()),
    gate,
    redis.asService(),
    new DiscoverSettingsService(settingsTable as unknown as DiscoverSettingsRepository),
  );

  /** Every outside read a test could have caused. */
  const readsMade = () =>
    engine.fetch.mock.calls.length +
    engine.feeds.read.mock.calls.length +
    engine.youtube.read.mock.calls.length +
    engine.bluesky.read.mock.calls.length +
    engine.mastodon.read.mock.calls.length +
    engine.news.search.mock.calls.length;

  return { service, engine, repository, redis, resolve, gate, readsMade };
}

/** The status, code and sentence of a refusal, as the web receives them. */
async function refusalOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    const body = error.getResponse();
    return typeof body === 'string'
      ? { status: error.getStatus(), message: body, code: undefined }
      : {
          status: error.getStatus(),
          message: (body as { message: string }).message,
          code: (body as { code?: string }).code,
        };
  }
  throw new Error('Expected a refusal, and the call went through.');
}

/** Lets a refresh that nobody waits for run to its end. */
async function settle(): Promise<void> {
  await jest.advanceTimersByTimeAsync(0);
}

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  warn = jest.spyOn(securityLogger, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('CompetitorsService.create', () => {
  it('saves a competitor with every address made real, and nothing fetched', async () => {
    const { service, repository, readsMade } = build();

    const competitor = await service.create(ORG, USER, {
      name: 'Acme Analytics',
      websiteUrl: 'acme.example',
      feedUrls: ['https://acme.example/blog/rss.xml', 'acme.example/changelog/atom.xml'],
      youtubeChannelId: 'UCacmeSampleChannel00000',
      blueskyHandle: 'acme.example',
      mastodonAcct: 'acme@mastodon.example',
    });

    expect(competitor).toMatchObject({
      name: 'Acme Analytics',
      websiteUrl: 'https://acme.example/',
      feedUrls: ['https://acme.example/blog/rss.xml', 'https://acme.example/changelog/atom.xml'],
      youtubeChannelId: 'UCacmeSampleChannel00000',
      blueskyHandle: 'acme.example',
      mastodonAcct: 'acme@mastodon.example',
      newsQuery: null,
      lastCheckedAt: null,
      lastError: null,
      createdAt: NOW.toISOString(),
    });
    expect(repository.create).toHaveBeenCalledWith(ORG, USER, expect.anything(), MAX_COMPETITORS);
    expect(readsMade()).toBe(0);
  });

  it('needs only a name', async () => {
    const { service } = build();

    await expect(service.create(ORG, USER, { name: 'Acme' })).resolves.toMatchObject({
      name: 'Acme',
      websiteUrl: null,
      feedUrls: [],
      youtubeChannelId: null,
    });
  });

  it('keeps one of a feed address given twice', async () => {
    const { service } = build();

    const competitor = await service.create(ORG, USER, {
      name: 'Acme',
      feedUrls: ['https://acme.example/feed', 'HTTPS://ACME.example/feed'],
    });

    expect(competitor.feedUrls).toEqual(['https://acme.example/feed']);
  });

  it.each([
    ['a private range', 'http://10.0.0.5/'],
    ['the local machine by name', 'http://localhost/'],
    ['the local machine by address, with a port', 'http://127.0.0.1:3000'],
    ['the local machine by name, with a port', 'localhost:3001'],
    ['an IPv6 loopback', 'http://[::1]/'],
    ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data'],
    ['a name on the local network', 'https://printer.local/'],
  ])(
    'refuses a website on %s with the sentence, and saves and fetches nothing',
    async (_name, url) => {
      const { service, repository, readsMade } = build();

      await expect(
        refusalOf(service.create(ORG, USER, { name: 'Acme', websiteUrl: url })),
      ).resolves.toEqual({ status: 422, code: 'competitor_private', message: PRIVATE_SENTENCE });

      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.rows.size).toBe(0);
      expect(readsMade()).toBe(0);
    },
  );

  it('refuses a public name that resolves to a private address', async () => {
    const { service, repository } = build({ dns: { 'intranet.example': ['192.168.1.20'] } });

    const refusal = await refusalOf(
      service.create(ORG, USER, { name: 'Acme', websiteUrl: 'https://intranet.example' }),
    );

    expect(refusal.code).toBe('competitor_private');
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('refuses a name with one public and one private address', async () => {
    const { service } = build({ dns: { 'mixed.example': [PUBLIC_ADDRESS, '10.1.2.3'] } });

    const refusal = await refusalOf(
      service.create(ORG, USER, { name: 'Acme', websiteUrl: 'https://mixed.example' }),
    );

    expect(refusal.code).toBe('competitor_private');
  });

  it('refuses a private feed address and a private Mastodon instance the same way', async () => {
    const { service, repository, readsMade } = build({
      dns: { 'social.intranet.example': ['10.9.9.9'] },
    });

    const feed = await refusalOf(
      service.create(ORG, USER, {
        name: 'Acme',
        websiteUrl: 'https://acme.example',
        feedUrls: ['https://acme.example/feed', 'http://192.168.0.1/feed.xml'],
      }),
    );
    const instance = await refusalOf(
      service.create(ORG, USER, { name: 'Acme', mastodonAcct: 'acme@social.intranet.example' }),
    );

    expect([feed.code, instance.code]).toEqual(['competitor_private', 'competitor_private']);
    expect(repository.create).not.toHaveBeenCalled();
    expect(readsMade()).toBe(0);
  });

  it('records a private address by workspace and reason, never by the address', async () => {
    const { service } = build();

    await refusalOf(service.create(ORG, USER, { name: 'Acme', websiteUrl: 'http://10.0.0.5/' }));

    expect(warn).toHaveBeenCalledWith('discover.competitor_unsafe_url', {
      orgId: ORG,
      reason: 'private_address',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('10.0.0.5');
  });

  it('says a website that does not exist could not be found', async () => {
    const { service, repository } = build({ dns: { 'no-such-site.example': null } });

    await expect(
      refusalOf(service.create(ORG, USER, { name: 'Acme', websiteUrl: 'no-such-site.example' })),
    ).resolves.toEqual({
      status: 422,
      code: 'competitor_unreachable',
      message: 'We could not find that website. Check the address and try again.',
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it.each([
    ['a port on a public site', 'https://acme.example:8443/'],
    ['a scheme that is not the web', 'ftp://acme.example/feed'],
    ['a script', 'javascript:alert(1)'],
    ['credentials in the address', 'https://user:secret@acme.example/'],
  ])('refuses %s as not a web address', async (_name, url) => {
    const { service, repository } = build();

    const refusal = await refusalOf(service.create(ORG, USER, { name: 'Acme', websiteUrl: url }));

    expect(refusal).toMatchObject({ status: 400, code: 'competitor_invalid' });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('refuses the twenty-first competitor with the sentence, before any address is looked at', async () => {
    const { service, repository, engine } = build();
    for (let index = 0; index < MAX_COMPETITORS; index += 1) {
      repository.seed(ORG, { name: `Competitor ${index + 1}` });
    }

    await expect(
      refusalOf(service.create(ORG, USER, { name: 'One Too Many', websiteUrl: 'acme.example' })),
    ).resolves.toEqual({
      status: 422,
      code: 'competitor_limit',
      message: 'You can follow up to 20 competitors.',
    });

    expect(engine.guard).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.rows.size).toBe(MAX_COMPETITORS);
  });

  it('counts only its own live competitors towards the limit', async () => {
    const { service, repository } = build();
    for (let index = 0; index < MAX_COMPETITORS; index += 1) repository.seed(OTHER_ORG);
    for (let index = 0; index < MAX_COMPETITORS - 1; index += 1) repository.seed(ORG);
    const removed = repository.seed(ORG);
    await service.remove(ORG, removed.id);

    await expect(service.create(ORG, USER, { name: 'The Twentieth' })).resolves.toMatchObject({
      name: 'The Twentieth',
    });
  });

  it('refuses with the same sentence when someone else takes the last place first', async () => {
    const { service, repository } = build();
    repository.create.mockResolvedValueOnce({ outcome: 'limit' });

    const refusal = await refusalOf(service.create(ORG, USER, { name: 'Acme' }));

    expect(refusal.code).toBe('competitor_limit');
  });
});

describe('CompetitorsService.list', () => {
  it("answers the workspace's own live competitors and nobody else's", async () => {
    const { service, repository } = build();
    repository.seed(ORG, { name: 'Ours' });
    repository.seed(OTHER_ORG, { name: 'Theirs' });

    const list = await service.list(ORG);

    expect(list.map((competitor) => competitor.name)).toEqual(['Ours']);
  });
});

describe('CompetitorsService.update', () => {
  it('changes what was sent and leaves the rest', async () => {
    const { service, repository } = build();
    const row = repository.seed(ORG);

    const competitor = await service.update(ORG, row.id, {
      feedUrls: ['acme.example/changelog/atom.xml'],
      blueskyHandle: null,
    });

    expect(repository.update).toHaveBeenCalledWith(ORG, row.id, {
      feedUrls: ['https://acme.example/changelog/atom.xml'],
      blueskyHandle: null,
    });
    expect(competitor).toMatchObject({
      name: 'Acme Analytics',
      feedUrls: ['https://acme.example/changelog/atom.xml'],
      blueskyHandle: null,
      youtubeChannelId: 'UCacmeSampleChannel00000',
    });
  });

  it("answers 404 for another workspace's competitor, before any address is looked at", async () => {
    const { service, repository, engine } = build();
    const theirs = repository.seed(OTHER_ORG);

    const refusal = await refusalOf(
      service.update(ORG, theirs.id, { websiteUrl: 'http://10.0.0.5/' }),
    );

    expect(refusal).toMatchObject({ status: 404, message: 'Competitor not found.' });
    expect(engine.guard).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('answers 404 for an id that is not an id, without a query', async () => {
    const { service, repository } = build();

    const refusal = await refusalOf(service.update(ORG, "1' OR '1'='1", { name: 'Acme' }));

    expect(refusal.status).toBe(404);
    expect(repository.find).not.toHaveBeenCalled();
  });

  it('refuses a private website on an edit, and writes nothing', async () => {
    const { service, repository } = build();
    const row = repository.seed(ORG);

    const refusal = await refusalOf(
      service.update(ORG, row.id, { name: 'Renamed', websiteUrl: 'http://127.0.0.1:3000' }),
    );

    expect(refusal).toMatchObject({ status: 422, code: 'competitor_private' });
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.rows.get(row.id)?.name).toBe('Acme Analytics');
  });

  it('answers 404 when the competitor is removed while the edit was on its way', async () => {
    const { service, repository } = build();
    const row = repository.seed(ORG);
    repository.update.mockResolvedValueOnce(null);

    await expect(refusalOf(service.update(ORG, row.id, { name: 'Late' }))).resolves.toMatchObject({
      status: 404,
    });
  });
});

describe('CompetitorsService.remove', () => {
  it('removes softly, and the id answers 404 from then on', async () => {
    const { service, repository } = build();
    const row = repository.seed(ORG);

    await service.remove(ORG, row.id);

    expect(repository.rows.get(row.id)?.deleted).toBe(true);
    await expect(refusalOf(service.items(ORG, row.id))).resolves.toMatchObject({ status: 404 });
    await expect(refusalOf(service.remove(ORG, row.id))).resolves.toMatchObject({ status: 404 });
    await expect(refusalOf(service.update(ORG, row.id, { name: 'X' }))).resolves.toMatchObject({
      status: 404,
    });
    await expect(service.list(ORG)).resolves.toEqual([]);
  });

  it("answers 404 for another workspace's competitor and leaves it alone", async () => {
    const { service, repository } = build();
    const theirs = repository.seed(OTHER_ORG);

    await expect(refusalOf(service.remove(ORG, theirs.id))).resolves.toMatchObject({ status: 404 });
    expect(repository.rows.get(theirs.id)?.deleted).toBe(false);
  });

  it('answers 404 for an id that is not an id, without a query', async () => {
    const { service, repository } = build();

    await expect(refusalOf(service.remove(ORG, '../etc/passwd'))).resolves.toMatchObject({
      status: 404,
    });
    expect(repository.softDelete).not.toHaveBeenCalled();
  });
});

describe('CompetitorsService.discoverFeeds', () => {
  /** The engine's fetch over the hand-written sample site, counted. */
  function withSampleSite() {
    const built = build();
    const fixtures = createFixtureFetch();
    built.engine.fetch.mockImplementation(fixtures);
    return built;
  }

  it('finds the two feeds the sample website links, with one request', async () => {
    const { service, engine } = withSampleSite();

    const feeds = await service.discoverFeeds(ORG, 'acme.example');

    expect(feeds).toEqual([
      { url: COMPETITOR_SAMPLE.blogFeed, title: 'Blog', kind: 'rss' },
      { url: COMPETITOR_SAMPLE.changelogFeed, title: 'Changelog', kind: 'atom' },
    ]);
    expect(engine.fetch).toHaveBeenCalledTimes(1);
    expect(engine.fetch.mock.calls[0][0]).toBe(COMPETITOR_SAMPLE.website);
  });

  it('checks the address before the page is asked for, and refuses a private one with no request', async () => {
    const { service, engine } = withSampleSite();

    await expect(refusalOf(service.discoverFeeds(ORG, 'http://127.0.0.1:3000'))).resolves.toEqual({
      status: 422,
      code: 'competitor_private',
      message: PRIVATE_SENTENCE,
    });
    expect(engine.fetch).not.toHaveBeenCalled();
  });

  it('leaves out a feed the page links on a private address', async () => {
    const { service, engine } = build();
    engine.fetch.mockResolvedValue({
      status: 200,
      finalUrl: 'https://acme.example/',
      body: [
        '<link rel="alternate" type="application/rss+xml" title="Inside" href="http://10.0.0.7/feed.xml">',
        '<link rel="alternate" type="application/rss+xml" title="Local" href="http://localhost/feed">',
        '<link rel="alternate" type="application/rss+xml" title="Blog" href="/blog/rss.xml">',
      ].join(''),
    });

    const feeds = await service.discoverFeeds(ORG, 'https://acme.example');

    expect(feeds).toEqual([
      { url: 'https://acme.example/blog/rss.xml', title: 'Blog', kind: 'rss' },
    ]);
  });

  it('answers an empty list for a site with no feed, a page that is missing and a site that is down', async () => {
    const { service, engine } = build();

    engine.fetch.mockResolvedValue({ status: 404, body: '', finalUrl: 'https://acme.example/' });
    await expect(service.discoverFeeds(ORG, 'https://acme.example')).resolves.toEqual([]);

    engine.fetch.mockResolvedValue({
      status: 200,
      body: '<html><head><title>No feeds here</title></head></html>',
      finalUrl: 'https://plain.example/',
    });
    await expect(service.discoverFeeds(ORG, 'https://plain.example')).resolves.toEqual([]);

    engine.fetch.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(service.discoverFeeds(ORG, 'https://down.example')).resolves.toEqual([]);
  });

  it('refuses a public address that redirects into a private network', async () => {
    const { service, engine } = build();
    engine.fetch.mockRejectedValue(
      new SeoCrawlError('unsafe_url', 'Refused.', false, { reason: 'private_address' }),
    );

    await expect(
      refusalOf(service.discoverFeeds(ORG, 'https://redirects.example')),
    ).resolves.toMatchObject({ status: 422, code: 'competitor_private' });
  });

  it('allows five a minute per workspace, and the sixth makes no request', async () => {
    const { service, engine } = withSampleSite();

    for (let call = 0; call < FEED_DISCOVERY_PER_MINUTE; call += 1) {
      await service.discoverFeeds(ORG, 'acme.example');
    }
    const requests = engine.fetch.mock.calls.length;

    await expect(refusalOf(service.discoverFeeds(ORG, 'acme.example'))).resolves.toEqual({
      status: 429,
      code: 'competitor_throttled',
      message: 'Try again in a moment.',
    });
    expect(engine.fetch).toHaveBeenCalledTimes(requests);
    // Another workspace has a count of its own.
    await expect(service.discoverFeeds(OTHER_ORG, 'acme.example')).resolves.toHaveLength(2);

    await jest.advanceTimersByTimeAsync(61_000);
    await expect(service.discoverFeeds(ORG, 'acme.example')).resolves.toHaveLength(2);
  });

  it('refuses something that is not an address before it counts', async () => {
    const { service, redis } = build();

    await expect(
      refusalOf(service.discoverFeeds(ORG, 'javascript:alert(1)')),
    ).resolves.toMatchObject({ status: 400, code: 'competitor_invalid' });
    expect(redis.keys).toEqual([]);
  });
});

describe('CompetitorsService.items', () => {
  it('reads every place the competitor publishes, newest first, each with a brief of our own', async () => {
    const { service, repository, engine } = build();
    const row = repository.seed(ORG);

    const answer = await service.items(ORG, row.id);

    expect(answer.items.map((item) => [item.source.id, item.title])).toEqual([
      ['bluesky', 'A Bluesky post'],
      ['google-news', 'A story about them'],
      ['rss', 'A blog post'],
      ['mastodon', 'A Mastodon post'],
      ['youtube', 'A video'],
    ]);
    expect(answer).toMatchObject({ unavailable: [], notes: [], stale: false });
    expect(answer.items.every((item) => item.kind === 'competitor' && item.id.length > 0)).toBe(
      true,
    );
    expect(answer.items[2].brief).toBe(
      "Acme Analytics published: 'A blog post'. Write our own take on this topic for our audience, not a summary of theirs.",
    );
    expect(answer.items[1].brief).toContain('News about Acme Analytics');

    expect(engine.feeds.read).toHaveBeenCalledWith(
      'https://acme.example/blog/rss.xml',
      expect.any(AbortSignal),
    );
    expect(engine.youtube.read).toHaveBeenCalledWith(
      'UCacmeSampleChannel00000',
      expect.any(AbortSignal),
    );
    expect(engine.bluesky.read).toHaveBeenCalledWith('acme.example', expect.any(AbortSignal));
    expect(engine.mastodon.read).toHaveBeenCalledWith(
      'acme@mastodon.example',
      expect.any(AbortSignal),
    );
  });

  it('searches the news for the name unless a phrase was saved, in the edition the workspace reads', async () => {
    const chennai: SettingsRow = {
      countryCode: 'IN',
      regionCode: 'IN-TN',
      regionName: 'Tamil Nadu',
      city: 'Chennai',
      timeZone: 'Asia/Kolkata',
      languages: ['ta', 'en'],
      topics: [],
      sources: null,
      locationSource: 'SEARCH',
      updatedAt: NOW,
    };
    const { service, repository, engine } = build({ settings: chennai });
    const byName = repository.seed(ORG, { name: 'Acme Analytics', newsQuery: null });
    const byPhrase = repository.seed(ORG, { name: 'Globex', newsQuery: 'Globex Corporation' });

    await service.items(ORG, byName.id);
    await service.items(ORG, byPhrase.id);

    const calls = engine.news.search.mock.calls as unknown as [
      string,
      { locality: { countryCode: string | null }; language: string },
    ][];
    expect(calls.map(([phrase]) => phrase)).toEqual(['Acme Analytics', 'Globex Corporation']);
    expect(calls[0][1].locality.countryCode).toBe('IN');
    expect(calls[0][1].language).toBe('ta');
  });

  it('reads a competitor that has only a name through the news alone', async () => {
    const { service, repository, engine, readsMade } = build();
    const row = repository.seed(ORG, {
      feedUrls: [],
      youtubeChannelId: null,
      blueskyHandle: null,
      mastodonAcct: null,
    });

    const answer = await service.items(ORG, row.id);

    expect(answer.items.map((item) => item.source.id)).toEqual(['google-news']);
    expect(engine.news.search).toHaveBeenCalledTimes(1);
    expect(readsMade()).toBe(1);
  });

  it('answers from its copy for thirty minutes, and writes the copy to Redis only', async () => {
    const { service, repository, redis, readsMade } = build();
    const row = repository.seed(ORG);

    await service.items(ORG, row.id);
    const reads = readsMade();
    await jest.advanceTimersByTimeAsync(29 * MINUTE);
    const again = await service.items(ORG, row.id);

    expect(readsMade()).toBe(reads);
    expect(again.stale).toBe(false);
    expect(redis.keys.some((key) => key.startsWith(`discover:competitor:${row.id}:`))).toBe(true);
    // The row learns when it was checked, and nothing a source said.
    expect(repository.noteCheck).toHaveBeenCalledTimes(1);
    expect(repository.noteCheck).toHaveBeenCalledWith(ORG, row.id, {
      lastCheckedAt: NOW,
      lastError: null,
    });
  });

  it('keeps simulated and real copies apart', async () => {
    const real = build();
    const row = real.repository.seed(ORG);
    await real.service.items(ORG, row.id);

    expect(real.redis.keys.every((key) => !key.includes(':sim:'))).toBe(true);
  });

  it('shows one failing feed as a note and leaves everything else alone', async () => {
    const { service, repository, engine } = build();
    const row = repository.seed(ORG);
    engine.youtube.read.mockResolvedValue(failed('upstream'));

    const answer = await service.items(ORG, row.id);

    expect(answer.unavailable).toEqual(['youtube']);
    expect(answer.notes).toEqual(['YouTube could not be reached.']);
    expect(answer.items.map((item) => item.source.id).sort()).toEqual([
      'bluesky',
      'google-news',
      'mastodon',
      'rss',
    ]);
    expect(repository.noteCheck).toHaveBeenCalledWith(ORG, row.id, {
      lastCheckedAt: NOW,
      lastError: 'YouTube could not be reached.',
    });
  });

  it('keeps what a failing source had, and says how old that is', async () => {
    const { service, repository, engine } = build();
    const row = repository.seed(ORG);
    await service.items(ORG, row.id);

    // Past the window: the old copy answers at once and a refresh starts behind it.
    engine.youtube.read.mockResolvedValue(failed('upstream'));
    await jest.advanceTimersByTimeAsync(COMPETITOR_FRESH_MS + MINUTE);
    const stale = await service.items(ORG, row.id);
    expect(stale).toMatchObject({ stale: true, notes: [] });
    await settle();

    await jest.advanceTimersByTimeAsync(89 * MINUTE);
    const answer = await service.items(ORG, row.id);

    expect(answer.notes).toEqual([
      'YouTube could not be reached. Showing what we had from 2 hours ago.',
    ]);
    expect(answer.unavailable).toEqual(['youtube']);
    // The video is still on the list, with everything the other sources just gave.
    expect(answer.items.map((item) => item.title)).toContain('A video');
    expect(answer.items).toHaveLength(5);
  });

  it('says "could not be read" for a feed that answered with something else', async () => {
    const { service, repository, engine } = build();
    const row = repository.seed(ORG);
    engine.feeds.read.mockResolvedValue(failed('not_found', true));

    const answer = await service.items(ORG, row.id);

    expect(answer.notes).toEqual(['Blog could not be read.']);
    expect(repository.rows.get(row.id)?.lastError).toBe('Blog could not be read.');
  });

  it('writes one note for the blog when two of its feeds fail, in the order the kinds read', async () => {
    const { service, repository, engine } = build();
    const row = repository.seed(ORG, {
      feedUrls: ['https://acme.example/a.xml', 'https://acme.example/b.xml'],
    });
    engine.feeds.read.mockResolvedValue(failed('not_found'));
    engine.news.search.mockResolvedValue(failed('upstream'));

    const answer = await service.items(ORG, row.id);

    expect(answer.unavailable).toEqual(['blog', 'news']);
    expect(answer.notes).toEqual(['Blog could not be reached.', 'News could not be reached.']);
    // One sentence in the row, never a list and never a body.
    expect(repository.rows.get(row.id)?.lastError).toBe('Blog could not be reached.');
  });

  it('asks a troubled source again after a minute, not after thirty', async () => {
    const { service, repository, engine } = build();
    const row = repository.seed(ORG);
    engine.youtube.read.mockResolvedValueOnce(failed('upstream'));

    await service.items(ORG, row.id);
    await jest.advanceTimersByTimeAsync(59_000);
    await service.items(ORG, row.id);
    await settle();
    expect(engine.youtube.read).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(2_000);
    await service.items(ORG, row.id);
    await settle();
    expect(engine.youtube.read).toHaveBeenCalledTimes(2);

    await expect(service.items(ORG, row.id)).resolves.toMatchObject({ notes: [] });
  });

  it('rests a host after three failures in a row, and counts only real trouble', async () => {
    const { service, repository, engine } = build();
    const first = repository.seed(ORG, { name: 'One', feedUrls: ['https://down.example/1.xml'] });
    const second = repository.seed(ORG, { name: 'Two', feedUrls: ['https://down.example/2.xml'] });
    const third = repository.seed(ORG, { name: 'Three', feedUrls: ['https://down.example/3.xml'] });
    const fourth = repository.seed(ORG, { name: 'Four', feedUrls: ['https://down.example/4.xml'] });
    const elsewhere = repository.seed(ORG, {
      name: 'Five',
      feedUrls: ['https://up.example/5.xml'],
    });
    engine.feeds.read.mockResolvedValue(failed('upstream'));

    for (const row of [first, second, third]) await service.items(ORG, row.id);
    expect(engine.feeds.read).toHaveBeenCalledTimes(3);

    // The fourth feed on that host is not asked at all, and still gets its note.
    const rested = await service.items(ORG, fourth.id);
    expect(engine.feeds.read).toHaveBeenCalledTimes(3);
    expect(rested.notes).toEqual(['Blog could not be reached.']);

    // Another host is unaffected.
    await service.items(ORG, elsewhere.id);
    expect(engine.feeds.read).toHaveBeenCalledTimes(4);
  });

  it('does not count a feed that is simply not there towards a rest', async () => {
    const { service, repository, engine } = build();
    engine.feeds.read.mockResolvedValue(failed('not_found'));

    for (let index = 0; index < 5; index += 1) {
      const row = repository.seed(ORG, { feedUrls: [`https://quiet.example/${index}.xml`] });
      await service.items(ORG, row.id);
    }

    expect(engine.feeds.read).toHaveBeenCalledTimes(5);
  });

  it('reads the new list straight away after an edit, never the copy of the old one', async () => {
    const { service, repository, engine } = build();
    const row = repository.seed(ORG, {
      feedUrls: ['https://acme.example/blog/rss.xml', 'https://acme.example/changelog/atom.xml'],
    });
    engine.feeds.read.mockImplementation(async (reference: string) =>
      ok([post('rss', `From ${String(reference)}`, 10)]),
    );

    const before = await service.items(ORG, row.id);
    expect(before.items.filter((item) => item.source.id === 'rss')).toHaveLength(2);

    // Seconds later, inside the first fetch's lock.
    await jest.advanceTimersByTimeAsync(5_000);
    await service.update(ORG, row.id, { feedUrls: ['https://acme.example/blog/rss.xml'] });
    const after = await service.items(ORG, row.id);

    expect(
      after.items.filter((item) => item.source.id === 'rss').map((item) => item.title),
    ).toEqual(['From https://acme.example/blog/rss.xml']);
  });

  it('shows at most five from one source and fifteen in all, and no post twice', async () => {
    const { service, repository, engine } = build();
    const row = repository.seed(ORG, {
      feedUrls: ['https://acme.example/a.xml', 'https://acme.example/b.xml'],
    });
    const many = (source: SourceItem['source']['id']) =>
      Array.from({ length: 10 }, (_, index) => post(source, `${source} ${index}`, index + 1));
    // Both feeds carry the same ten posts.
    engine.feeds.read.mockResolvedValue(ok(many('rss')));
    engine.youtube.read.mockResolvedValue(ok(many('youtube')));
    engine.bluesky.read.mockResolvedValue(ok(many('bluesky')));
    engine.mastodon.read.mockResolvedValue(ok(many('mastodon')));

    const answer = await service.items(ORG, row.id);

    expect(answer.items).toHaveLength(ITEMS_PER_COMPETITOR);
    expect(new Set(answer.items.map((item) => item.id)).size).toBe(ITEMS_PER_COMPETITOR);
    const bySource = new Map<string, number>();
    for (const item of answer.items) {
      bySource.set(item.source.id, (bySource.get(item.source.id) ?? 0) + 1);
    }
    expect(Math.max(...bySource.values())).toBeLessThanOrEqual(ITEMS_PER_SOURCE);
  });

  it('says it is still waiting, and never "nothing new", when the gate was full and there is no copy', async () => {
    const gate = new DiscoverGate(1, 10);
    const { service, repository, engine } = build({ gate });
    const row = repository.seed(ORG, {
      feedUrls: [],
      youtubeChannelId: null,
      blueskyHandle: null,
      mastodonAcct: null,
    });
    const held = await gate.acquire();

    const waiting = service.items(ORG, row.id);
    await jest.advanceTimersByTimeAsync(20);
    const answer = await waiting;
    held?.();

    expect(answer).toMatchObject({ items: [], unavailable: [], notes: [], pending: true });
    expect(engine.news.search).not.toHaveBeenCalled();

    // Asked again once the lock allows, with a free slot: the real answer.
    await jest.advanceTimersByTimeAsync(21_000);
    await service.items(ORG, row.id);
    await settle();
    const later = await service.items(ORG, row.id);

    expect(later.pending).toBe(false);
    expect(later.items).toHaveLength(1);
  });

  it('keeps its copy without a note when the gate is full, and is not waiting for anything', async () => {
    const gate = new DiscoverGate(1, 10);
    const { service, repository } = build({ gate });
    const row = repository.seed(ORG);
    const first = await service.items(ORG, row.id);
    expect(first).toMatchObject({ pending: false });

    await jest.advanceTimersByTimeAsync(COMPETITOR_FRESH_MS + MINUTE);
    const held = await gate.acquire();
    await service.items(ORG, row.id);
    await jest.advanceTimersByTimeAsync(50);
    held?.();
    const answer = await service.items(ORG, row.id);

    expect(answer).toMatchObject({ unavailable: [], notes: [], pending: false });
    expect(answer.items).toHaveLength(5);
  });

  it('says it is still waiting when someone else is reading the same competitor', async () => {
    const { service, repository, engine } = build();
    const row = repository.seed(ORG);
    let finish: (result: SourceResult) => void = () => undefined;
    engine.youtube.read.mockImplementation(
      () =>
        new Promise<SourceResult>((resolve) => {
          finish = resolve;
        }),
    );

    const first = service.items(ORG, row.id);
    await jest.advanceTimersByTimeAsync(10);
    // A second look while the first is still out: Refresh, a teammate, the tab reopened.
    const second = service.items(ORG, row.id);
    await jest.advanceTimersByTimeAsync(3_500);

    await expect(second).resolves.toMatchObject({
      items: [],
      unavailable: [],
      notes: [],
      pending: true,
    });

    finish(ok([post('youtube', 'A video', 120)]));
    await expect(first).resolves.toMatchObject({ pending: false });
  });

  it('limits how many competitors a workspace can make the server read in a minute', async () => {
    const { service, repository, readsMade } = build();
    const rows = Array.from({ length: COMPETITOR_READS_PER_MINUTE + 1 }, (_, index) =>
      repository.seed(ORG, {
        name: `Competitor ${index}`,
        feedUrls: [],
        youtubeChannelId: null,
        blueskyHandle: null,
        mastodonAcct: null,
      }),
    );

    for (const row of rows.slice(0, COMPETITOR_READS_PER_MINUTE)) await service.items(ORG, row.id);
    const reads = readsMade();
    expect(reads).toBe(COMPETITOR_READS_PER_MINUTE);

    await expect(refusalOf(service.items(ORG, rows[rows.length - 1].id))).resolves.toEqual({
      status: 429,
      code: 'competitor_throttled',
      message: 'Try again in a moment.',
    });
    expect(readsMade()).toBe(reads);

    // One it already has a copy of costs nothing, so it still answers.
    await expect(service.items(ORG, rows[0].id)).resolves.toMatchObject({ pending: false });
    // And another workspace has a count of its own.
    const theirs = repository.seed(OTHER_ORG);
    await expect(service.items(OTHER_ORG, theirs.id)).resolves.toMatchObject({ pending: false });

    await jest.advanceTimersByTimeAsync(61_000);
    await expect(service.items(ORG, rows[rows.length - 1].id)).resolves.toMatchObject({
      pending: false,
    });
  });

  it('counts an edit as a new read, so saving in a loop cannot hammer anyone', async () => {
    const { service, repository } = build();
    const row = repository.seed(ORG, { feedUrls: [] });

    let refused = 0;
    for (let round = 0; round < COMPETITOR_READS_PER_MINUTE + 5; round += 1) {
      await service.update(ORG, row.id, { feedUrls: [`https://acme.example/${round}.xml`] });
      await service.items(ORG, row.id).catch(() => {
        refused += 1;
      });
    }

    expect(refused).toBe(5);
  });

  it('still answers when the row cannot be noted', async () => {
    const { service, repository } = build();
    const row = repository.seed(ORG);
    repository.noteCheck.mockRejectedValue(new Error('The database is away.'));

    await expect(service.items(ORG, row.id)).resolves.toMatchObject({ unavailable: [] });
  });

  it("answers 404 for another workspace's competitor, an unknown id and a malformed one, with no read", async () => {
    const { service, repository, readsMade } = build();
    const theirs = repository.seed(OTHER_ORG);

    for (const id of [theirs.id, MISSING_ID, 'not-an-id']) {
      await expect(refusalOf(service.items(ORG, id))).resolves.toMatchObject({
        status: 404,
        message: 'Competitor not found.',
      });
    }
    expect(readsMade()).toBe(0);
  });
});

describe('CompetitorsService: refused addresses are counted (Module 09)', () => {
  const PRIVATE_SITE = 'http://10.0.0.1/';

  it('answers 429 after thirty refusals in a minute, before the guard runs again', async () => {
    const { service, engine, repository, readsMade } = build();

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await expect(
        refusalOf(service.create(ORG, USER, { name: 'Acme', websiteUrl: PRIVATE_SITE })),
      ).resolves.toMatchObject({ status: 422, code: 'competitor_private' });
    }
    expect(engine.guard).toHaveBeenCalledTimes(30);

    await expect(refusalOf(service.discoverFeeds(ORG, PRIVATE_SITE))).resolves.toEqual({
      status: 429,
      code: 'competitor_throttled',
      message: 'Try again in a moment.',
    });
    await expect(
      refusalOf(service.create(ORG, USER, { name: 'Acme', websiteUrl: 'https://acme.example' })),
    ).resolves.toMatchObject({ status: 429, code: 'competitor_throttled' });

    expect(engine.guard).toHaveBeenCalledTimes(30);
    expect(repository.create).not.toHaveBeenCalled();
    expect(readsMade()).toBe(0);
  });

  it('counts each workspace on its own, and starts again after a minute', async () => {
    const { service, redis } = build();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await refusalOf(service.create(ORG, USER, { name: 'Acme', websiteUrl: PRIVATE_SITE }));
    }
    expect(redis.read(`discover:addrrefused:${ORG}`)).toBe('30');

    await expect(
      service.create(OTHER_ORG, USER, { name: 'Acme', websiteUrl: 'https://acme.example' }),
    ).resolves.toBeDefined();

    jest.advanceTimersByTime(61_000);
    await expect(
      refusalOf(service.create(ORG, USER, { name: 'Acme', websiteUrl: PRIVATE_SITE })),
    ).resolves.toMatchObject({ status: 422, code: 'competitor_private' });
    await expect(
      service.create(ORG, USER, { name: 'Acme', websiteUrl: 'https://acme.example' }),
    ).resolves.toBeDefined();
  });

  it('does not count an address that was fine', async () => {
    const { service, redis } = build();

    await service.create(ORG, USER, { name: 'Acme', websiteUrl: 'https://acme.example' });

    expect(redis.keys).not.toContain(`discover:addrrefused:${ORG}`);
  });
});
