/**
 * The Clips home's entry card (2026-11-19 redo): every way in, in
 * StreamLadder's order, with a Find Clips that explains itself.
 */
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ClipVideoView } from '@/types/clips';
import { emptyLinkSentence, openTarget } from './home-model';
import { LinkBox } from './link-box';
import type { LinkProbe } from './use-link-probe';
import { useOpenWhenReady } from './use-open-when-ready';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const PLATFORMS = ['youtube', 'twitch', 'kick'] as const;

function idleProbe(): LinkProbe {
  return { state: { kind: 'idle' }, probe: jest.fn(), show: jest.fn(), reset: jest.fn() };
}

function renderBox(overrides: Partial<React.ComponentProps<typeof LinkBox>> = {}) {
  const props: React.ComponentProps<typeof LinkBox> = {
    orgId: 'org-1',
    platforms: PLATFORMS,
    probe: idleProbe(),
    disabled: false,
    focusRights: false,
    onImported: jest.fn(),
    onUpload: jest.fn(),
    onDropFiles: jest.fn(),
    onBrowse: jest.fn(),
    ...overrides,
  };
  render(<LinkBox {...props} />);
  return props;
}

describe('the entry card', () => {
  // jsdom has no matchMedia; the Browse buttons' hover fill asks it about
  // reduced motion.
  beforeAll(() => {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
  });

  it('names the platforms, then offers Find Clips, Upload Your Own Video and one Browse each', () => {
    const props = renderBox();
    const card = screen.getByRole('region', { name: 'Bring In A Video' });
    const works = within(card).getByRole('list', { name: 'Works with' });
    expect(
      within(works)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['YouTube', 'Twitch', 'Kick']);
    expect(within(card).getByRole('button', { name: 'Find Clips' })).toBeEnabled();
    fireEvent.click(within(card).getByRole('button', { name: /Upload Your Own Video/ }));
    expect(props.onUpload).toHaveBeenCalledTimes(1);
    fireEvent.click(within(card).getByRole('button', { name: 'Browse Kick' }));
    expect(props.onBrowse).toHaveBeenCalledWith('kick');
    // Try A Sample is gone (2026-11-20).
    expect(screen.queryByRole('button', { name: 'Try A Sample' })).toBeNull();
  });

  it('says what to paste when Find Clips is pressed with an empty field, and reads a link', () => {
    const probe = idleProbe();
    renderBox({ probe });
    fireEvent.click(screen.getByRole('button', { name: 'Find Clips' }));
    expect(probe.probe).not.toHaveBeenCalled();
    const field = screen.getByLabelText('Video link');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Paste a video link from YouTube, Twitch or Kick.',
    );
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('Paste a video link from YouTube, Twitch or Kick.');

    fireEvent.change(field, { target: { value: 'https://kick.com/acme/videos/1' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Find Clips' }));
    expect(probe.probe).toHaveBeenCalledWith('https://kick.com/acme/videos/1');
  });

  it('uploads a video dropped on the upload area', () => {
    const props = renderBox();
    const area = screen.getByTestId('clips-upload-area');
    const file = new File(['x'], 'talk.mp4', { type: 'video/mp4' });
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' };
    fireEvent.dragOver(area, { dataTransfer });
    expect(area).toHaveTextContent('Drop it here to upload.');
    fireEvent.drop(area, { dataTransfer });
    expect(props.onDropFiles).toHaveBeenCalledWith([file]);
  });

  it('turns every way in off while the video tools are down', () => {
    renderBox({ disabled: true });
    expect(screen.getByRole('button', { name: 'Find Clips' })).toBeDisabled();
    expect(screen.getByTestId('clips-upload-area')).toBeDisabled();
  });
});

describe('where a ready video opens', () => {
  it('opens uploads, clips and shorts in the editor, videos and streams on their page', () => {
    expect(openTarget({ platform: 'upload', kind: 'upload', durationMs: 180_000 })).toBe('edit');
    expect(openTarget({ platform: 'twitch', kind: 'clip', durationMs: 30_000 })).toBe('edit');
    expect(openTarget({ platform: 'youtube', kind: 'short', durationMs: 50_000 })).toBe('edit');
    expect(openTarget({ platform: 'kick', kind: 'past_stream', durationMs: 600_000 })).toBe(
      'video',
    );
    expect(openTarget({ platform: 'youtube', kind: 'video', durationMs: 60_000 })).toBe('video');
  });

  it('sends anything longer than a clip may be, or of unknown length, to its page', () => {
    expect(openTarget({ platform: 'upload', kind: 'upload', durationMs: 31 * 60_000 })).toBe(
      'video',
    );
    expect(openTarget({ platform: 'upload', kind: 'upload', durationMs: null })).toBe('video');
  });

  it('words the empty field sentence from the platforms switched on', () => {
    expect(emptyLinkSentence(['kick'])).toBe('Paste a video link from Kick.');
    expect(emptyLinkSentence([])).toBe('Paste a video link first.');
  });
});

describe('useOpenWhenReady', () => {
  const video = (status: ClipVideoView['status'], extra: Partial<ClipVideoView> = {}) =>
    ({
      id: 'video-1',
      platform: 'upload',
      kind: 'upload',
      title: 'Talk',
      durationMs: 180_000,
      status,
      ...extra,
    }) as ClipVideoView;

  beforeEach(() => push.mockReset());

  it('waits for READY, makes a whole clip and opens the editor', async () => {
    const answers = [video('IMPORTING'), video('READY')];
    const api = {
      getVideo: jest.fn(async () => ({ video: answers.shift() ?? video('READY') })),
      createWholeClip: jest.fn(async () => ({ clip: { id: 'clip-9' }, job: null })),
    };
    const { result } = renderHook(() => useOpenWhenReady('org-1', api as never, 20));
    act(() =>
      result.current.follow({ id: 'video-1', title: 'Talk', platform: 'upload', kind: 'upload' }),
    );
    expect(result.current.openings).toHaveLength(1);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/org-1/clips/edit/clip-9'));
    expect(api.createWholeClip).toHaveBeenCalledWith('video-1');
    expect(result.current.openings).toHaveLength(0);
  });

  it('opens a past stream on its video page, with no clip made', async () => {
    const api = {
      getVideo: jest.fn(async () => ({
        video: video('READY', { platform: 'kick', kind: 'past_stream', durationMs: 600_000 }),
      })),
      createWholeClip: jest.fn(),
    };
    const { result } = renderHook(() => useOpenWhenReady('org-1', api as never, 20));
    act(() => result.current.follow({ id: 'video-1', title: 'Stream' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/org-1/clips/video/video-1'));
    expect(api.createWholeClip).not.toHaveBeenCalled();
  });

  it('falls back to the video page when the clip is refused, and Stay Here stops the jump', async () => {
    const api = {
      getVideo: jest.fn(async () => ({ video: video('READY') })),
      createWholeClip: jest.fn(async () => {
        throw new Error('refused');
      }),
    };
    const { result } = renderHook(() => useOpenWhenReady('org-1', api as never, 20));
    act(() => result.current.follow({ id: 'video-1', title: 'Talk' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/org-1/clips/video/video-1'));

    push.mockReset();
    const slow = {
      getVideo: jest.fn(async () => ({ video: video('IMPORTING') })),
      createWholeClip: jest.fn(),
    };
    const second = renderHook(() => useOpenWhenReady('org-1', slow as never, 20));
    act(() => second.result.current.follow({ id: 'video-2', title: 'Other' }));
    act(() => second.result.current.stay('video-2'));
    expect(second.result.current.openings).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(push).not.toHaveBeenCalled();
  });
});
