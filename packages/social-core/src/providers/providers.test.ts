/**
 * Per-provider behaviour, with `fetch` mocked — no network.
 *
 * The focus is the parts that are silently wrong rather than loudly broken: a
 * missing `offline.access` scope yields no refresh token and the channel dies a
 * fortnight later; a PKCE challenge sent without its verifier fails only at the
 * token exchange; a refresh that drops a rotated token disconnects the channel
 * permanently on the *next* refresh.
 */
import { validatePost } from '../composer/validate';
import { IntegrationManager } from '../manager/integration.manager';
import { FacebookProvider } from './facebook';
import { InstagramProvider } from './instagram';
import { LinkedInPageProvider, LinkedInProvider } from './linkedin';
import { PinterestProvider } from './pinterest';
import { TikTokProvider } from './tiktok';
import { XProvider } from './twitter';
import { YouTubeProvider } from './youtube';

const REDIRECT = 'http://localhost:3001/channels/connect/x/callback';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  process.env.X_TWITTER_CLIENT_ID = 'x-id';
  process.env.X_TWITTER_CLIENT_SECRET = 'x-secret';
  process.env.LINKEDIN_CLIENT_ID = 'li-id';
  process.env.LINKEDIN_CLIENT_SECRET = 'li-secret';
  process.env.FACEBOOK_APP_ID = 'fb-id';
  process.env.FACEBOOK_APP_SECRET = 'fb-secret';
  process.env.YOUTUBE_CLIENT_ID = 'yt-id';
  process.env.YOUTUBE_CLIENT_SECRET = 'yt-secret';
  process.env.TIKTOK_CLIENT_KEY = 'tt-key';
  process.env.TIKTOK_CLIENT_SECRET = 'tt-secret';
  process.env.PINTEREST_APP_ID = 'pin-id';
  process.env.PINTEREST_APP_SECRET = 'pin-secret';
});

describe('authorization URLs', () => {
  it('X requests offline.access, without which no refresh token is ever issued', async () => {
    const { url, codeVerifier } = await new XProvider().generateAuthUrl(REDIRECT);
    const params = new URL(url).searchParams;

    expect(params.get('scope')).toContain('offline.access');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('code_challenge')).toBeTruthy();
    // The challenge goes to the platform; the verifier stays server-side and
    // must come back at the token exchange.
    expect(params.get('code_challenge')).not.toBe(codeVerifier);
    expect(codeVerifier).toBeTruthy();
  });

  it('YouTube requests offline access and forces the consent screen', async () => {
    const { url } = await new YouTubeProvider().generateAuthUrl(REDIRECT);
    const params = new URL(url).searchParams;

    // Google issues a refresh token only on first consent; without
    // prompt=consent a reconnect silently yields an unrefreshable channel.
    expect(params.get('access_type')).toBe('offline');
    expect(params.get('prompt')).toBe('consent');
  });

  it('TikTok sends client_key rather than client_id', async () => {
    const { url } = await new TikTokProvider().generateAuthUrl(REDIRECT);
    const params = new URL(url).searchParams;

    expect(params.get('client_key')).toBe('tt-key');
    expect(params.get('client_id')).toBeNull();
    expect(params.get('code_challenge_method')).toBe('S256');
  });

  it('LinkedIn page asks for organization scopes the personal provider does not', async () => {
    expect(new LinkedInProvider().scopes).toContain('w_member_social');
    expect(new LinkedInPageProvider().scopes).toContain('w_organization_social');
    expect(new LinkedInPageProvider().scopes).not.toContain('w_member_social');
  });

  it('Meta providers request the publishing scopes their APIs require', async () => {
    expect(new FacebookProvider().scopes).toContain('pages_manage_posts');
    expect(new InstagramProvider().scopes).toContain('instagram_content_publish');
  });
});

