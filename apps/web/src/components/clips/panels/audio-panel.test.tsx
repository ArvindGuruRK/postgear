import { TooltipProvider } from '@postgear/ui';
import {
  type AudioItem,
  CLIP_ERROR_MESSAGES,
  createClipDocument,
  defaultSoundItem,
  type LibrarySoundPage,
  type LibrarySoundView,
  type SoundUploadView,
} from '@postgear/video-engine';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { ApiError } from '@/lib/api';
import {
  deleteSoundUpload,
  favouriteSound,
  listSoundUploads,
  searchSounds,
  soundCategories,
  unfavouriteSound,
  uploadSound,
} from '@/lib/clips-api';
import {
  DELETE_SOUND_SENTENCE,
  REMOVED_SOUND,
  SOUND_FAVOURITES_EMPTY,
  type SoundFileInfo,
} from './audio-model';
import { AudioPanel, type AudioPanelProps } from './audio-panel';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
jest.mock('@/lib/clips-api', () => ({
  searchSounds: jest.fn(),
  soundCategories: jest.fn(),
  favouriteSound: jest.fn(),
  unfavouriteSound: jest.fn(),
  listSoundUploads: jest.fn(),
  uploadSound: jest.fn(),
  deleteSoundUpload: jest.fn(),
}));

const search = searchSounds as jest.MockedFunction<typeof searchSounds>;
const categories = soundCategories as jest.MockedFunction<typeof soundCategories>;
const favourite = favouriteSound as jest.MockedFunction<typeof favouriteSound>;
const unfavourite = unfavouriteSound as jest.MockedFunction<typeof unfavouriteSound>;
const listUploads = listSoundUploads as jest.MockedFunction<typeof listSoundUploads>;
const upload = uploadSound as jest.MockedFunction<typeof uploadSound>;
const removeUpload = deleteSoundUpload as jest.MockedFunction<typeof deleteSoundUpload>;

const VIDEO = '11111111-1111-4111-8111-111111111111';
const WHOOSH = '5c0e8a52-0000-4000-8000-0000000000a1';
const DING = '5c0e8a52-0000-4000-8000-0000000000a2';
const BED = '5c0e8a52-0000-4000-8000-0000000000a3';

function sound(overrides: Partial<LibrarySoundView> = {}): LibrarySoundView {
  return {
    id: WHOOSH,
    name: 'Quick Whoosh',
    kind: 'sfx',
    category: 'whooshes',
    tags: ['whoosh'],
    durationMs: 900,
    bpm: null,
    previewUrl: 'https://space.test/whoosh.m4a',
    peaks: Array.from({ length: 100 }, (_, k) => (k * 7) % 255),
    isFavourite: false,
    credit: null,
    details: {
      source: 'PostGear Sounds',
      author: 'PostGear',
      licence: 'OWN',
      licenceUrl: '',
      sourceUrl: 'own://quick-whoosh',
    },
    ...overrides,
  };
}

function page(items: LibrarySoundView[], extra: Partial<LibrarySoundPage> = {}): LibrarySoundPage {
  return { items, page: 1, pageSize: 24, total: items.length, hasMore: false, ...extra };
}

function upload_(overrides: Partial<SoundUploadView> = {}): SoundUploadView {
  return {
    id: 'up-1',
    name: 'My Jingle',
    status: 'ready',
    error: null,
    durationMs: 4_000,
    peaks: [10, 40, 90],
    fileUrl: 'https://space.test/private/jingle.m4a',
    createdAt: '2026-11-19T10:00:00.000Z',
    ...overrides,
  };
}

const doc = () => createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 30_000, ratio: '9:16' });

function effect(): AudioItem {
  return {
    ...defaultSoundItem(doc(), 2_000, { library: 'sound', id: WHOOSH }, 'sfx', { durationMs: 900 }),
    id: 'snd_a',
  };
}

