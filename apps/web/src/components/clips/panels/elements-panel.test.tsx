import { TooltipProvider } from '@postgear/ui';
import {
  CLIP_ERROR_MESSAGES,
  createClipDocument,
  defaultBadgeItem,
  defaultStickerItem,
  type LibrarySearchPage,
  type LibraryStickerView,
  type StickerItem,
  type StickerUploadView,
} from '@postgear/video-engine';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { ApiError } from '@/lib/api';
import {
  deleteStickerUpload,
  favouriteSticker,
  listStickerUploads,
  searchStickers,
  stickerCategories,
  unfavouriteSticker,
  uploadSticker,
} from '@/lib/clips-api';
import {
  FAVOURITES_EMPTY,
  MISSING_FILE,
  NOTHING_SELECTED,
  REMOVED_STICKER,
  type StickerFileInfo,
  UPLOAD_GONE,
  UPLOADS_EMPTY,
} from './elements-model';
import { ElementsPanel, type ElementsPanelProps } from './elements-panel';
import { DELETE_STICKER_SENTENCE } from './uploaded-stickers';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
jest.mock('@/lib/clips-api', () => ({
  searchStickers: jest.fn(),
  stickerCategories: jest.fn(),
  favouriteSticker: jest.fn(),
  unfavouriteSticker: jest.fn(),
  listStickerUploads: jest.fn(),
  uploadSticker: jest.fn(),
  deleteStickerUpload: jest.fn(),
}));

const search = searchStickers as jest.MockedFunction<typeof searchStickers>;
const categories = stickerCategories as jest.MockedFunction<typeof stickerCategories>;
const favourite = favouriteSticker as jest.MockedFunction<typeof favouriteSticker>;
const unfavourite = unfavouriteSticker as jest.MockedFunction<typeof unfavouriteSticker>;
const listUploads = listStickerUploads as jest.MockedFunction<typeof listStickerUploads>;
const upload = uploadSticker as jest.MockedFunction<typeof uploadSticker>;
const removeUpload = deleteStickerUpload as jest.MockedFunction<typeof deleteStickerUpload>;

const VIDEO = '11111111-1111-4111-8111-111111111111';
const STAR_ID = '5c0e8a52-0000-4000-8000-000000000001';
const SPARK_ID = '5c0e8a52-0000-4000-8000-000000000002';

function sticker(overrides: Partial<LibraryStickerView> = {}): LibraryStickerView {
  return {
    id: STAR_ID,
    name: 'Gold Star',
    kind: 'static',
    category: 'reactions',
    tags: [],
    width: 256,
    height: 256,
    durationMs: null,
    fps: null,
    frames: null,
    previewUrl: null,
    fileUrl: 'https://space.test/gold-star.png',
    isFavourite: false,
    credit: null,
    ...overrides,
  };
}

function page(
  items: LibraryStickerView[],
  extra: Partial<LibrarySearchPage> = {},
): LibrarySearchPage {
  return { items, page: 1, pageSize: 24, total: items.length, hasMore: false, ...extra };
}

function upload_(overrides: Partial<StickerUploadView> = {}): StickerUploadView {
  return {
    id: 'up-1',
    name: 'My Logo',
    status: 'ready',
    error: null,
    kind: 'static',
    width: 200,
    height: 100,
    durationMs: null,
    fps: null,
    frames: null,
    previewUrl: null,
    fileUrl: 'https://space.test/my-logo.png',
    createdAt: '2026-11-19T10:00:00.000Z',
    ...overrides,
  };
}

const doc = () => createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 30_000, ratio: '9:16' });

function stillItem(): StickerItem {
  return {
    ...defaultStickerItem(
      doc(),
      1_000,
      { library: 'sticker', id: STAR_ID },
      { width: 256, height: 256 },
    ),
    id: 'stk_a',
  };
}

const STILL_FILE: StickerFileInfo = {
  missing: false,
  name: 'Gold Star',
  previewUrl: null,
  picture: {
    fileUrl: 'https://space.test/gold-star.png',
    animated: false,
    width: 256,
    height: 256,
    fps: null,
    frames: null,
  },
};

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
  // jsdom draws nothing: the badge falls back to its width estimate.
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

beforeEach(() => {
  jest.clearAllMocks();
  search.mockResolvedValue(page([sticker()]));
  categories.mockResolvedValue([
    { slug: 'reactions', name: 'Reactions', count: 12 },
    { slug: 'social', name: 'Social', count: 4 },
  ]);
  favourite.mockResolvedValue(undefined as never);
  unfavourite.mockResolvedValue(undefined as never);
  listUploads.mockResolvedValue([]);
});

