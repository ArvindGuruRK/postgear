/**
 * The Create Post sheet: the brief as it will be sent, the chip's language,
 * the request body (brief as topic, language, the card's own headlines as
 * sources, the channels), a channel required before anything is asked, Draft
 * With AI disabled with the reset date when the balance cannot cover it, the
 * result's Open In Composer landing on the draft with `publishAt` as its
 * date, and the AI page's own message when no model is set up.
 */
import '@testing-library/jest-dom';
import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api } from '@/lib/api';
import { streamEvents } from '@/lib/sse';
import type { AiCredits, AiStatus, GenerateRequestBody, GenerateStreamEvent } from '@/types/ai';
import type { Channel } from '@/types/channel';
import type { DiscoverItem, Locality } from '@/types/discover';
import { stubBrowserLayout } from '../workflows/fields/test-dom';
import { CHANNEL_REQUIRED, CreatePostSheet, type CreatePostTarget } from './create-post-sheet';

const push = jest.fn();

jest.mock('next/navigation', () => ({
  usePathname: () => '/org-a/discover',
  useRouter: () => ({ push, replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: jest.fn() };
});

jest.mock('@/lib/sse', () => ({ streamEvents: jest.fn() }));

const mockedApi = api as jest.MockedFunction<typeof api>;
const mockedStream = streamEvents as jest.MockedFunction<typeof streamEvents>;

beforeAll(stubBrowserLayout);


const CHENNAI: Locality = {
  countryCode: 'IN',
  countryName: 'India',
  regionCode: 'IN-TN',
  regionName: 'Tamil Nadu',
  city: 'Chennai',
  timeZone: 'Asia/Kolkata',
  languages: ['ta', 'en'],
  newsLanguages: ['ta', 'en'],
};

const STORY: DiscoverItem = {
  id: 'n1',
  kind: 'news',
  source: { id: 'google-news', name: 'Nakkheeran' },
  title: 'சென்னையில் கனமழை',
  opaqueUrl: 'https://news.google.com/rss/articles/abc',
  language: 'ta',
  related: [
    {
      title: 'Heavy rain alert for Chennai',
      url: 'https://www.thehindu.com/rain',
      source: 'The Hindu',
    },
    { title: 'Bad link', url: 'javascript:alert(1)', source: 'Nobody' },
  ],
  brief: 'Story in Chennai: "சென்னையில் கனமழை" (Nakkheeran).',
};

const CHANNEL: Channel = {
  id: 'ch_li',
  name: 'Acme on LinkedIn',
  providerIdentifier: 'linkedin',
  providerName: 'LinkedIn',
  picture: null,
  health: 'connected',
  color: 0,
} as unknown as Channel;

const STATUS: AiStatus = {
  configured: true,
  mode: 'simulation',
  model: 'simulation',
  research: true,
  images: true,
};

function credits(remaining: number): AiCredits {
  return {
    allowance: 50,
    used: 50 - remaining,
    remaining,
    resetsAt: '2026-12-01T00:00:00.000Z',
    tier: 'STANDARD',
    low: remaining < 10,
    costs: {
      generate_post: 5,
      generate_image: 10,
      copilot_message: 1,
      seo_advice: 3,
      generate_snippet: 2,
    },
  };
}

function answer(options: { channels?: Channel[]; status?: AiStatus; remaining?: number } = {}) {
  mockedApi.mockImplementation((path: string) => {
    if (path === '/channels') return Promise.resolve({ channels: options.channels ?? [CHANNEL] });
    if (path === '/channels/providers') {
      return Promise.resolve({
        providers: [{ identifier: 'linkedin', name: 'LinkedIn', rules: { maxLength: 3000 } }],
      });
    }
    if (path === '/ai/status') return Promise.resolve({ status: options.status ?? STATUS });
    if (path === '/ai/credits') {
      return Promise.resolve({ credits: credits(options.remaining ?? 44) });
    }
    if (path === '/posts') return Promise.resolve({ post: { id: 'p1', group: 'g1' } });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

/** A run as the simulated engine streams it: research, hook, the parts, done. */
function streamADraft(publishAt?: string) {
  mockedStream.mockImplementation(async (_path, body, options) => {
    const request = body as GenerateRequestBody;
    const emit = (event: GenerateStreamEvent) => options?.onEvent?.(event as never);
    const hook = 'Chennai is watching the sky today.';
    const parts = [
      {
        text: `${hook}\n(written in ${request.language})\nStay safe.`,
        imagePrompt: null,
        image: null,
      },
    ];
    emit({ type: 'research', sources: request.sources ?? [] });
    emit({ type: 'hook', hook });
    emit({ type: 'content', parts });
    emit({
      type: 'done',
      result: {
        tone: request.tone,
        format: request.format,
        category: 'News',
        hook,
        parts,
        sources: request.sources ?? [],
        researched: true,
      },
      credits: credits(39),
      ...(publishAt ? { publishAt } : {}),
    });
  });
}

/** A run that never finishes on its own, failing only when its signal aborts, like a real fetch. */
function streamForever() {
  const seen: { signal?: AbortSignal } = {};
  mockedStream.mockImplementation(
    (_path, _body, options) =>
      new Promise<void>((_resolve, reject) => {
        seen.signal = options?.signal;
        options?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      }),
  );
  return seen;
}

function renderSheet(target: CreatePostTarget | null) {
  const onClose = jest.fn();
  const view = render(
    <TooltipProvider>
      <CreatePostSheet orgId="org-a" target={target} onClose={onClose} />
    </TooltipProvider>,
  );
  return { ...view, onClose };
}

const TARGET: CreatePostTarget = { item: STORY, place: CHENNAI, language: 'ta' };

beforeEach(() => {
  mockedApi.mockReset();
  mockedStream.mockReset();
  push.mockReset();
  answer();
});

describe('CreatePostSheet', () => {
  it('shows the brief as it will be sent, the chip language and the channels', async () => {
    renderSheet(TARGET);

    const sheet = await screen.findByTestId('create-post-sheet');
    expect(within(sheet).getByRole('heading', { name: /^Create Post( for |$)/ })).toBeInTheDocument();
    expect(await within(sheet).findByTestId('create-post-brief')).toHaveTextContent(STORY.brief);
    expect(within(sheet).getByTestId('create-post-brief')).toHaveAttribute('dir', 'auto');
    expect(within(sheet).getByTestId('create-post-language')).toHaveTextContent('தமிழ் Tamil');
    // The only connected channel is picked already.
    expect(within(sheet).getByRole('button', { name: /Acme on LinkedIn/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      await within(sheet).findByRole('button', { name: 'Draft With AI (5 Credits)' }),
    ).toBeEnabled();
  });

  it('sends the brief, the language, the card headlines and the channels', async () => {
    streamADraft();
    renderSheet(TARGET);

    const button = await screen.findByRole('button', { name: 'Draft With AI (5 Credits)' });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockedStream).toHaveBeenCalledTimes(1);
    const [path, body] = mockedStream.mock.calls[0];
    expect(path).toBe('/ai/generate');
    expect(body).toEqual({
      topic: STORY.brief,
      tone: 'personal',
      format: 'one_short',
      withImage: false,
      channelIds: ['ch_li'],
      language: 'ta',
      sources: [
        {
          title: STORY.title,
          url: 'https://news.google.com/rss/articles/abc',
          snippet: 'Nakkheeran',
        },
        {
          title: 'Heavy rain alert for Chennai',
          url: 'https://www.thehindu.com/rain',
          snippet: 'The Hindu',
        },
      ],
    });
  });

  it('asks for a channel before anything is sent', async () => {
    answer({ channels: [CHANNEL, { ...CHANNEL, id: 'ch_x', name: 'Acme on X' } as Channel] });
    renderSheet(TARGET);

    const button = await screen.findByRole('button', { name: 'Draft With AI (5 Credits)' });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(screen.getByText(CHANNEL_REQUIRED)).toBeInTheDocument();
    expect(mockedStream).not.toHaveBeenCalled();
  });

  it('disables Draft With AI with the reset date when the balance cannot cover it', async () => {
    answer({ remaining: 3 });
    renderSheet(TARGET);

    const alert = await screen.findByTestId('create-post-no-credits');
    expect(alert).toHaveTextContent('This draft costs 5 and 3 remain.');
    expect(alert).toHaveTextContent('Credits reset');
    expect(screen.getByRole('button', { name: 'Draft With AI (5 Credits)' })).toBeDisabled();
  });

  it('shows the result and opens the draft in the composer on its date, closing the sheet', async () => {
    const publishAt = new Date(Date.now() + 3 * 24 * 3600_000).toISOString();
    streamADraft(publishAt);
    const { onClose } = renderSheet({ ...TARGET, publishAt });

    const button = await screen.findByRole('button', { name: 'Draft With AI (5 Credits)' });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockedStream.mock.calls[0][1]).toMatchObject({ publishAt });
    expect(await screen.findByText(/\(written in ta\)/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Backed By Research' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Heavy rain alert for Chennai/ })).toHaveAttribute(
      'href',
      'https://www.thehindu.com/rain',
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open In Composer' }));
    });

    const postCall = mockedApi.mock.calls.find(([path]) => path === '/posts');
    expect(postCall?.[1]).toMatchObject({
      method: 'POST',
      body: {
        state: 'DRAFT',
        publishDate: publishAt,
        channels: [{ channelId: 'ch_li', customized: false }],
      },
    });
    expect(push).toHaveBeenCalledWith('/org-a/composer?group=g1');
    // The composer opens over the page; the sheet does not wait under it.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('goes back to the settings after a draft, keeping them', async () => {
    streamADraft();
    renderSheet(TARGET);

    const button = await screen.findByRole('button', { name: 'Draft With AI (5 Credits)' });
    await act(async () => {
      fireEvent.click(button);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Settings' }));

    expect(await screen.findByTestId('create-post-brief')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Acme on LinkedIn/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('keeps what was written when the stream breaks before it finishes', async () => {
    mockedStream.mockImplementation(async (_path, _body, options) => {
      const emit = (event: GenerateStreamEvent) => options?.onEvent?.(event as never);
      emit({ type: 'hook', hook: 'Chennai is watching the sky today.' });
      emit({
        type: 'content',
        parts: [{ text: 'Half a draft.', imagePrompt: null, image: null }],
      });
      // The connection closes here, with no done event.
    });
    renderSheet(TARGET);

    const button = await screen.findByRole('button', { name: 'Draft With AI (5 Credits)' });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(await screen.findByTestId('create-post-broken')).toHaveTextContent(
      "Generation didn't finish",
    );
    expect(screen.getByText('Half a draft.')).toBeInTheDocument();
    expect(screen.queryByTestId('create-post-brief')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Settings' })).toBeInTheDocument();
  });

  it('shows the sentence and the refunded balance when a draft fails after it was charged', async () => {
    const sentence = 'Something went wrong while drafting. Your credits were not used.';
    mockedStream.mockImplementation(async (_path, _body, options) => {
      const emit = (event: GenerateStreamEvent) => options?.onEvent?.(event as never);
      emit({ type: 'hook', hook: 'Chennai is watching the sky today.' });
      // The API refunds before it says so: the balance on the event is the one from before the run.
      emit({
        type: 'error',
        kind: 'unexpected',
        message: sentence,
        retryable: true,
        credits: credits(44),
      });
    });
    renderSheet(TARGET);

    const button = await screen.findByRole('button', { name: 'Draft With AI (5 Credits)' });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(await screen.findByText(sentence)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    // Back at the settings the refunded balance still covers a draft.
    fireEvent.click(screen.getByRole('button', { name: 'Edit Settings' }));
    expect(await screen.findByTestId('create-post-credits')).toHaveTextContent('44');
    expect(screen.getByRole('button', { name: 'Draft With AI (5 Credits)' })).toBeEnabled();
  });

  it('stops the run when the sheet closes', async () => {
    const seen = streamForever();
    const { rerender } = renderSheet(TARGET);

    const button = await screen.findByRole('button', { name: 'Draft With AI (5 Credits)' });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(seen.signal?.aborted).toBe(false);

    await act(async () => {
      rerender(
        <TooltipProvider>
          <CreatePostSheet orgId="org-a" target={null} onClose={jest.fn()} />
        </TooltipProvider>,
      );
    });

    expect(seen.signal?.aborted).toBe(true);
  });

  it('stops the run on Cancel and offers the settings again', async () => {
    const seen = streamForever();
    renderSheet(TARGET);

    const button = await screen.findByRole('button', { name: 'Draft With AI (5 Credits)' });
    await act(async () => {
      fireEvent.click(button);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });

    expect(seen.signal?.aborted).toBe(true);
    expect(await screen.findByRole('button', { name: 'Edit Settings' })).toBeInTheDocument();
  });

  it("shows the AI page's message when no model is set up", async () => {
    answer({ status: { ...STATUS, configured: false, mode: 'unconfigured', model: null } });
    renderSheet(TARGET);

    expect(await screen.findByText("AI isn't set up yet")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Draft With AI/ })).not.toBeInTheDocument();
  });

  it('loads the channels once, however often it opens', async () => {
    const { rerender } = renderSheet(TARGET);
    await screen.findByTestId('create-post-brief');

    rerender(
      <TooltipProvider>
        <CreatePostSheet orgId="org-a" target={null} onClose={jest.fn()} />
      </TooltipProvider>,
    );
    rerender(
      <TooltipProvider>
        <CreatePostSheet orgId="org-a" target={TARGET} onClose={jest.fn()} />
      </TooltipProvider>,
    );
    await screen.findByTestId('create-post-brief');

    await waitFor(() =>
      expect(mockedApi.mock.calls.filter(([path]) => path === '/channels')).toHaveLength(1),
    );
  });

  it('closes on Escape', async () => {
    const { onClose } = renderSheet(TARGET);
    await screen.findByTestId('create-post-brief');

    fireEvent.keyDown(screen.getByTestId('create-post-sheet'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