function music(): AudioItem {
  return {
    ...defaultSoundItem(doc(), 0, { library: 'sound', id: BED }, 'music', { durationMs: 8_000 }),
    id: 'mus_a',
  };
}

const EFFECT_FILE: SoundFileInfo = {
  missing: false,
  removed: false,
  name: 'Quick Whoosh',
  kind: 'sfx',
  durationMs: 900,
  fileUrl: 'https://space.test/whoosh.m4a',
  peaks: [1, 2, 3],
};

const plays: string[] = [];
const pauses = jest.fn();

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value(this: HTMLMediaElement) {
      plays.push(this.src);
      return Promise.resolve();
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: pauses });
  Object.defineProperty(HTMLMediaElement.prototype, 'load', { configurable: true, value() {} });
});

beforeEach(() => {
  jest.clearAllMocks();
  plays.length = 0;
  search.mockResolvedValue(
    page([sound(), sound({ id: DING, name: 'Soft Ding', category: 'alerts' })]),
  );
  categories.mockResolvedValue([
    { slug: 'whooshes', name: 'Whooshes', count: 40 },
    { slug: 'alerts', name: 'Alerts And Notifications', count: 22 },
  ]);
  favourite.mockResolvedValue(undefined);
  unfavourite.mockResolvedValue(undefined);
  listUploads.mockResolvedValue([]);
});

function renderPanel(props: Partial<AudioPanelProps> = {}, playing = false) {
  const spy = {
    onVideoVolume: jest.fn(),
    onAddLibrary: jest.fn(),
    onAddUpload: jest.fn(),
    onEdit: jest.fn(),
    onTiming: jest.fn(),
    onAnchor: jest.fn(),
    onRemove: jest.fn(),
  };
  const view = (next: Partial<AudioPanelProps>, nowPlaying: boolean) => (
    <TooltipProvider>
      <AudioPanel
        selected={null}
        selectedFile={null}
        totalMs={30_000}
        fps={30}
        videoVolume={1}
        videoTarget="clip"
        playback={{ usePlaying: () => nowPlaying }}
        readLevel={() => 0}
        {...spy}
        {...next}
      />
    </TooltipProvider>
  );
  const result = render(view(props, playing));
  return {
    spy,
    rerender: (next: Partial<AudioPanelProps>, nowPlaying: boolean) =>
      result.rerender(view(next, nowPlaying)),
  };
}

const lastSearch = () => search.mock.calls.at(-1)?.[0];

