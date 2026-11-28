import '@testing-library/jest-dom';
import { toast } from '@postgear/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { ApiError } from '@/lib/api';
import type { ClipsHostedLane } from '@/types/clips';
import {
  type ClipPrivacy,
  ClipsPrivacySettings,
  PRIVACY_READ_ONLY,
  speechLaneNote,
} from './clips-privacy-settings';

jest.mock('@/lib/api', () => ({ ...jest.requireActual('@/lib/api'), api: jest.fn() }));
jest.mock('@postgear/ui', () => ({ ...jest.requireActual('@postgear/ui'), toast: jest.fn() }));

const { api } = jest.requireMock('@/lib/api') as { api: jest.Mock };
const mockedToast = toast as jest.MockedFunction<typeof toast>;

const OFF: ClipsHostedLane = { on: false, provider: null, providerName: null, aboveMinutes: null };
const LONG: ClipsHostedLane = {
  on: true,
  provider: 'groq',
  providerName: 'Groq',
  aboveMinutes: 55,
};
const ALL: ClipsHostedLane = { on: true, provider: 'groq', providerName: 'Groq', aboveMinutes: 0 };

const privacy = (speechStaysHere: boolean, hostedLane = LONG): ClipPrivacy => ({
  speechStaysHere,
  hostedLane,
});

beforeAll(() => stubBrowserLayout());

beforeEach(() => {
  api.mockReset();
  mockedToast.mockReset();
});

describe('speechLaneNote (Module 17 item 26)', () => {
  it('says nothing leaves today when the PostGear has no hosted lane', () => {
    expect(speechLaneNote(OFF, false)).toMatch(/^Right now all speech stays on our own servers/);
    expect(speechLaneNote(null, true)).toMatch(/^Right now all speech stays on our own servers/);
  });

  it('names the provider and the minutes while the switch is off', () => {
    expect(speechLaneNote(LONG, false)).toBe(
      'When more than 55 minutes are listened to at once, the sound is sent to Groq to be turned into text.',
    );
    expect(speechLaneNote(ALL, false)).toBe(
      'Every listen sends the sound to Groq to be turned into text.',
    );
  });

  it('says what keeping speech here costs while it is on', () => {
    expect(speechLaneNote(LONG, true)).toMatch(/stays on our own servers too, so it takes longer/);
    expect(speechLaneNote(ALL, true)).toMatch(/listening will not work in this workspace/);
  });
});

describe('ClipsPrivacySettings', () => {
  it('saves the switch for an admin and says so', async () => {
    api.mockResolvedValueOnce({ privacy: privacy(true) });
    render(<ClipsPrivacySettings initial={privacy(false)} isAdmin />);
    const toggle = screen.getByRole('switch', { name: 'Keep speech on our own servers' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/clips/privacy', {
        method: 'PUT',
        body: { speechStaysHere: true },
      }),
    );
    await waitFor(() => expect(toggle).toBeChecked());
    expect(mockedToast).toHaveBeenCalledWith({
      title: 'Saved',
      description: 'Speech in this workspace now stays on our own servers.',
    });
    expect(screen.getByTestId('clips-privacy-lane')).toHaveTextContent(/takes longer/);
  });

  it('puts the switch back and offers Try Again when the save fails', async () => {
    api.mockRejectedValueOnce(new ApiError('The server had a problem.', 500));
    render(<ClipsPrivacySettings initial={privacy(false)} isAdmin />);
    const toggle = screen.getByRole('switch', { name: 'Keep speech on our own servers' });
    fireEvent.click(toggle);
    expect(await screen.findByTestId('clips-privacy-error')).toHaveTextContent(
      'The server had a problem.',
    );
    expect(toggle).not.toBeChecked();
    api.mockResolvedValueOnce({ privacy: privacy(true) });
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    await waitFor(() => expect(toggle).toBeChecked());
    expect(screen.queryByTestId('clips-privacy-error')).not.toBeInTheDocument();
  });

  it('shows a member the setting without letting them change it', () => {
    render(<ClipsPrivacySettings initial={privacy(true)} isAdmin={false} />);
    expect(screen.getByText(PRIVACY_READ_ONLY)).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'Keep speech on our own servers' });
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(api).not.toHaveBeenCalled();
  });
});
