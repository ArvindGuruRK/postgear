import { TooltipProvider } from '@postgear/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { cameBackFromComposer } from '@/components/composer/composer-return';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { getComingUp } from '@/lib/clips-api';
import type { ComingUpItem, ComingUpView } from '@/types/clips';
import { ComingUp } from './coming-up';
import { COMING_UP_EMPTY, calendarWeekHref, comingUpWhen, moreLine } from './coming-up-model';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
jest.mock('next/navigation', () => ({ usePathname: () => '/org-1/clips' }));
jest.mock('@/lib/clips-api', () => ({ getComingUp: jest.fn() }));

const comingUpMock = getComingUp as jest.MockedFunction<typeof getComingUp>;

function item(n: number, overrides: Partial<ComingUpItem> = {}): ComingUpItem {
  return {
    group: `group-${n}`,
    publishDate: `2026-11-2${n}T18:00:00.000Z`,
    channels: [
      { id: 'yt-1', name: 'Acme Shorts', providerIdentifier: 'youtube', picture: null },
      { id: 'ig-1', name: 'Acme Reels', providerIdentifier: 'instagram-standalone', picture: null },
    ],
    clip: {
      id: `clip-${n}`,
      title: `Clip ${n}`,
      ratio: '9:16',
      durationMs: 42_000,
      videoId: 'video-1',
      poster: null,
    },
    ...overrides,
  };
}

function answer(overrides: Partial<ComingUpView> = {}): ComingUpView {
  return { items: [], total: 0, anyExported: true, ...overrides };
}

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});

beforeEach(() => jest.clearAllMocks());

function show() {
  const onSendAClip = jest.fn();
  const view = render(
    <TooltipProvider>
      <ComingUp orgId="org-1" onSendAClip={onSendAClip} />
    </TooltipProvider>,
  );
  return { onSendAClip, view };
}

describe('coming up model', () => {
  it('says when a post goes out, how many more there are, and which week to open', () => {
    expect(comingUpWhen('2026-11-20T18:00:00.000Z', 'UTC')).toBe('Fri 20 Nov, 6:00 pm');
    expect(comingUpWhen('2026-11-21T09:05:00.000Z', 'UTC')).toBe('Sat 21 Nov, 9:05 am');
    expect(comingUpWhen('not a date')).toBe('');
    expect(moreLine(8, 5)).toBe('and 3 more');
    expect(moreLine(5, 5)).toBeNull();
    const at = new Date(2026, 10, 20, 18, 0);
    expect(calendarWeekHref('org-1', at.toISOString())).toBe(
      '/org-1/calendar?view=week&date=2026-11-20',
    );
  });

  it('knows a return from the composer, and nothing else', () => {
    expect(cameBackFromComposer('/org-1/composer', '/org-1/clips', 'org-1')).toBe(true);
    expect(cameBackFromComposer('/org-1/composer/new', '/org-1/clips/edit/c1', 'org-1')).toBe(true);
    expect(cameBackFromComposer('/org-1/clips', '/org-1/composer', 'org-1')).toBe(false);
    expect(cameBackFromComposer('/org-1/composers', '/org-1/clips', 'org-1')).toBe(false);
    expect(cameBackFromComposer('/org-2/composer', '/org-1/clips', 'org-1')).toBe(false);
  });
});

describe('ComingUp', () => {
  it('is not drawn before the workspace has an exported clip', async () => {
    comingUpMock.mockResolvedValue(answer({ anyExported: false }));
    show();
    await waitFor(() => expect(comingUpMock).toHaveBeenCalled());
    expect(screen.queryByTestId('clips-coming-up')).toBeNull();
  });

  it('lists the waiting posts soonest first, each opening its post, with View Calendar on the first week', async () => {
    comingUpMock.mockResolvedValue(
      answer({ items: [item(0), item(1), item(2), item(3), item(4)], total: 8 }),
    );
    show();
    const panel = await screen.findByTestId('clips-coming-up');
    const rows = within(panel).getAllByTestId('clips-coming-up-row');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent('Clip 0');
    expect(rows[0]).toHaveAttribute('href', '/org-1/composer?group=group-0');
    expect(rows[0]).toHaveAccessibleName(
      `Clip 0, ${comingUpWhen(item(0).publishDate)}, on Acme Shorts, Acme Reels. Open in the composer.`,
    );
    expect(within(panel).getByText('and 3 more')).toBeVisible();
    expect(within(panel).getByRole('link', { name: 'View Calendar' })).toHaveAttribute(
      'href',
      calendarWeekHref('org-1', item(0).publishDate),
    );
  });

  it('says nothing is scheduled yet, with Send A Clip', async () => {
    comingUpMock.mockResolvedValue(answer());
    const { onSendAClip } = show();
    const empty = await screen.findByTestId('clips-coming-up-empty');
    expect(empty).toHaveTextContent(COMING_UP_EMPTY);
    expect(screen.queryByRole('link', { name: 'View Calendar' })).toBeNull();
    fireEvent.click(within(empty).getByRole('button', { name: 'Send A Clip' }));
    expect(onSendAClip).toHaveBeenCalledTimes(1);
  });

  it('a failed read says so and tries again', async () => {
    comingUpMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    comingUpMock.mockResolvedValueOnce(answer({ items: [item(1)], total: 1 }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Try Again' }));
    expect(await screen.findByTestId('clips-coming-up-row')).toHaveTextContent('Clip 1');
  });
});