describe('the sound lists', () => {
  it('opens on Sound Effects: effects, the chips with counts and Credits', async () => {
    renderPanel();
    expect(await screen.findByRole('button', { name: 'Add Quick Whoosh' })).toBeInTheDocument();
    expect(lastSearch()).toMatchObject({ q: '', kind: 'sfx', favourites: false, pageSize: 24 });
    expect(categories).toHaveBeenCalledWith('sfx', expect.anything());
    const chips = await screen.findByRole('group', { name: 'Categories' });
    expect(within(chips).getByRole('button', { name: 'Whooshes 40' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Credits' })).toHaveAttribute('href', '/credits/clips');
    expect(screen.getAllByTestId('clip-sound-shape').length).toBeGreaterThan(0);
  });

  it('Add hands the sound over; Music lists music', async () => {
    const { spy } = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Quick Whoosh' }));
    expect(spy.onAddLibrary).toHaveBeenCalledWith(expect.objectContaining({ id: WHOOSH }));

    search.mockResolvedValue(
      page([sound({ id: BED, name: 'Calm Bed', kind: 'music', category: 'calm' })]),
    );
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Sounds' })).getByRole('button', { name: 'Music' }),
    );
    expect(await screen.findByRole('button', { name: 'Add Calm Bed' })).toBeInTheDocument();
    expect(lastSearch()).toMatchObject({ kind: 'music' });
  });

  it('a chip narrows the search; a search with no match says so and offers the nearest chips', async () => {
    renderPanel();
    const chips = await screen.findByRole('group', { name: 'Categories' });
    fireEvent.click(within(chips).getByRole('button', { name: 'Whooshes 40' }));
    await waitFor(() => expect(lastSearch()).toMatchObject({ category: 'whooshes' }));

    search.mockResolvedValue(
      page([], { suggest: [{ slug: 'impacts', name: 'Impacts', count: 30 }] }),
    );
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Sound Effects' }), {
      target: { value: 'zap' },
    });
    expect(await screen.findByTestId('clip-sounds-none')).toHaveTextContent(
      'Nothing found for "zap". Try another word or pick a category.',
    );
    expect(screen.getByRole('group', { name: 'Nearest Categories' })).toBeInTheDocument();
  });

  it('plays one preview at a time, and Play on the clip stops it', async () => {
    const { rerender } = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Play Quick Whoosh' }));
    expect(plays).toEqual(['https://space.test/whoosh.m4a']);
    expect(screen.getByRole('button', { name: 'Stop Quick Whoosh' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Play Soft Ding' }));
    expect(plays).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Play Quick Whoosh' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop Soft Ding' })).toBeInTheDocument();
    rerender({}, true);
    expect(screen.getByRole('button', { name: 'Play Soft Ding' })).toBeInTheDocument();
  });

  it('a star changes at once; the "i" shows where the sound came from', async () => {
    renderPanel();
    const row = (await screen.findAllByTestId('clip-sound-row'))[0] as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Add To Favourites' }));
    expect(favourite).toHaveBeenCalledWith(WHOOSH);
    expect(within(row).getByRole('button', { name: 'Remove From Favourites' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(row).getByRole('button', { name: 'Details' }));
    expect(within(row).getByTestId('clip-sound-details')).toHaveTextContent(
      'From PostGear Sounds by PostGear. Made for PostGear, free to use in your clips.',
    );
  });

  it('an empty Favourites says how to fill it', async () => {
    search.mockResolvedValue(page([]));
    renderPanel();
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Sounds' })).getByRole('button', {
        name: 'Favourites',
      }),
    );
    expect(await screen.findByText(SOUND_FAVOURITES_EMPTY)).toBeInTheDocument();
    expect(lastSearch()).toMatchObject({ favourites: true, kind: undefined });
  });
});