describe('token exchange', () => {
  it('X sends the PKCE verifier and Basic auth, and keeps the rotated refresh token', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ access_token: 'at', refresh_token: 'rt-new', expires_in: 7200 }),
      )
      .mockResolvedValueOnce(json({ data: { id: '42', name: 'Demo', username: 'demo' } }));

    const details = await new XProvider().authenticate({
      code: 'code-1',
      codeVerifier: 'verifier-1',
      redirectUri: REDIRECT,
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = new URLSearchParams(init.body as string);

    expect(body.get('code_verifier')).toBe('verifier-1');
    expect(body.get('grant_type')).toBe('authorization_code');
    // X requires HTTP Basic for confidential clients even though the body also
    // carries client_id; sending only one fails with an opaque invalid_request.
    expect(init.headers.Authorization).toMatch(/^Basic /);

    expect(details).toMatchObject({
      id: '42',
      accessToken: 'at',
      refreshToken: 'rt-new',
      username: 'demo',
    });
  });

  it('X persists the newly rotated refresh token rather than the old one', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: 'at2', refresh_token: 'rt-2' }))
      .mockResolvedValueOnce(json({ data: { id: '42', name: 'Demo', username: 'demo' } }));

    const refreshed = await new XProvider().refreshToken('rt-1');

    // X invalidates the old refresh token on use. Keeping it would disconnect
    // the channel at the next refresh.
    expect(refreshed.refreshToken).toBe('rt-2');
  });

  it('YouTube keeps the existing refresh token, which Google does not re-issue', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: 'at2', expires_in: 3600 }))
      .mockResolvedValueOnce(json({ items: [{ id: 'UC1', snippet: { title: 'Chan' } }] }));

    const refreshed = await new YouTubeProvider().refreshToken('rt-original');

    expect(refreshed.refreshToken).toBe('rt-original');
  });

  it('Pinterest sends its client credentials only as HTTP Basic', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: 'at', refresh_token: 'rt' }))
      .mockResolvedValueOnce(json({ username: 'pinner', business_name: 'Pin Co' }));

    await new PinterestProvider().authenticate({
      code: 'c',
      codeVerifier: '',
      redirectUri: REDIRECT,
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = new URLSearchParams(init.body as string);

    expect(init.headers.Authorization).toMatch(/^Basic /);
    expect(body.get('client_id')).toBeNull();
  });

  it('Meta upgrades the short-lived token before storing it', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: 'short-lived' }))
      .mockResolvedValueOnce(json({ access_token: 'long-lived', expires_in: 5_184_000 }))
      .mockResolvedValueOnce(json({ id: 'user-1', name: 'Meta User' }));

    const details = await new FacebookProvider().authenticate({
      code: 'c',
      codeVerifier: '',
      redirectUri: REDIRECT,
    });

    // Skipping the exchange leaves an ~1 hour token, so every channel breaks
    // the same afternoon it is connected.
    expect(details.accessToken).toBe('long-lived');
    expect(details.requiresEntitySelection).toBe(true);
  });

  it('providers that cannot refresh report it with an empty token, not a throw', async () => {
    // One branch then covers both "no refresh support" and "refresh failed".
    await expect(new FacebookProvider().refreshToken('anything')).resolves.toMatchObject({
      accessToken: '',
    });
    await expect(new LinkedInProvider().refreshToken('')).resolves.toMatchObject({
      accessToken: '',
    });
  });
});

