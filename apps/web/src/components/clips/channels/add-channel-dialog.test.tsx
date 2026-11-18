import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { ApiError } from '@/lib/api';
import type { ClipChannelPreview } from '@/types/clips';
import { FIXTURE_CHANNEL } from '../clips-fixtures';
import { AddChannelDialog } from './add-channel-dialog';

jest.mock('@/lib/clips-api', () => ({}));
jest.mock('@postgear/ui', () => ({ ...jest.requireActual('@postgear/ui'), toast: jest.fn() }));

const { toast } = jest.requireMock('@postgear/ui') as { toast: jest.Mock };

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});
beforeEach(() => toast.mockReset());

const PREVIEW: ClipChannelPreview = {
  platform: 'twitch',
  handle: 'simstreamer',
  displayName: 'SimStreamer',
  avatarUrl: null,
};

function fakeApi() {
  return {
    check: jest.fn(async () => PREVIEW),
    add: jest.fn(async () => FIXTURE_CHANNEL),
  };
}

function renderDialog(api = fakeApi()) {
  const onAdded = jest.fn();
  const onOpenChange = jest.fn();
  render(
    <TooltipProvider>
      <AddChannelDialog
        open
        onOpenChange={onOpenChange}
        orgId="org-1"
        platforms={['youtube', 'twitch', 'kick']}
        initialPlatform="twitch"
        onAdded={onAdded}
        api={api}
      />
    </TooltipProvider>,
  );
  return { api, onAdded, onOpenChange };
}

const nameField = () => screen.getByLabelText('Channel name');
const addButton = () => screen.getByRole('button', { name: 'Add Channel' });

async function typeAndCheck(text: string) {
  fireEvent.change(nameField(), { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
  });
}

describe('AddChannelDialog', () => {
  it('refuses a pasted video link at once, without asking the API', async () => {
    const { api } = renderDialog();
    await typeAndCheck('https://www.twitch.tv/videos/123456789');

    expect(
      screen.getByText('That is a video link. Paste it in the link box on Clips.'),
    ).toBeInTheDocument();
    expect(api.check).not.toHaveBeenCalled();
    expect(addButton()).toBeDisabled();
  });

  it('keeps Check off for an empty name and Add Channel off until checked', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled();
    fireEvent.change(nameField(), { target: { value: 'simstreamer' } });
    expect(screen.getByRole('button', { name: 'Check' })).toBeEnabled();
    expect(addButton()).toBeDisabled();
  });

  it("checks the name and shows the channel's display name", async () => {
    const { api } = renderDialog();
    await typeAndCheck('  simstreamer ');

    expect(api.check).toHaveBeenCalledWith('twitch', 'simstreamer', {
      signal: expect.any(AbortSignal),
    });
    expect(screen.getByText('SimStreamer')).toBeInTheDocument();
    expect(screen.getByText('Twitch, simstreamer')).toBeInTheDocument();
    expect(addButton()).toBeEnabled();
  });

  it('clears the answer when the name changes', async () => {
    renderDialog();
    await typeAndCheck('simstreamer');
    fireEvent.change(nameField(), { target: { value: 'someoneelse' } });
    expect(screen.queryByText('SimStreamer')).not.toBeInTheDocument();
    expect(addButton()).toBeDisabled();
  });

  it('adds the checked channel, closes and says so', async () => {
    const { api, onAdded, onOpenChange } = renderDialog();
    await typeAndCheck('simstreamer');
    await act(async () => {
      fireEvent.click(addButton());
    });

    expect(api.add).toHaveBeenCalledWith('twitch', 'simstreamer');
    expect(onAdded).toHaveBeenCalledWith(FIXTURE_CHANNEL);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast).toHaveBeenCalledWith({ title: 'SimStreamer is in your channels.' });
  });

  it('shows the channel limit sentence with See Plans', async () => {
    const api = fakeApi();
    api.add.mockRejectedValue(
      new ApiError(
        'Your plan can keep 1 channel. Remove one, or see plans for more.',
        402,
        'channel_limit',
      ),
    );
    const { onAdded, onOpenChange } = renderDialog(api);
    await typeAndCheck('simstreamer');
    await act(async () => {
      fireEvent.click(addButton());
    });

    expect(
      screen.getByText('Your plan can keep 1 channel. Remove one, or see plans for more.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See Plans' })).toHaveAttribute(
      'href',
      '/org-1/settings/billing',
    );
    expect(onAdded).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("shows the platform's answer when the channel is not found", async () => {
    const api = fakeApi();
    api.check.mockRejectedValue(
      new ApiError(
        'We could not find that channel. Check the name and try again.',
        422,
        'channel_not_found',
      ),
    );
    renderDialog(api);
    await typeAndCheck('nobodyhere');
    expect(
      screen.getByText('We could not find that channel. Check the name and try again.'),
    ).toBeInTheDocument();
    expect(addButton()).toBeDisabled();
  });
});