describe('Video Volume', () => {
  it('shows the level, mutes and brings it back', () => {
    const { spy, rerender } = renderPanel({ videoVolume: 1.5 });
    expect(screen.getByText('150%')).toBeInTheDocument();
    expect(screen.getByText('For the whole clip.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(spy.onVideoVolume).toHaveBeenLastCalledWith(0);
    rerender({ videoVolume: 0, videoTarget: 'part' }, false);
    expect(screen.getByText('For the selected part.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    expect(spy.onVideoVolume).toHaveBeenLastCalledWith(1.5);
  });

  it('says so when the parts differ', () => {
    renderPanel({ videoVolume: null });
    expect(screen.getByText('Parts differ')).toBeInTheDocument();
  });

  it('the slider goes to 200% and its drag is one step', () => {
    const { spy } = renderPanel({ videoVolume: 1 });
    const thumb = screen.getByRole('slider', { name: 'Video Volume' });
    expect(thumb).toHaveAttribute('aria-valuemax', '200');
    fireEvent.keyDown(thumb, { key: 'End' });
    expect(spy.onVideoVolume).toHaveBeenLastCalledWith(2, 'video-volume');
  });
});

describe('the selected sound', () => {
  it('an effect: volume, fades, When It Plays without Whole Clip, Remove Sound', () => {
    const { spy } = renderPanel({ selected: effect(), selectedFile: EFFECT_FILE });
    expect(screen.getByTestId('clip-selected-sound')).toHaveTextContent('Quick Whoosh');
    const volume = screen.getByRole('slider', { name: 'Volume' });
    expect(volume).toHaveAttribute('aria-valuemax', '200');
    fireEvent.keyDown(volume, { key: 'Home' });
    expect(spy.onEdit).toHaveBeenLastCalledWith({ volume: 0 }, 'sound-volume:snd_a');
    fireEvent.click(screen.getByRole('switch', { name: 'Fade In' }));
    expect(spy.onEdit).toHaveBeenLastCalledWith({ fadeInMs: 1_000 });
    expect(screen.getByRole('heading', { name: 'When It Plays' })).toBeInTheDocument();
    expect(screen.queryByText('Whole Clip')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Sound' }));
    expect(spy.onRemove).toHaveBeenCalled();
  });

  it('music: fades on, and Whole Clip offered', () => {
    const { spy } = renderPanel({ selected: music(), selectedFile: null });
    expect(screen.getByRole('switch', { name: 'Fade In' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('switch', { name: 'Fade Out' }));
    expect(spy.onEdit).toHaveBeenLastCalledWith({ fadeOutMs: 0 });
    expect(screen.getByText('Whole Clip')).toBeInTheDocument();
  });

  it('a sound that left the library says so', () => {
    renderPanel({
      selected: effect(),
      selectedFile: { ...EFFECT_FILE, missing: true, removed: true, name: null, fileUrl: null },
    });
    expect(screen.getByTestId('clip-sound-missing')).toHaveTextContent(REMOVED_SOUND);
  });
});

describe('Uploaded', () => {
  function openUploaded() {
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Sounds' })).getByRole('button', {
        name: 'Uploaded',
      }),
    );
  }

  it('an upload shows Checking until it is ready, then adds', async () => {
    let answer: (value: SoundUploadView) => void = () => undefined;
    upload.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { spy } = renderPanel();
    openUploaded();
    const input = await screen.findByTestId('clip-sound-file');
    fireEvent.change(input, {
      target: { files: [new File(['ID3'], 'jingle.mp3', { type: 'audio/mpeg' })] },
    });
    expect(await screen.findByText('jingle.mp3')).toBeInTheDocument();
    expect(screen.getByText('Checking')).toBeInTheDocument();
    await act(async () => answer(upload_()));
    fireEvent.click(await screen.findByRole('button', { name: 'Add My Jingle' }));
    expect(spy.onAddUpload).toHaveBeenCalledWith(expect.objectContaining({ id: 'up-1' }));
  });

  it('a file over 20 MB is refused before it is sent; one the API refuses shows its sentence', async () => {
    upload.mockRejectedValue(
      new ApiError(CLIP_ERROR_MESSAGES.sound_unusable, 415, 'sound_unusable'),
    );
    renderPanel();
    openUploaded();
    const input = await screen.findByTestId('clip-sound-file');
    const big = new File(['x'], 'long.wav', { type: 'audio/wav' });
    Object.defineProperty(big, 'size', { value: 21 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await screen.findByTestId('clip-sound-refused')).toHaveTextContent(
      CLIP_ERROR_MESSAGES.sound_upload_too_big,
    );
    expect(upload).not.toHaveBeenCalled();
    fireEvent.change(input, {
      target: { files: [new File(['text'], 'notes.mp3', { type: 'audio/mpeg' })] },
    });
    await waitFor(() =>
      expect(screen.getByTestId('clip-sound-refused')).toHaveTextContent(
        CLIP_ERROR_MESSAGES.sound_unusable,
      ),
    );
  });

  it('Delete Sound asks first, in red', async () => {
    listUploads.mockResolvedValue([upload_()]);
    removeUpload.mockResolvedValue({ message: 'Deleted.' });
    renderPanel();
    openUploaded();
    fireEvent.keyDown(await screen.findByRole('button', { name: 'More For My Jingle' }), {
      key: 'Enter',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete Sound' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(DELETE_SOUND_SENTENCE);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Sound' }));
    await waitFor(() => expect(removeUpload).toHaveBeenCalledWith('up-1'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add My Jingle' })).toBeNull());
  });
});