describe('entity selection', () => {
  it('Instagram lists only accounts actually linked to a Page', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          data: [
            { id: 'page-1', name: 'Linked Page', access_token: 'page-token-1' },
            { id: 'page-2', name: 'Bare Page', access_token: 'page-token-2' },
          ],
        }),
      )
      .mockResolvedValueOnce(
        json({
          instagram_business_account: {
            id: 'ig-1',
            username: 'shop',
            name: 'Shop',
            followers_count: 1234,
          },
        }),
      )
      // The second page has no Instagram account behind it.
      .mockResolvedValueOnce(json({}));

    const entities = await new InstagramProvider().listEntities('user-token');

    expect(entities).toHaveLength(1);
    expect(entities[0].id).toBe('ig-1');
    // Publishing authorises against the Page's token, not the user's.
    expect(entities[0].accessToken).toBe('page-token-1');
    // The detail line is what distinguishes similarly-named accounts.
    expect(entities[0].detail).toContain('1,234 followers');
  });

  it('Facebook surfaces the page-scoped token that publishing actually needs', async () => {
    const pages = {
      data: [{ id: 'page-1', name: 'My Page', access_token: 'page-token', fan_count: 10 }],
    };
    fetchMock.mockResolvedValueOnce(json(pages)).mockResolvedValueOnce(json(pages));

    const chosen = await new FacebookProvider().selectEntity('user-token', 'page-1');

    expect(chosen.accessToken).toBe('page-token');
  });

  it('rejects an entity the account does not actually own', async () => {
    fetchMock.mockResolvedValue(json({ data: [] }));

    await expect(new FacebookProvider().selectEntity('t', 'someone-elses-page')).rejects.toThrow(
      /not one this account manages/,
    );
  });
});

describe('post validation', () => {
  it('X rejects mixing images and video', async () => {
    const result = await new XProvider().checkValidity([
      {
        id: 'p1',
        message: 'hi',
        media: [
          { type: 'image', path: 'https://e.test/a.jpg' },
          { type: 'video', path: 'https://e.test/a.mp4' },
        ],
      },
    ]);

    expect(result).toMatch(/images or one video/);
  });

  it('Instagram rejects a text-only post', async () => {
    // The rule that catches everyone out: Instagram has no text-only post.
    const result = await new InstagramProvider().checkValidity([{ id: 'p1', message: 'hi' }]);

    expect(result).toMatch(/at least one image or video/);
  });

  it('YouTube requires exactly one video', async () => {
    const result = await new YouTubeProvider().checkValidity([{ id: 'p1', message: 'hi' }]);

    expect(result).toMatch(/exactly one video/);
  });

  it('X allows a plain text post', async () => {
    await expect(new XProvider().checkValidity([{ id: 'p1', message: 'hi' }])).resolves.toBe(true);
  });

  it('X reports a premium character limit only when told the account is premium', () => {
    const provider = new XProvider();

    expect(provider.maxLength()).toBe(280);
    expect(provider.maxLength({ premium: true })).toBeGreaterThan(280);
  });
});

describe('IntegrationManager', () => {
  it('registers all eight channel types under stable identifiers', () => {
    const identifiers = new IntegrationManager().list().map((p) => p.identifier);

    expect(identifiers).toEqual(
      expect.arrayContaining([
        'x',
        'linkedin',
        'linkedin-page',
        'facebook',
        'instagram',
        'youtube',
        'tiktok',
        'pinterest',
      ]),
    );
  });

  it('uses "x" as the identifier even though the folder is named twitter', () => {
    // The identifier is data — it is written to Integration.providerIdentifier
    // and already shipped in the onboarding channel list. Folder names are not.
    expect(new XProvider().identifier).toBe('x');
  });

  it('lists unconfigured providers rather than hiding them', () => {
    process.env.TIKTOK_CLIENT_KEY = '';

    const tiktok = new IntegrationManager().list().find((p) => p.identifier === 'tiktok');

    // A missing key is a deployment gap; hiding the provider makes it look
    // unsupported instead.
    expect(tiktok).toBeDefined();
    expect(tiktok?.configured).toBe(false);
  });

  it('refuses to hand out an unconfigured provider', () => {
    process.env.PINTEREST_APP_ID = '';

    expect(() => new IntegrationManager().get('pinterest')).toThrow(/not configured/);
  });

  it('throws on an unknown identifier', () => {
    expect(() => new IntegrationManager().get('myspace')).toThrow(/Unknown provider/);
  });

  it('flags which providers need a second setup step', () => {
    const providers = new IntegrationManager().list();
    const needsSetup = (id: string) =>
      providers.find((p) => p.identifier === id)?.requiresEntitySelection;

    expect(needsSetup('facebook')).toBe(true);
    expect(needsSetup('instagram')).toBe(true);
    expect(needsSetup('youtube')).toBe(true);
    expect(needsSetup('pinterest')).toBe(true);
    expect(needsSetup('linkedin-page')).toBe(true);
    // These two connect in a single hop.
    expect(needsSetup('x')).toBe(false);
    expect(needsSetup('linkedin')).toBe(false);
  });
});

