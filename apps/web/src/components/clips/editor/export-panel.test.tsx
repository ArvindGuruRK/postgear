import { TooltipProvider } from '@postgear/ui';
import { createClipDocument, documentFingerprint } from '@postgear/video-engine';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { ApiError, downloadFile } from '@/lib/api';
import {
  cancelClipJob,
  exportClip,
  latestClipPreview,
  listClipExports,
  previewClip,
} from '@/lib/clips-api';
import type { ClipExportView, ClipJobView, ClipPreviewView, ClipSharpState } from '@/types/clips';
import {
  CLOSE_IS_FINE,
  EXPORT_FAILED_SENTENCE,
  EXPORT_UNSAVED_SENTENCE,
  goneItems,
  leaveOutSentence,
  MARK_LINE,
  OUT_OF_DATE,
  PREVIEW_SMALLER,
  SHARP_GONE_LINE,
  SHARP_LOCK_LINE,
  summaryLine,
} from './export-model';
import { ExportPanel, useClipExport } from './export-panel';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// The plan dialog links to this workspace's billing.
jest.mock('@/components/navigation/workspace-provider', () => ({
  useWorkspace: () => ({ activeOrgId: 'org-1' }),
}));
jest.mock('@/lib/clips-api', () => ({
  exportClip: jest.fn(),
  listClipExports: jest.fn(),
  previewClip: jest.fn(),
  latestClipPreview: jest.fn(),
  cancelClipJob: jest.fn(),
}));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  downloadFile: jest.fn(async () => undefined),
}));
const mockPlan: { values: Record<string, unknown> | null } = { values: null };
jest.mock('@/lib/entitlements', () => ({
  useEntitlements: () => ({
    snapshot: mockPlan.values ? { values: mockPlan.values } : null,
    status: 'ready',
    refresh: jest.fn(),
  }),
}));
// Each followed job is read from here, as the job's stream would answer.
const mockJobs = new Map<string, unknown>();
jest.mock('../use-clip-job', () => ({
  useClipJob: (id: string | null) => ({
    job: id ? (mockJobs.get(id) ?? null) : null,
    error: null,
    refresh: jest.fn(),
  }),
}));

const make = exportClip as jest.MockedFunction<typeof exportClip>;
const list = listClipExports as jest.MockedFunction<typeof listClipExports>;
const preview = previewClip as jest.MockedFunction<typeof previewClip>;
const latest = latestClipPreview as jest.MockedFunction<typeof latestClipPreview>;
const cancel = cancelClipJob as jest.MockedFunction<typeof cancelClipJob>;
const download = downloadFile as jest.MockedFunction<typeof downloadFile>;

const VIDEO = '11111111-1111-4111-8111-111111111111';
const CLIP = '22222222-2222-4222-8222-222222222222';
const doc = createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 20_000, ratio: '9:16' });

function job(
  id: string,
  status: ClipJobView['status'],
  extra: Partial<ClipJobView> = {},
): ClipJobView {
  return {
    id,
    kind: 'RENDER',
    status,
    stage: null,
    stageLabel: status === 'RUNNING' ? 'Drawing the frames' : status === 'DONE' ? 'Done' : 'Failed',
    progress: status === 'DONE' ? 100 : 42,
    etaSeconds: status === 'RUNNING' ? 180 : null,
    videoId: VIDEO,
    clipId: CLIP,
    error: null,
    result: null,
    createdAt: '2026-11-19T10:00:00.000Z',
    startedAt: '2026-11-19T10:00:01.000Z',
    finishedAt: status === 'DONE' || status === 'FAILED' ? '2026-11-19T10:02:00.000Z' : null,
    ...extra,
  };
}

function doneExport(id: string, fingerprint: string | null): ClipExportView {
  return {
    job: job(id, 'DONE'),
    quality: '1080p',
    fingerprint,
    media: {
      id: `media-${id}`,
      // Storage's own address, on another origin: never what Download fetches.
      url: `https://space.test/clips/media-${id}.mp4`,
      posterUrl: null,
      name: 'First Clip.mp4',
      bytes: 25_872_000,
      width: 1080,
      height: 1920,
      durationMs: 20_000,
    },
    loudness: { inputLufs: -20, inputTp: -3, finalLufs: -14.1, mode: 'linear' },
  };
}

let flush: jest.Mock<Promise<number | null>, []>;
let onExport: jest.Mock;
let onSend: jest.Mock;

function Harness({ sharp = 'ready' }: { sharp?: ClipSharpState }) {
  const state = useClipExport({ orgId: 'org-1', clipId: CLIP, flush, sharp });
  return (
    <TooltipProvider>
      <ExportPanel
        orgId="org-1"
        state={state}
        sharp={sharp}
        document={doc}
        sourceFps={30}
        onExport={onExport}
        onSend={onSend}
      />
      {/* The editor's own Export Clip (the panel footer). */}
      <button type="button" onClick={() => void state.start()}>
        Footer Export
      </button>
    </TooltipProvider>
  );
}

async function renderPanel(sharp?: ClipSharpState) {
  render(<Harness sharp={sharp} />);
  await waitFor(() => expect(list).toHaveBeenCalled());
  await waitFor(() => expect(latest).toHaveBeenCalled());
}

