import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { fixtureClipItem } from '@/components/clips/library/clip-list-fixtures';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { api } from '@/lib/api';
import { listClips } from '@/lib/clips-api';
import type { ClipListItem, ClipListPage } from '@/types/clips';
import type { MediaItem } from '@/types/media';
import {
  CLIP_PICKER_CHANGED,
  CLIP_PICKER_EMPTY,
  CLIP_PICKER_FILE_GONE,
  CLIP_PICKER_PICTURES_ONLY,
  clipFactsLine,
  clipPickBadge,
  clipPickBlock,
  exportedLine,
  pageCountOf,
} from './clip-picker-model';
import { MediaPickerDialog } from './media-picker-dialog';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: jest.fn(),
}));
jest.mock('@/lib/clips-api', () => ({ listClips: jest.fn() }));
// The library side is the Media page's own, tested there: an empty library here.
jest.mock('@/components/media/use-media-list', () => ({
  useMediaList: () => ({
    search: '',
    setSearch: jest.fn(),
    page: 1,
    setPage: jest.fn(),
    data: { media: [], page: 1, pageCount: 1, total: 0 },
    loading: false,
    error: null,
    reload: jest.fn(),
    prepend: jest.fn(),
  }),
}));
jest.mock('@/components/media/media-uploader', () => ({
  useMediaUpload: () => ({ rows: [], upload: jest.fn() }),
  UploadRows: () => null,
}));

const apiMock = api as jest.MockedFunction<typeof api>;
const listMock = listClips as jest.MockedFunction<typeof listClips>;

function page(clips: ClipListItem[], total = clips.length): ClipListPage {
  return {
    clips,
    counts: { all: total, new: 0, draft: 0, exported: total, scheduled: 0, hidden: 0 },
    page: 1,
    pageSize: 24,
    total,
  };
}

const EXPORTED = fixtureClipItem({
  id: 'clip-1',
  title: 'Boss Fight',
  state: 'exported',
  exported: true,
  exportedMediaId: 'media-1',
  exportedAt: '2026-11-05T09:30:00.000Z',
});
const SCHEDULED_CHANGED = fixtureClipItem({
  id: 'clip-2',
  title: 'Clutch Round',
  ratio: '1:1',
  durationMs: 75_000,
  state: 'draft',
  exported: false,
  exportedMediaId: 'media-2',
  exportedAt: '2026-11-04T09:30:00.000Z',
});
const FILE_GONE = fixtureClipItem({
  id: 'clip-3',
  title: 'Lost File',
  state: 'exported',
  exported: true,
  exportedMediaId: 'media-3',
  exportedAt: null,
});

function mediaRow(id: string): MediaItem {
  return {
    id,
    name: `${id}.mp4`,
    type: 'video',
    mimeType: 'video/mp4',
    fileSize: 1024,
    width: 1080,
    height: 1920,
    url: `/media/${id}/file`,
    thumbnailUrl: null,
    createdAt: '2026-11-05T09:30:00.000Z',
    durationMs: 42_000,
  };
}

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  listMock.mockResolvedValue(page([EXPORTED, SCHEDULED_CHANGED, FILE_GONE]));
  apiMock.mockImplementation(async (path: string) => {
    const id = path.replace('/media/', '');
    return { media: mediaRow(id) } as never;
  });
});

function show(overrides: Partial<React.ComponentProps<typeof MediaPickerDialog>> = {}) {
  const onAttach = jest.fn();
  render(
    <TooltipProvider>
      <MediaPickerDialog
        open
        onOpenChange={jest.fn()}
        onAttach={onAttach}
        remaining={4}
        clips={{ orgId: 'org-1' }}
        {...overrides}
      />
    </TooltipProvider>,
  );
  return { onAttach };
}

async function openClipsTab() {
  const tab = screen.getByRole('tab', { name: 'Clips' });
  await act(async () => {
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
  });
  return screen.findByTestId('clip-picker');
}

function choice(title: string) {
  return screen.getByRole('button', { name: new RegExp(`^(Select|Deselect) ${title}$`) });
}

describe('clip picker model', () => {
  it('words a clip: its facts, its date, its badge, and why it cannot be picked', () => {
    expect(clipFactsLine({ durationMs: 42_000, ratio: '9:16' })).toBe('0:42, 9:16');
    expect(exportedLine('2026-11-05T09:30:00.000Z')).toBe('Exported 5 Nov 2026');
    expect(exportedLine(null)).toBe('');
    expect(clipPickBadge({ state: 'scheduled' })).toBe('Scheduled');
    expect(clipPickBadge({ state: 'draft' })).toBe('Exported');
    const options = { imagesOnly: false, attached: ['media-9'] };
    expect(clipPickBlock(EXPORTED, options)).toBeNull();
    expect(clipPickBlock(FILE_GONE, options)).toBe('file_gone');
    expect(clipPickBlock({ ...EXPORTED, exportedMediaId: 'media-9' }, options)).toBe('attached');
    expect(clipPickBlock(EXPORTED, { imagesOnly: true, attached: [] })).toBe('pictures_only');
    expect(pageCountOf(0, 24)).toBe(1);
    expect(pageCountOf(49, 24)).toBe(3);
  });
});