describe('publishing rules (Sprint 4)', () => {
  const providers = new IntegrationManager().list();

  it('sends every provider’s rules with the provider list, for the composer', () => {
    for (const summary of providers) {
      expect(summary.rules.maxLength).toBeGreaterThan(0);
      expect(['replies', 'comments', 'none']).toContain(summary.rules.thread);
    }
  });

  it('declares a static limit that matches maxLength() for a standard account', () => {
    const manager = new IntegrationManager();

    for (const { identifier } of providers) {
      const provider = manager.find(identifier);
      expect(provider?.rules.maxLength).toBe(provider?.maxLength());
    }
  });

  it('enforces in checkValidity exactly what the rules say, with the same message', async () => {
    const manager = new IntegrationManager();

    for (const { identifier } of providers) {
      const provider = manager.find(identifier);

      if (!provider) {
        throw new Error(`missing ${identifier}`);
      }

      const tooLong = 'a'.repeat(provider.rules.maxLength + 1);
      const kind = provider.rules.media.maxImages > 0 ? ('image' as const) : ('video' as const);
      const media = provider.rules.media.required ? [{ type: kind, path: 'https://e.test/m' }] : [];
      const result = await provider.checkValidity([{ id: 'p1', message: tooLong, media }]);

      expect(result).toBe(
        validatePost(provider.rules, [{ text: tooLong, media }], { providerName: provider.name })[0]
          ?.message,
      );
      expect(result).toMatch(/allows/);
    }
  });

  it('lets an X Premium account past the standard 280 at publish time', async () => {
    const message = 'a'.repeat(300);

    await expect(new XProvider().checkValidity([{ id: 'p1', message }])).resolves.toMatch(/280/);
    await expect(
      new XProvider().checkValidity([{ id: 'p1', message, settings: { premium: true } }]),
    ).resolves.toBe(true);
  });

  it('counts X length the way X does, not by string length', async () => {
    // 140 CJK characters weigh 280 — full, but not over.
    await expect(
      new XProvider().checkValidity([{ id: 'p1', message: '字'.repeat(140) }]),
    ).resolves.toBe(true);
    await expect(
      new XProvider().checkValidity([{ id: 'p1', message: '字'.repeat(141) }]),
    ).resolves.toMatch(/282/);
  });

  it('refuses video where the provider cannot publish it, rather than dropping it later', async () => {
    const withVideo = [
      {
        id: 'p1',
        message: 'hi',
        media: [{ type: 'video' as const, path: 'https://e.test/v.mp4' }],
      },
    ];

    await expect(new LinkedInProvider().checkValidity(withVideo)).resolves.toMatch(
      /can't publish video to LinkedIn/,
    );
    await expect(new PinterestProvider().checkValidity(withVideo)).resolves.toMatch(
      /can't publish video to Pinterest/,
    );
  });

  it('holds Instagram to JPEG and its aspect ratio when the library knows them', async () => {
    const withImage = (extra: Record<string, unknown>) => [
      {
        id: 'p1',
        message: 'hi',
        media: [{ type: 'image' as const, path: 'https://e.test/i', ...extra }],
      },
    ];
    const instagram = new InstagramProvider();

    await expect(
      instagram.checkValidity(withImage({ mimeType: 'image/jpeg', width: 1080, height: 1080 })),
    ).resolves.toBe(true);
    await expect(instagram.checkValidity(withImage({ mimeType: 'image/png' }))).resolves.toMatch(
      /JPEG/,
    );
    await expect(
      instagram.checkValidity(withImage({ width: 1080, height: 2340 })),
    ).resolves.toMatch(/4:5/);
  });

  it('refuses a second part on platforms with no thread structure', async () => {
    const video = [{ type: 'video' as const, path: 'https://e.test/v.mp4' }];

    await expect(
      new YouTubeProvider().checkValidity([
        { id: 'p1', message: 'title', media: video },
        { id: 'p2', message: 'more', media: video },
      ]),
    ).resolves.toMatch(/multi-part/);
  });
});