beforeAll(() => stubBrowserLayout());

beforeEach(() => {
  jest.clearAllMocks();
  mockJobs.clear();
  mockPlan.values = { 'clips.export_max_quality': '1080p', 'clips.export_watermark': false };
  flush = jest.fn(async (): Promise<number | null> => 3);
  onExport = jest.fn();
  onSend = jest.fn();
  list.mockResolvedValue([]);
  latest.mockResolvedValue(null);
});

describe('the quality tiles', () => {
  it('preselects the best one the plan allows, and locks the ones above it', async () => {
    await renderPanel();
    expect(screen.getByRole('button', { name: /^1080p Sharper picture/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const locked = screen.getByRole('button', { name: '1080p 60 fps, locked' });
    fireEvent.click(locked);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('1080p 60 fps Export')).toBeInTheDocument();
    expect(
      within(dialog).getByText('1080p 60 fps export needs a higher plan.'),
    ).toBeInTheDocument();
    // The chosen quality did not move (the open dialog hides the rest from the tree).
    expect(
      screen.getByRole('button', { name: /^1080p Sharper picture/, hidden: true }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('reads the summary back, with the mark note on a plan that marks', async () => {
    mockPlan.values = { 'clips.export_max_quality': '1080p', 'clips.export_watermark': true };
    await renderPanel();
    const summary = screen.getByTestId('clip-export-summary');
    expect(summary).toHaveTextContent(summaryLine(doc, '1080p'));
    expect(summary).toHaveTextContent('Vertical 9:16, 0:20, 1080p, about');
    expect(summary).toHaveTextContent(MARK_LINE);
    fireEvent.click(screen.getByRole('button', { name: /^720p Smaller file/ }));
    expect(screen.getByTestId('clip-export-summary')).toHaveTextContent(summaryLine(doc, '720p'));
  });

  it('with the sharp video gone, only 720p is left, and the notes say why', async () => {
    await renderPanel('gone');
    expect(screen.getByRole('button', { name: /^720p Smaller file/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: '1080p, locked' })).toBeInTheDocument();
    expect(screen.getByText(SHARP_LOCK_LINE)).toBeInTheDocument();
    expect(screen.getByTestId('clip-export-summary')).toHaveTextContent(SHARP_GONE_LINE);
  });
});

describe('starting an export', () => {
  it('saves first, then exports at the chosen quality and follows it', async () => {
    make.mockResolvedValue(job('e1', 'QUEUED'));
    await renderPanel();
    mockJobs.set('e1', job('e1', 'RUNNING'));
    fireEvent.click(screen.getByRole('button', { name: 'Footer Export' }));
    await waitFor(() => expect(make).toHaveBeenCalledWith(CLIP, '1080p', 3));
    expect(flush).toHaveBeenCalled();
    const progress = await screen.findByTestId('clip-export-progress');
    expect(progress).toHaveTextContent('Drawing the frames');
    expect(progress).toHaveTextContent('About 3 minutes left');
    expect(progress).toHaveTextContent(CLOSE_IS_FINE);
    cancel.mockResolvedValue(undefined as never);
    fireEvent.click(within(progress).getByRole('button', { name: 'Cancel Export' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('e1'));
  });

  it('does not export what is not saved yet', async () => {
    flush.mockResolvedValue(null);
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Footer Export' }));
    expect(await screen.findByText(EXPORT_UNSAVED_SENTENCE)).toBeInTheDocument();
    expect(make).not.toHaveBeenCalled();
  });

  it('opens the plan dialog when the API says the quality needs a higher plan', async () => {
    make.mockRejectedValue(
      new ApiError('1080p export needs a higher plan.', 402, 'clips_quality_requires_plan'),
    );
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Footer Export' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('1080p Export')).toBeInTheDocument();
  });

  it('picks up an export that is already running when the editor opens', async () => {
    list.mockResolvedValue([
      {
        job: job('e9', 'RUNNING'),
        quality: '720p',
        fingerprint: null,
        media: null,
        loudness: null,
      },
    ]);
    mockJobs.set('e9', job('e9', 'RUNNING', { stageLabel: 'Evening out the sound' }));
    await renderPanel();
    expect(await screen.findByTestId('clip-export-progress')).toHaveTextContent(
      'Evening out the sound',
    );
    expect(make).not.toHaveBeenCalled();
  });

  it('a failed export says so in one sentence, with Try Again', async () => {
    list.mockResolvedValue([
      { job: job('e4', 'FAILED'), quality: '720p', fingerprint: null, media: null, loudness: null },
    ]);
    // A failed one is not followed on open; one followed in this visit is.
    make.mockResolvedValue(job('e5', 'QUEUED'));
    mockJobs.set('e5', job('e5', 'FAILED'));
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Footer Export' }));
    const failed = await screen.findByTestId('clip-export-failed');
    expect(failed).toHaveTextContent(EXPORT_FAILED_SENTENCE);
    fireEvent.click(within(failed).getByRole('button', { name: 'Try Again' }));
    expect(onExport).toHaveBeenCalled();
  });
});

describe('a finished export', () => {
  it('shows the file, its size and loudness, and downloads it', async () => {
    list.mockResolvedValue([doneExport('d1', documentFingerprint(doc))]);
    await renderPanel();
    const card = await screen.findByTestId('clip-export-result');
    expect(card).toHaveTextContent('First Clip.mp4');
    expect(card).toHaveTextContent('1080p, 26 MB');
    expect(card).toHaveTextContent('Evened out to about -14 LUFS.');
    // Module 17: Send To Composer is live and hands its button over for the focus return.
    const send = within(card).getByRole('button', { name: 'Send To Composer' });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledWith(send);
    expect(within(card).getByRole('link', { name: 'Open In Media' })).toHaveAttribute(
      'href',
      '/org-1/media',
    );
    fireEvent.click(within(card).getByRole('button', { name: 'Download' }));
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith('/media/media-d1/download', 'First Clip.mp4'),
    );
    // Drawn from this very version: nothing is out of date.
    expect(screen.queryByTestId('clip-export-stale')).toBeNull();
  });

  it('says the clip changed after the last export, with Export Again', async () => {
    list.mockResolvedValue([doneExport('d2', 'v1-0000000000000000000000000000')]);
    await renderPanel();
    const stale = await screen.findByTestId('clip-export-stale');
    expect(stale).toHaveTextContent(OUT_OF_DATE);
    fireEvent.click(within(stale).getByRole('button', { name: 'Export Again' }));
    expect(onExport).toHaveBeenCalled();
  });

  it('lists the recent exports when there is more than one', async () => {
    list.mockResolvedValue([doneExport('d3', null), doneExport('d4', null)]);
    await renderPanel();
    const history = await screen.findByTestId('clip-export-history');
    expect(within(history).getAllByRole('listitem')).toHaveLength(2);
    // An older one downloads through Media's route too, never from storage's address.
    fireEvent.click(within(history).getAllByRole('button', { name: /^Download 1080p From/ })[1]);
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith('/media/media-d4/download', 'First Clip.mp4'),
    );
  });
});

describe('Preview Export', () => {
  it('makes a small copy in a dialog, plays it, and can go on to export', async () => {
    const view: ClipPreviewView = {
      job: job('p1', 'DONE'),
      fingerprint: documentFingerprint(doc),
      url: 'https://space.test/preview.mp4',
      expiresAt: '2026-11-20T10:00:00.000Z',
    };
    latest.mockResolvedValueOnce(null).mockResolvedValueOnce(view);
    preview.mockResolvedValue(job('p1', 'QUEUED'));
    await renderPanel();
    mockJobs.set('p1', job('p1', 'DONE'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('clip-preview-export'));
    });
    expect(flush).toHaveBeenCalled();
    expect(preview).toHaveBeenCalledWith(CLIP, 3);
    const video = await screen.findByTestId('clip-preview-video');
    expect(video).toHaveAttribute('src', 'https://space.test/preview.mp4');
    const dialog = screen.getByTestId('clip-preview-dialog');
    expect(dialog).toHaveTextContent(PREVIEW_SMALLER);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Export Clip' }));
    expect(onExport).toHaveBeenCalled();
  });

  it('shows the step while the preview is made, with Cancel', async () => {
    preview.mockResolvedValue(job('p2', 'QUEUED'));
    await renderPanel();
    mockJobs.set('p2', job('p2', 'RUNNING', { stageLabel: 'Making the preview' }));
    await act(async () => {
      fireEvent.click(screen.getByTestId('clip-preview-export'));
    });
    const progress = await screen.findByTestId('clip-preview-progress');
    expect(progress).toHaveTextContent('Making the preview');
    cancel.mockResolvedValue(undefined as never);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('p2'));
  });
});

describe('leaving out removed items', () => {
  it('finds the stickers and sounds whose files are gone, and asks in one sentence', () => {
    const withItems = {
      ...doc,
      tracks: [
        {
          id: 'ov',
          kind: 'overlay' as const,
          items: [
            {
              id: 's1',
              type: 'sticker' as const,
              ref: { kind: 'library' as const, id: 'gone' },
            },
          ],
        },
        {
          id: 'au',
          kind: 'audio' as const,
          items: [
            { id: 'a1', type: 'sfx' as const, ref: { kind: 'library' as const, id: 'kept' } },
            { id: 'a2', type: 'music' as const, ref: { kind: 'upload' as const, id: 'gone' } },
          ],
        },
      ],
    } as unknown as typeof doc;
    const gone = goneItems(
      withItems,
      () => true,
      (item) => (item.ref as { id: string }).id === 'gone',
    );
    expect(gone).toEqual({ stickers: ['s1'], sounds: ['a2'] });
    expect(leaveOutSentence(1, 1)).toBe(
      'This clip uses a sound and a sticker that were removed. Export without them?',
    );
    expect(leaveOutSentence(0, 1)).toBe(
      'This clip uses a sound that was removed. Export without it?',
    );
    expect(leaveOutSentence(2, 0)).toBe(
      'This clip uses 2 stickers that were removed. Export without them?',
    );
  });
});
