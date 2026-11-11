/**
 * Open In Composer (Module 09's fix): the composer opens as a modal over the
 * page that holds this result, so the result is still mounted when the
 * composer closes. The button reads "Opening" from the click until the
 * composer has come and gone, and is offered again once the page is back, so
 * it can never be left stuck and can never make a second draft meanwhile. A
 * click after coming back reopens the draft that was made; only a draft that
 * is gone is made again.
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TooltipProvider } from '@postgear/ui';
import { ApiError, api } from '@/lib/api';
import { stubBrowserLayout } from '../workflows/fields/test-dom';
import { GenerateResult } from './generate-result';
import { type GenerateState, initialGenerateState } from './generate-state';

const push = jest.fn();
let pathname = '/org-a/ai';

jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push, replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: jest.fn() };
});

const mockedApi = api as jest.MockedFunction<typeof api>;

beforeAll(stubBrowserLayout);

/** The three dots the button ends on while it waits, as one character. */
const OPENING = `Opening${String.fromCodePoint(0x2026)}`;

function finished(): GenerateState {
  return {
    ...initialGenerateState(),
    phase: 'done',
    request: {
      topic: 'Rain in the city',
      tone: 'company',
      format: 'one_short',
      withImage: false,
      channelIds: ['ch_li'],
    },
    category: 'News',
    hook: 'The city is watching the sky today.',
    parts: [{ text: 'The city is watching the sky today.', imagePrompt: null, image: null }],
    sources: [],
  };
}

function page() {
  return (
    <TooltipProvider>
      <GenerateResult orgId="org-a" state={finished()} limit={null} onRegenerate={jest.fn()} />
    </TooltipProvider>
  );
}

/** The address changes, as it does when the composer opens over the page and when it closes. */
function goTo(next: string, rerender: (ui: React.ReactElement) => void) {
  pathname = next;
  act(() => rerender(page()));
}

beforeEach(() => {
  pathname = '/org-a/ai';
  push.mockReset();
  mockedApi.mockReset();
  mockedApi.mockResolvedValue({ post: { id: 'p1', group: 'g1' } });
});

describe('GenerateResult, Open In Composer', () => {
  it('makes one draft, goes to the composer and waits as "Opening"', async () => {
    render(page());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open In Composer' }));
    });

    expect(push).toHaveBeenCalledWith('/org-a/composer?group=g1');
    const waiting = screen.getByRole('button', { name: OPENING });
    expect(waiting).toBeDisabled();

    // A second click while it waits makes no second draft.
    fireEvent.click(waiting);
    expect(mockedApi).toHaveBeenCalledTimes(1);
  });

  it('stays "Opening" while the composer is open over the page', async () => {
    const { rerender } = render(page());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open In Composer' }));
    });

    goTo('/org-a/composer', rerender);

    expect(screen.getByRole('button', { name: OPENING })).toBeDisabled();
  });

  it('offers Open In Composer again once the composer has closed', async () => {
    const { rerender } = render(page());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open In Composer' }));
    });
    goTo('/org-a/composer', rerender);

    goTo('/org-a/ai', rerender);

    const again = screen.getByRole('button', { name: 'Open In Composer' });
    expect(again).toBeEnabled();
    expect(screen.queryByRole('button', { name: OPENING })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeEnabled();
  });

  it('reopens the same draft after coming back, and makes no second one', async () => {
    const state = finished();
    const ui = () => (
      <TooltipProvider>
        <GenerateResult orgId="org-a" state={state} limit={null} onRegenerate={jest.fn()} />
      </TooltipProvider>
    );
    const { rerender } = render(ui());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open In Composer' }));
    });
    pathname = '/org-a/composer';
    act(() => rerender(ui()));
    pathname = '/org-a/ai';
    act(() => rerender(ui()));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open In Composer' }));
    });

    const saves = mockedApi.mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(saves).toHaveLength(1);
    expect(mockedApi).toHaveBeenLastCalledWith('/posts/g1');
    expect(push).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenLastCalledWith('/org-a/composer?group=g1');
    expect(screen.getByRole('button', { name: OPENING })).toBeDisabled();
  });

  it('makes the draft again when the first one was deleted in the composer', async () => {
    const state = finished();
    const ui = () => (
      <TooltipProvider>
        <GenerateResult orgId="org-a" state={state} limit={null} onRegenerate={jest.fn()} />
      </TooltipProvider>
    );
    const { rerender } = render(ui());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open In Composer' }));
    });
    pathname = '/org-a/composer';
    act(() => rerender(ui()));
    pathname = '/org-a/ai';
    act(() => rerender(ui()));
    mockedApi.mockReset();
    mockedApi
      .mockRejectedValueOnce(new ApiError('Not found.', 404, 'not_found'))
      .mockResolvedValueOnce({ post: { id: 'p2', group: 'g2' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open In Composer' }));
    });

    expect(push).toHaveBeenLastCalledWith('/org-a/composer?group=g2');
  });

  it('is not unlocked by a change of address that never reached the composer', async () => {
    const { rerender } = render(page());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open In Composer' }));
    });

    goTo('/org-a/ai/history', rerender);

    expect(screen.getByRole('button', { name: OPENING })).toBeDisabled();
  });

  it('offers the button again, with the reason, when the draft is refused', async () => {
    mockedApi.mockRejectedValue(new ApiError('Pick a channel first.', 400, 'bad_request'));
    render(page());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open In Composer' }));
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open In Composer' })).toBeEnabled(),
    );
    expect(screen.getByText('Pick a channel first.')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
