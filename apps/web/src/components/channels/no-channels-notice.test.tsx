import { fireEvent, render, screen } from '@testing-library/react';
import type { ProviderSummary } from '@/types/channel';
import { NoChannelsNotice } from './no-channels-notice';

let mockRole = 'ADMIN';

// The design-system barrel pulls in animated-icon subpaths this jest setup
// cannot resolve, and only `cn` is used while rendering here.
jest.mock('@postgear/ui', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

jest.mock('@/components/navigation/workspace-provider', () => ({
  useWorkspace: () => ({ role: mockRole }),
}));

// The real dialog is its own tested piece; here only that it is opened matters.
jest.mock('./connect-channel-dialog', () => ({
  ConnectChannelDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="add-channel-dialog" /> : null,
}));

const PROVIDERS = [{ identifier: 'x', name: 'X', configured: true }] as ProviderSummary[];

describe('NoChannelsNotice', () => {
  beforeEach(() => {
    mockRole = 'ADMIN';
  });

  it('says nothing is connected and that a channel is needed first', () => {
    render(<NoChannelsNotice providers={PROVIDERS} />);

    expect(screen.getByText('Nothing has been connected yet')).toBeTruthy();
    expect(screen.getByText(/you need to connect a channel first/i)).toBeTruthy();
  });

  it('opens the Add Channel dialog when an admin presses it', () => {
    render(<NoChannelsNotice providers={PROVIDERS} />);

    expect(screen.queryByTestId('add-channel-dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByTestId('add-channel-dialog')).toBeTruthy();
  });

  it('treats a superadmin like an admin', () => {
    mockRole = 'SUPERADMIN';
    render(<NoChannelsNotice providers={PROVIDERS} />);

    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('is plain text for a member, naming who to ask', () => {
    mockRole = 'USER';
    render(<NoChannelsNotice providers={PROVIDERS} />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/ask a workspace admin/i)).toBeTruthy();
  });
});