describe('MediaPickerDialog: Select A Clip (Module 17)', () => {
  it('has no Clips tab where the caller did not ask for one (Studio, Workflows)', () => {
    show({ clips: undefined });
    expect(screen.queryByRole('tab', { name: 'Clips' })).toBeNull();
  });

  it('lists the exported clips newest first, with facts, dates, badges and notes', async () => {
    show();
    const pane = await openClipsTab();
    expect(screen.getByRole('heading', { name: 'Select A Clip' })).toBeVisible();
    await within(pane).findAllByTestId('clip-picker-choice');
    expect(listMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ withExport: true, sort: 'newest', page: 1, q: undefined }),
    );
    const first = choice('Boss Fight');
    expect(first).toHaveTextContent('0:42, 9:16');
    expect(first).toHaveTextContent('Exported 5 Nov 2026');
    expect(first).toHaveTextContent('Exported');
    expect(choice('Clutch Round')).toHaveTextContent(CLIP_PICKER_CHANGED);
    expect(choice('Clutch Round')).toHaveTextContent('1:15, 1:1');
    expect(choice('Lost File')).toHaveTextContent(CLIP_PICKER_FILE_GONE);
    expect(choice('Lost File')).toBeDisabled();
  });

  it('sorts oldest first, switches to a list and remembers it, and searches by name', async () => {
    show();
    const pane = await openClipsTab();
    await within(pane).findAllByTestId('clip-picker-choice');

    fireEvent.click(within(pane).getByRole('button', { name: 'Oldest' }));
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'oldest' })),
    );
    fireEvent.click(within(pane).getByRole('button', { name: 'List' }));
    expect(window.localStorage.getItem('postgear.clips.view')).toBe('list');

    fireEvent.change(within(pane).getByRole('searchbox', { name: 'Search clips' }), {
      target: { value: '  boss  ' },
    });
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'boss', page: 1 })),
    );
  });

  it('attaches the exported file of each picked clip, as a Media pick', async () => {
    const { onAttach } = show();
    const pane = await openClipsTab();
    await within(pane).findAllByTestId('clip-picker-choice');
    fireEvent.click(choice('Boss Fight'));
    fireEvent.click(choice('Clutch Round'));
    expect(screen.getByText('2 selected, up to 4')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Add Selected Media' }));
    await waitFor(() => expect(onAttach).toHaveBeenCalledTimes(1));
    expect(apiMock).toHaveBeenCalledWith('/media/media-1');
    expect(apiMock).toHaveBeenCalledWith('/media/media-2');
    expect(onAttach.mock.calls[0]?.[0].map((item: MediaItem) => item.id)).toEqual([
      'media-1',
      'media-2',
    ]);
  });

  it('says so when the file could not be read, and attaches nothing', async () => {
    apiMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { onAttach } = show();
    const pane = await openClipsTab();
    await within(pane).findAllByTestId('clip-picker-choice');
    fireEvent.click(choice('Boss Fight'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Selected Media' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not add that clip.');
    expect(onAttach).not.toHaveBeenCalled();
  });

  it('a clip already on the part cannot be picked twice', async () => {
    show({ alreadyAttached: ['media-1'] });
    const pane = await openClipsTab();
    await within(pane).findAllByTestId('clip-picker-choice');
    expect(choice('Boss Fight')).toBeDisabled();
    expect(choice('Boss Fight')).toHaveTextContent('Already attached to this part.');
  });

  it('a pictures-only part shows the clips with the sentence, and none can be picked', async () => {
    show({ imagesOnly: true });
    const pane = await openClipsTab();
    await within(pane).findAllByTestId('clip-picker-choice');
    expect(within(pane).getByTestId('clip-picker-pictures-only')).toHaveTextContent(
      CLIP_PICKER_PICTURES_ONLY,
    );
    for (const button of within(pane).getAllByTestId('clip-picker-choice')) {
      expect(button).toBeDisabled();
    }
  });

  it('with no exported clip, says how to get one and links to Clips', async () => {
    listMock.mockResolvedValue(page([]));
    show();
    const pane = await openClipsTab();
    const empty = await within(pane).findByTestId('clip-picker-empty');
    expect(empty).toHaveTextContent(CLIP_PICKER_EMPTY);
    expect(within(empty).getByRole('link', { name: 'Go To Clips' })).toHaveAttribute(
      'href',
      '/org-1/clips?tab=clips',
    );
  });
});