function renderPanel(props: Partial<ElementsPanelProps> = {}) {
  const spy = {
    onAddLibrary: jest.fn(),
    onAddUpload: jest.fn(),
    onAddBadge: jest.fn(),
    onEdit: jest.fn(),
    onTiming: jest.fn(),
    onAnchor: jest.fn(),
    onRemove: jest.fn(),
  };
  render(
    <TooltipProvider>
      <ElementsPanel
        selected={null}
        selectedFile={null}
        totalMs={30_000}
        fps={30}
        {...spy}
        {...props}
      />
    </TooltipProvider>,
  );
  return spy;
}

const lastSearch = () => search.mock.calls.at(-1)?.[0];

describe('the library tabs', () => {
  it('opens on Stickers: still pictures, the chips with counts, the Follow Badge tile, and the note', async () => {
    renderPanel();
    expect(await screen.findByRole('button', { name: 'Add Gold Star' })).toBeInTheDocument();
    expect(lastSearch()).toMatchObject({ q: '', kind: 'static', favourites: false, pageSize: 24 });
    expect(categories).toHaveBeenCalledWith('static', expect.anything());
    const chips = await screen.findByRole('group', { name: 'Categories' });
    expect(within(chips).getByRole('button', { name: 'Reactions 12' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Follow Badge' })).toBeInTheDocument();
    expect(screen.getByTestId('clip-elements-none')).toHaveTextContent(NOTHING_SELECTED);
    expect(screen.getByRole('link', { name: 'Credits' })).toHaveAttribute('href', '/credits/clips');
  });

  it('a tile adds its sticker; GIFs lists moving ones', async () => {
    const spy = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Gold Star' }));
    expect(spy.onAddLibrary).toHaveBeenCalledWith(expect.objectContaining({ id: STAR_ID }));

    search.mockResolvedValue(page([sticker({ id: SPARK_ID, name: 'Sparkle', kind: 'animated' })]));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Elements' })).getByRole('button', { name: 'GIFs' }),
    );
    expect(await screen.findByRole('button', { name: 'Add Sparkle' })).toBeInTheDocument();
    expect(lastSearch()).toMatchObject({ kind: 'animated' });
    expect(screen.queryByRole('button', { name: 'Follow Badge' })).toBeNull();
  });

  it('a chip narrows the search, and pressing it again shows all', async () => {
    renderPanel();
    const chips = await screen.findByRole('group', { name: 'Categories' });
    fireEvent.click(within(chips).getByRole('button', { name: 'Reactions 12' }));
    await waitFor(() => expect(lastSearch()).toMatchObject({ category: 'reactions' }));
    expect(within(chips).getByRole('button', { name: 'Reactions 12' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // The badge sits with Social only.
    expect(screen.queryByRole('button', { name: 'Follow Badge' })).toBeNull();
    fireEvent.click(within(chips).getByRole('button', { name: 'Reactions 12' }));
    await waitFor(() => expect(lastSearch()).toMatchObject({ category: undefined }));
  });

  it('a star changes at once, and pressing it again takes it off', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Add To Favourites' }));
    expect(favourite).toHaveBeenCalledWith(STAR_ID);
    expect(screen.getByRole('button', { name: 'Remove From Favourites' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove From Favourites' }));
    expect(unfavourite).toHaveBeenCalledWith(STAR_ID);
    await act(async () => undefined);
    expect(screen.getByRole('button', { name: 'Add To Favourites' })).toBeInTheDocument();
  });

  it('a refused star goes back and says why', async () => {
    favourite.mockRejectedValueOnce(new ApiError('Too many requests. Try again in a minute.', 429));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Add To Favourites' }));
    expect(await screen.findByTestId('clip-stickers-failed')).toHaveTextContent(
      'Too many requests. Try again in a minute.',
    );
    expect(screen.getByRole('button', { name: 'Add To Favourites' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('shows the "i" only where the source asks for a credit', async () => {
    search.mockResolvedValue(
      page([
        sticker(),
        sticker({
          id: SPARK_ID,
          name: 'Thumbs Up',
          credit: { line: 'Thumbs Up by Sam, CC BY 4.0', url: 'https://example.org/sam' },
        }),
      ]),
    );
    renderPanel();
    await screen.findByRole('button', { name: 'Add Thumbs Up' });
    expect(screen.getAllByRole('button', { name: 'Credit' })).toHaveLength(1);
  });

  it('a search that finds nothing says so and offers the nearest categories', async () => {
    renderPanel();
    await screen.findByRole('button', { name: 'Add Gold Star' });
    search.mockResolvedValue(
      page([], { suggest: [{ slug: 'reactions', name: 'Reactions', count: 12 }] }),
    );
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Stickers' }), {
      target: { value: 'zebra' },
    });
    expect(await screen.findByTestId('clip-stickers-none')).toHaveTextContent(
      'Nothing found for "zebra". Try another word or pick a category.',
    );
    expect(lastSearch()).toMatchObject({ q: 'zebra' });
    search.mockResolvedValue(page([sticker()]));
    const nearest = screen.getByRole('group', { name: 'Nearest Categories' });
    fireEvent.click(within(nearest).getByRole('button', { name: 'Reactions 12' }));
    await waitFor(() => expect(lastSearch()).toMatchObject({ q: '', category: 'reactions' }));
    expect(screen.getByRole('searchbox', { name: 'Search Stickers' })).toHaveValue('');
  });

  it('a failed search says so, and Try Again searches again', async () => {
    search.mockRejectedValueOnce(new ApiError('', 0));
    renderPanel();
    const alert = await screen.findByTestId('clip-stickers-failed');
    expect(alert).toHaveTextContent('We could not load the stickers. Try again in a moment.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try Again' }));
    expect(await screen.findByRole('button', { name: 'Add Gold Star' })).toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('Favourites shows both kinds, and says how to fill it when empty', async () => {
    renderPanel();
    await screen.findByRole('button', { name: 'Add Gold Star' });
    search.mockResolvedValue(page([]));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Elements' })).getByRole('button', {
        name: 'Favourites',
      }),
    );
    expect(await screen.findByText(FAVOURITES_EMPTY)).toBeInTheDocument();
    expect(lastSearch()).toMatchObject({ favourites: true, kind: undefined });
  });
});

describe('the Follow Badge form', () => {
  it('adds a badge with the platform, a clean name and a measured width', async () => {
    const spy = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Follow Badge' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add Follow Badge' });
    const add = within(dialog).getByRole('button', { name: 'Add Badge' });
    expect(add).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Channel Name'), {
      target: { value: '  Night   Owl  ' },
    });
    fireEvent.click(add);
    await waitFor(() => expect(spy.onAddBadge).toHaveBeenCalled());
    const [platform, name, width] = spy.onAddBadge.mock.calls[0] as [string, string, number];
    expect(platform).toBe('twitch');
    expect(name).toBe('Night Owl');
    expect(width).toBeGreaterThan(0);
  });
});

describe('the Uploaded tab', () => {
  async function openUploaded() {
    renderPanel();
    await screen.findByRole('button', { name: 'Add Gold Star' });
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Elements' })).getByRole('button', {
        name: 'Uploaded',
      }),
    );
  }

  it('says how to start when there are none', async () => {
    await openUploaded();
    expect(await screen.findByText(UPLOADS_EMPTY)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload A Sticker' })).toBeInTheDocument();
  });

  it('shows Checking, a failed sentence, and adds a ready one', async () => {
    listUploads.mockResolvedValue([
      upload_({ id: 'up-1', name: 'My Logo' }),
      upload_({ id: 'up-2', name: 'Wave', status: 'checking', fileUrl: null }),
      upload_({
        id: 'up-3',
        name: 'Broken',
        status: 'failed',
        error: 'We could not read this file.',
        fileUrl: null,
      }),
    ]);
    const spy = renderPanel();
    await screen.findByRole('button', { name: 'Add Gold Star' });
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Elements' })).getByRole('button', {
        name: 'Uploaded',
      }),
    );
    const rows = await screen.findAllByTestId('clip-uploaded-row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('Checking');
    expect(rows[2]).toHaveTextContent('We could not read this file.');
    expect(within(rows[2] as HTMLElement).queryByRole('button', { name: 'Add Broken' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add My Logo' }));
    expect(spy.onAddUpload).toHaveBeenCalledWith(expect.objectContaining({ id: 'up-1' }));
  });

  it('refuses a file over 8 MB before sending it', async () => {
    await openUploaded();
    await screen.findByText(UPLOADS_EMPTY);
    const big = new File([new Uint8Array(1)], 'huge.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 9 * 1024 * 1024 });
    fireEvent.change(screen.getByTestId('clip-sticker-file'), { target: { files: [big] } });
    expect(await screen.findByTestId('clip-sticker-refused')).toHaveTextContent(
      CLIP_ERROR_MESSAGES.sticker_upload_too_big,
    );
    expect(upload).not.toHaveBeenCalled();
  });

  it('an upload shows at the top once the API answers', async () => {
    upload.mockResolvedValue(
      upload_({ id: 'up-9', name: 'Fresh', status: 'checking', fileUrl: null }),
    );
    await openUploaded();
    await screen.findByText(UPLOADS_EMPTY);
    const file = new File([new Uint8Array(8)], 'fresh.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('clip-sticker-file'), { target: { files: [file] } });
    const row = await screen.findByTestId('clip-uploaded-row');
    expect(row).toHaveTextContent('Fresh');
    expect(row).toHaveTextContent('Checking');
    expect(upload).toHaveBeenCalledWith(file);
  });

  it('Delete Sticker asks first; a sticker still in a clip is refused with the API sentence', async () => {
    listUploads.mockResolvedValue([upload_()]);
    await openUploaded();
    const more = await screen.findByRole('button', { name: 'More For My Logo' });

    removeUpload.mockRejectedValueOnce(
      new ApiError('This sticker is in 2 clips. Take it out of them first, then delete it.', 409),
    );
    fireEvent.keyDown(more, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete Sticker' }));
    let confirm = await screen.findByRole('alertdialog', { name: 'Delete Sticker' });
    expect(confirm).toHaveTextContent(DELETE_STICKER_SENTENCE);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete Sticker' }));
    expect(await screen.findByTestId('clip-sticker-refused')).toHaveTextContent(
      'This sticker is in 2 clips. Take it out of them first, then delete it.',
    );
    expect(screen.getAllByTestId('clip-uploaded-row')).toHaveLength(1);

    removeUpload.mockResolvedValueOnce(undefined as never);
    fireEvent.keyDown(screen.getByRole('button', { name: 'More For My Logo' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete Sticker' }));
    confirm = await screen.findByRole('alertdialog', { name: 'Delete Sticker' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete Sticker' }));
    await waitFor(() => expect(screen.queryAllByTestId('clip-uploaded-row')).toHaveLength(0));
    expect(removeUpload).toHaveBeenLastCalledWith('up-1');
  });
});

describe('the selected sticker', () => {
  it('a still one: its name, Flip and Opacity, no Loop, and Remove Sticker', async () => {
    const spy = renderPanel({ selected: stillItem(), selectedFile: STILL_FILE });
    await screen.findByRole('button', { name: 'Add Gold Star' });
    expect(screen.getByTestId('clip-selected-sticker')).toHaveTextContent('Gold Star');
    expect(screen.queryByRole('switch', { name: 'Loop' })).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Flip' }));
    const [change] = spy.onEdit.mock.calls[0] as [(item: StickerItem) => StickerItem];
    expect(change(stillItem()).flipX).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Sticker' }));
    expect(spy.onRemove).toHaveBeenCalled();
  });

  it('a moving one has Loop', async () => {
    const moving: StickerFileInfo = {
      ...STILL_FILE,
      picture: {
        ...(STILL_FILE.picture as NonNullable<StickerFileInfo['picture']>),
        animated: true,
        fps: 10,
        frames: 8,
      },
    };
    const spy = renderPanel({ selected: stillItem(), selectedFile: moving });
    await screen.findByRole('button', { name: 'Add Gold Star' });
    fireEvent.click(screen.getByRole('switch', { name: 'Loop' }));
    const [change] = spy.onEdit.mock.calls[0] as [(item: StickerItem) => StickerItem];
    expect(change(stillItem()).loop).toBe(false);
  });

  it('warns when the sticker left the library, or the workspace deleted it', async () => {
    renderPanel({ selected: stillItem(), selectedFile: MISSING_FILE });
    expect(await screen.findByTestId('clip-sticker-missing')).toHaveTextContent(REMOVED_STICKER);
  });

  it('an uploaded sticker that was deleted says so in its own words', async () => {
    const item: StickerItem = { ...stillItem(), ref: { asset: 'up-1' } };
    renderPanel({ selected: item, selectedFile: MISSING_FILE });
    expect(await screen.findByTestId('clip-sticker-missing')).toHaveTextContent(UPLOAD_GONE);
  });

  it('a badge edits its platform and name instead of Flip', async () => {
    const badge: StickerItem = {
      ...defaultBadgeItem(doc(), 0, 'kick', 'Night Owl', 400),
      id: 'stk_b',
    };
    const spy = renderPanel({ selected: badge, selectedFile: null });
    await screen.findByRole('button', { name: 'Add Gold Star' });
    expect(screen.getByTestId('clip-selected-sticker')).toHaveTextContent('Follow Badge');
    expect(screen.queryByRole('switch', { name: 'Flip' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Channel Name'), { target: { value: 'Day Owl' } });
    await waitFor(() => expect(spy.onEdit).toHaveBeenCalled());
    const [change, key, itemId] = spy.onEdit.mock.calls.at(-1) as [
      (item: StickerItem) => StickerItem,
      string,
      string,
    ];
    expect(key).toBe('badge:stk_b');
    expect(itemId).toBe('stk_b');
    expect(change(badge).ref).toEqual({ badge: 'kick', name: 'Day Owl' });
  });
});
