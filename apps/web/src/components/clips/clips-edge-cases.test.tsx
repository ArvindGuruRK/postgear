/**
 * Sprint 12, Module 20 section 2: the web app's share of the stories' edge
 * cases (section 5 of `docs/new-modules/user-stories-clips.md`) that no older
 * test shows on screen, plus every sentence the web app writes itself pinned
 * word for word against the story.
 *
 * - "Edit Whole Video on a video over 30 minutes": the menu item is off with
 *   its reason.
 * - "The connection drops during upload": the row says "Waiting for your
 *   connection" (the carrying on is `video-uploader.test.ts`).
 * - "A channel list cannot be read": the old list with the sentence and
 *   "Updated 3 hours ago".
 * - "A locked quality is picked", "Preview Export fails" and "The clip changed
 *   after the last preview" in the export panel.
 * - "A non-operator opens the operator address": the ordinary not found page.
 * - "The window is narrower than 1366 px": the one sentence.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { TooltipProvider } from '@postgear/ui';
import { type ClipDocument, createClipDocument, documentFingerprint } from '@postgear/video-engine';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { exportClip, latestClipPreview, listClipExports, previewClip } from '@/lib/clips-api';
import type { ClipJobView, ClipPreviewView, ClipStreamsPage, ClipVideoCard } from '@/types/clips';
import { ChannelBrowser, type ChannelBrowserApi } from './channels/channel-browser';
import { EMPTY_CHANNEL } from './channels/channels-model';
import { FIXTURE_CARDS, FIXTURE_CHANNEL, FIXTURE_STREAMS, fixtureProbe } from './clips-fixtures';
import { BIGGER_SCREEN_SENTENCE } from './clips-model';
import { ClipsDesktopOnly } from './desktop-only';
import { CONFLICT_SENTENCE, SHARP_GONE_SENTENCE } from './editor/clip-editor-model';
import {
  EXPORT_FAILED_SENTENCE,
  PREVIEW_FAILED_SENTENCE,
  PREVIEW_STALE,
  SHARP_GONE_LINE,
} from './editor/export-model';
import { ExportPanel, useClipExport } from './editor/export-panel';
import { UPLOAD_NOT_VIDEO } from './home/home-model';
import { ALREADY_HERE, TWITCH_MUTED_LINE } from './home/link-card';
import { UploadRow } from './home/upload-row';
import { EDIT_WHOLE_TOO_LONG, VideoCard, type VideoCardActions } from './home/video-card';
import { type UploadSnapshot, WAITING_FOR_CONNECTION } from './home/video-uploader';
import { REMOVED_SOUND } from './panels/audio-model';
import { REMOVED_STICKER } from './panels/elements-model';
import { HIGHLIGHTS_FAILED, NO_SOUND_NOTE } from './video/find-clips-model';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
jest.mock('next/navigation', () => ({
  ...jest.requireActual('next/navigation'),
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: jest.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
}));
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));
jest.mock('@/components/navigation/workspace-provider', () => ({
  useWorkspace: () => ({ activeOrgId: 'org-1' }),
}));
jest.mock('@/lib/clips-api', () => ({
  getVideo: jest.fn(),
  exportClip: jest.fn(),
  listClipExports: jest.fn(),
  previewClip: jest.fn(),
  latestClipPreview: jest.fn(),
  cancelClipJob: jest.fn(),
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
jest.mock('./use-clip-job', () => ({
  useClipJob: (id: string | null) => ({
    job: id ? (mockJobs.get(id) ?? null) : null,
    error: null,
    refresh: jest.fn(),
  }),
}));

const { notFound, redirect } = jest.requireMock('next/navigation') as {
  notFound: jest.Mock;
  redirect: jest.Mock;
};
const { getSession } = jest.requireMock('@/lib/session') as { getSession: jest.Mock };
const make = exportClip as jest.MockedFunction<typeof exportClip>;
const list = listClipExports as jest.MockedFunction<typeof listClipExports>;
const preview = previewClip as jest.MockedFunction<typeof previewClip>;
const latest = latestClipPreview as jest.MockedFunction<typeof latestClipPreview>;

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});
beforeEach(() => {
  jest.clearAllMocks();
  mockJobs.clear();
  mockPlan.values = { 'clips.export_max_quality': '1080p', 'clips.export_watermark': false };
});

// ---- The sentences the web app writes itself ----------------------------------------

describe('the web sentences, as the stories write them', () => {
  it.each([
    ['The same video is already in the workspace', ALREADY_HERE, 'You already have this video.'],
    [
      'A Twitch past stream has muted parts',
      TWITCH_MUTED_LINE,
      'Twitch may have muted parts of this stream. Clips from muted parts will be silent.',
    ],
    ['A channel has no public videos', EMPTY_CHANNEL, 'This channel has no public videos yet.'],
    [
      'The upload is not a video',
      UPLOAD_NOT_VIDEO,
      'This file is not a video we can read. Use MP4, MOV, MKV or WebM.',
    ],
    ['The connection drops during upload', WAITING_FOR_CONNECTION, 'Waiting for your connection'],
    [
      'The video has no sound',
      NO_SOUND_NOTE,
      'This video has no sound, so we looked at the picture only.',
    ],
    [
      'Find Clips fails',
      HIGHLIGHTS_FAILED,
      'We could not finish looking for clips. Your AI minutes were given back.',
    ],
    [
      'The sharp video cannot be fetched any more (the editor)',
      SHARP_GONE_SENTENCE,
      'The sharp video is no longer online. This clip will export at 720p from the copy we kept.',
    ],
    [
      'The sharp video cannot be fetched any more (the export panel)',
      SHARP_GONE_LINE,
      'The sharp video is no longer online. This clip will export at 720p from the copy we kept.',
    ],
    [
      'Two people edit one clip',
      CONFLICT_SENTENCE,
      'Someone else changed this clip. Reload to see their version.',
    ],
    [
      'The export fails',
      EXPORT_FAILED_SENTENCE,
      'We could not export this clip. Nothing was charged. Try again.',
    ],
    ['Preview Export fails', PREVIEW_FAILED_SENTENCE, 'We could not make the preview. Try again.'],
    [
      'The clip changed after the last preview',
      PREVIEW_STALE,
      'You changed this clip after the last preview.',
    ],
    [
      'A library item is removed after I used it (sticker)',
      REMOVED_STICKER,
      'This sticker was removed from the library.',
    ],
    [
      'A library item is removed after I used it (sound)',
      REMOVED_SOUND,
      'This sound was removed from the library.',
    ],
    [
      'The window is narrower than 1366 px',
      BIGGER_SCREEN_SENTENCE,
      'Clips is made for a bigger screen. Open it on a laptop or desktop.',
    ],
  ])('"%s"', (_row, shipped, story) => {
    expect(shipped).toBe(story);
  });

  it('"Edit Whole Video on a video over 30 minutes" keeps its shipped reason (a Decision Log difference)', () => {
    // The story: "A clip can be up to 30 minutes. Mark the part you want, then
    // press Create Clip." The Module 07 doc wrote the menu's own sentence.
    expect(EDIT_WHOLE_TOO_LONG).toBe(
      'Edit Whole Video works for videos up to 30 minutes. Mark a range to make a clip.',
    );
  });
});

// ---- Edit Whole Video over 30 minutes ---------------------------------------------------

describe('"Edit Whole Video on a video over 30 minutes"', () => {
  function actions(): VideoCardActions {
    return {
      onCancel: jest.fn(async () => undefined),
      onRetry: jest.fn(async () => undefined),
      onDelete: jest.fn(async () => undefined),
      onSettled: jest.fn(),
      onEditWhole: jest.fn(async () => undefined),
    };
  }

  function cardOf(minutes: number, title: string): ClipVideoCard {
    return {
      ...FIXTURE_CARDS.ready,
      video: {
        ...FIXTURE_CARDS.ready.video,
        id: `video-${minutes}`,
        title,
        durationMs: minutes * 60_000,
      },
    };
  }

  async function openMenu(card: ClipVideoCard, cardActions: VideoCardActions) {
    render(
      <TooltipProvider>
        <ul>
          <VideoCard card={card} orgId="org-1" actions={cardActions} follow={false} />
        </ul>
      </TooltipProvider>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: `More for ${card.video.title}` }), {
      key: 'Enter',
    });
    return screen.findByRole('menuitem', { name: 'Edit Whole Video' });
  }

  it('is off on a 31 minute video, with its reason', async () => {
    const cardActions = actions();
    const item = await openMenu(cardOf(31, 'A Long Talk'), cardActions);
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveAttribute('title', EDIT_WHOLE_TOO_LONG);
    fireEvent.click(item);
    expect(cardActions.onEditWhole).not.toHaveBeenCalled();
  });

  it('works on a 30 minute video', async () => {
    const cardActions = actions();
    const item = await openMenu(cardOf(30, 'A Short Talk'), cardActions);
    expect(item).not.toHaveAttribute('aria-disabled');
    expect(item).not.toHaveAttribute('title');
    await act(async () => {
      fireEvent.click(item);
    });
    expect(cardActions.onEditWhole).toHaveBeenCalledWith('video-30');
  });
});

// ---- The connection drops during upload ---------------------------------------------------

describe('"The connection drops during upload"', () => {
  it('the row pauses with "Waiting for your connection" and keeps Cancel', () => {
    const upload: UploadSnapshot = {
      id: 'up-1',
      name: 'Match Day.mp4',
      bytes: 1_200_000_000,
      phase: 'waiting',
      percent: 48,
      error: null,
      errorCode: null,
      videoId: null,
    };
    render(
      <TooltipProvider>
        <ul>
          <UploadRow upload={upload} orgId="org-1" onCancel={jest.fn()} onDismiss={jest.fn()} />
        </ul>
      </TooltipProvider>,
    );
    const row = screen.getByTestId('clips-upload-row');
    expect(row).toHaveAttribute('data-phase', 'waiting');
    expect(row).toHaveTextContent('1.2 GB, Waiting for your connection');
    expect(within(row).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});

// ---- A channel list cannot be read ----------------------------------------------------------

describe('"A channel list cannot be read"', () => {
  const NOT_READABLE =
    "This channel's list is not available right now. Try again in a few minutes.";

  function stalePage(): ClipStreamsPage {
    return {
      kind: 'streams',
      sort: 'newest',
      period: null,
      items: FIXTURE_STREAMS.filter((item) => !item.hidden),
      nextCursor: null,
      updatedAt: new Date(Date.now() - (3 * 60 + 5) * 60_000).toISOString(),
      stale: true,
      capped: false,
      notice: NOT_READABLE,
    };
  }

  it('shows its last answer with the sentence, marked "Updated 3 hours ago"', async () => {
    const api = {
      list: jest.fn(async () => stalePage()),
      refresh: jest.fn(),
      probe: jest.fn(async () => fixtureProbe()),
      hide: jest.fn(),
      unhide: jest.fn(),
      remove: jest.fn(),
      check: jest.fn(),
      add: jest.fn(),
    } as unknown as ChannelBrowserApi;
    render(
      <TooltipProvider>
        <ChannelBrowser
          orgId="org-1"
          platforms={['youtube', 'twitch', 'kick']}
          channelsState={{
            channels: [FIXTURE_CHANNEL],
            loading: false,
            error: null,
            reload: jest.fn(),
            added: jest.fn(),
            removed: jest.fn(),
          }}
          api={api}
          onProbed={jest.fn()}
        />
      </TooltipProvider>,
    );
    expect(await screen.findByText(NOT_READABLE)).toBeInTheDocument();
    expect(screen.getByText(/^Updated 3 hours ago, /)).toBeInTheDocument();
    // The rows are still there to import from.
    expect(screen.getByText(FIXTURE_STREAMS[0].title)).toBeInTheDocument();
  });
});

// ---- The export panel ----------------------------------------------------------------------

const VIDEO = '11111111-1111-4111-8111-111111111111';
const CLIP = '22222222-2222-4222-8222-222222222222';
const DOC = createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 20_000, ratio: '9:16' });

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
    stageLabel: status === 'DONE' ? 'Done' : status === 'FAILED' ? 'Failed' : 'Making the preview',
    progress: status === 'DONE' ? 100 : 42,
    etaSeconds: null,
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

const flush = jest.fn(async (): Promise<number | null> => 3);
const onExport = jest.fn();

function Panel({ document }: { document: ClipDocument }) {
  const state = useClipExport({ orgId: 'org-1', clipId: CLIP, flush, sharp: 'ready' });
  return (
    <TooltipProvider>
      <ExportPanel
        orgId="org-1"
        state={state}
        sharp="ready"
        document={document}
        sourceFps={30}
        onExport={onExport}
        onSend={jest.fn()}
      />
    </TooltipProvider>
  );
}

async function renderPanel(document: ClipDocument = DOC) {
  const view = render(<Panel document={document} />);
  await waitFor(() => expect(list).toHaveBeenCalled());
  await waitFor(() => expect(latest).toHaveBeenCalled());
  return view;
}

describe('the export panel edge cases', () => {
  beforeEach(() => {
    flush.mockClear();
    onExport.mockClear();
    list.mockResolvedValue([]);
    latest.mockResolvedValue(null);
  });

  it('"A locked quality is picked": 1080p on a 720p plan opens the plan dialog with See Plans', async () => {
    mockPlan.values = { 'clips.export_max_quality': '720p', 'clips.export_watermark': false };
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '1080p, locked' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('1080p export needs a higher plan.')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'See Plans' })).toHaveAttribute(
      'href',
      '/org-1/settings/billing',
    );
    expect(make).not.toHaveBeenCalled();
  });

  it('"Preview Export fails": the sentence with Try Again; nothing exported, nothing used', async () => {
    preview.mockResolvedValue(job('p-fail', 'QUEUED'));
    await renderPanel();
    mockJobs.set(
      'p-fail',
      job('p-fail', 'FAILED', {
        error: { code: 'preview_failed', message: PREVIEW_FAILED_SENTENCE },
      }),
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('clip-preview-export'));
    });
    const failed = await screen.findByTestId('clip-preview-failed');
    expect(failed).toHaveTextContent('We could not make the preview. Try again.');
    const dialog = screen.getByTestId('clip-preview-dialog');
    expect(within(dialog).queryByRole('button', { name: 'Export Clip' })).not.toBeInTheDocument();
    expect(make).not.toHaveBeenCalled();
    expect(onExport).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(failed).getByRole('button', { name: 'Try Again' }));
    });
    expect(preview).toHaveBeenCalledTimes(2);
    expect(make).not.toHaveBeenCalled();
  });

  it('"The clip changed after the last preview": the note shows once the clip moves on', async () => {
    const ready: ClipPreviewView = {
      job: job('p-done', 'DONE'),
      fingerprint: documentFingerprint(DOC),
      url: 'https://space.test/preview.mp4',
      expiresAt: '2026-11-20T10:00:00.000Z',
    };
    latest.mockResolvedValueOnce(null).mockResolvedValue(ready);
    preview.mockResolvedValue(job('p-done', 'QUEUED'));
    const view = await renderPanel();
    mockJobs.set('p-done', job('p-done', 'DONE'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('clip-preview-export'));
    });
    await screen.findByTestId('clip-preview-video');
    expect(screen.queryByText(PREVIEW_STALE)).not.toBeInTheDocument();

    // The person edits the clip after the preview was made.
    const changed = createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 25_000, ratio: '9:16' });
    view.rerender(<Panel document={changed} />);
    expect(
      await screen.findByText('You changed this clip after the last preview.'),
    ).toBeInTheDocument();
    // Preview Export stays on the panel to make a new one.
    expect(screen.getByTestId('clip-preview-export')).toBeInTheDocument();
  });
});

// ---- A non-operator opens the operator address --------------------------------------------

describe('"A non-operator opens the operator address"', () => {
  async function gate() {
    // A fresh module each time: `requireOperator` is cached per request.
    let mod: typeof import('@/components/operator/require-operator') | undefined;
    jest.isolateModules(() => {
      mod = require('@/components/operator/require-operator');
    });
    return (mod as typeof import('@/components/operator/require-operator')).requireOperator();
  }

  const user = { id: 'u-1', email: 'member@postgear.local', name: 'Member', onboardingStep: 9 };

  it('gets the ordinary not found page', async () => {
    getSession.mockResolvedValue({ ...user, isSuperAdmin: false });
    await expect(gate()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('signed out, goes to Login like any page; an operator gets in', async () => {
    getSession.mockResolvedValue(null);
    await expect(gate()).rejects.toThrow('NEXT_REDIRECT /login');

    getSession.mockResolvedValue({ ...user, isSuperAdmin: true });
    await expect(gate()).resolves.toMatchObject({ isSuperAdmin: true });
  });
});

// ---- The window is narrower than 1366 px -----------------------------------------------------

describe('"The window is narrower than 1366 px"', () => {
  it('shows the one sentence under the desk breakpoint, and the page from it up', () => {
    render(
      <ClipsDesktopOnly>
        <p>The Clips Page</p>
      </ClipsDesktopOnly>,
    );
    const sentence = screen.getByText(BIGGER_SCREEN_SENTENCE);
    expect(sentence.closest('.desk\\:hidden')).not.toBeNull();
    expect(screen.getByText('The Clips Page').closest('.desk\\:contents')).not.toBeNull();
  });

  it('the desk breakpoint is 1366 px', () => {
    const css = readFileSync(
      path.join(__dirname, '../../../../../packages/config/tailwind.css'),
      'utf8',
    );
    const rem = /--breakpoint-desk:\s*([\d.]+)rem/.exec(css)?.[1];
    expect(Number(rem) * 16).toBe(1366);
  });
});