describe('LinkedIn image publishing (Sprint 4)', () => {
  /** The processing wait is real in production and pointless in a unit test. */
  class InstantLinkedIn extends LinkedInProvider {
    protected override imageProcessingDelayMs = 0;
  }

  class InstantLinkedInPage extends LinkedInPageProvider {
    protected override imageProcessingDelayMs = 0;
  }

  const channel = {
    id: 'ch_1',
    internalId: 'member-1',
    rootInternalId: 'member-1',
    providerIdentifier: 'linkedin',
    name: 'Demo',
  };

  function mockUploads(count: number) {
    for (let index = 0; index < count; index++) {
      fetchMock
        .mockResolvedValueOnce(
          json({
            value: { uploadUrl: `https://upload.test/${index}`, image: `urn:li:image:${index}` },
          }),
        )
        .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
        .mockResolvedValueOnce(new Response(null, { status: 201 }));
    }

    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:99' } }),
    );
  }

  function postBody(): Record<string, unknown> {
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/rest/posts'));

    if (!call) {
      throw new Error('LinkedIn post was never created');
    }

    return JSON.parse(String((call[1] as RequestInit).body));
  }

  it('uploads an image and attaches it, rather than posting the text alone', async () => {
    mockUploads(1);

    const [result] = await new InstantLinkedIn().post(channel, 'token', [
      {
        id: 'p1',
        message: 'hello',
        media: [{ type: 'image', path: 'https://media.test/a.jpg', alt: 'A chart' }],
      },
    ]);

    expect(result.postId).toBe('urn:li:share:99');

    const [initUrl, initInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(initUrl).toContain('/rest/images?action=initializeUpload');
    expect(JSON.parse(String(initInit.body))).toEqual({
      initializeUploadRequest: { owner: 'urn:li:person:member-1' },
    });

    // The bytes come from the media library's public URL and go to LinkedIn's.
    expect(fetchMock.mock.calls[1][0]).toBe('https://media.test/a.jpg');
    expect(fetchMock.mock.calls[2][0]).toBe('https://upload.test/0');
    expect((fetchMock.mock.calls[2][1] as RequestInit).method).toBe('PUT');

    expect(postBody().content).toEqual({ media: { id: 'urn:li:image:0', altText: 'A chart' } });
  });

  it('attaches two or more images as a multi-image post', async () => {
    mockUploads(2);

    await new InstantLinkedIn().post(channel, 'token', [
      {
        id: 'p1',
        message: 'two',
        media: [
          { type: 'image', path: 'https://media.test/a.jpg' },
          { type: 'image', path: 'https://media.test/b.jpg' },
        ],
      },
    ]);

    expect(postBody().content).toEqual({
      multiImage: { images: [{ id: 'urn:li:image:0' }, { id: 'urn:li:image:1' }] },
    });
  });

  it('adds no content block to a text-only post', async () => {
    mockUploads(0);

    await new InstantLinkedIn().post(channel, 'token', [{ id: 'p1', message: 'just text' }]);

    expect(postBody()).not.toHaveProperty('content');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uploads a page’s images as owned by the organization that posts them', async () => {
    mockUploads(1);

    await new InstantLinkedInPage().post(
      { ...channel, internalId: 'org-7', providerIdentifier: 'linkedin-page' },
      'token',
      [
        {
          id: 'p1',
          message: 'hello',
          media: [{ type: 'image', path: 'https://media.test/a.jpg' }],
        },
      ],
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).initializeUploadRequest.owner).toBe(
      'urn:li:organization:org-7',
    );
    expect(postBody().author).toBe('urn:li:organization:org-7');
  });
});
