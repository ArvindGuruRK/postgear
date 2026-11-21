import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { ApiError, api } from '@/lib/api';
import { cancelClipJob, exportClip, listClipExports, sendClip } from '@/lib/clips-api';
import type { Channel } from '@/types/channel';
import type { ClipJobView } from '@/types/clips';
import { SendClipDialog, type SendClipDialogProps, type SendExportRun } from './send-dialog';
import { SEND_PROVIDERS, sendChannel, sendExport, sendJob } from './send-fixtures';
import { SEND_NO_CHANNELS, SEND_OUTDATED } from './send-model';

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
jest.mock('@/lib/clips-api', () => ({
  listClipExports: jest.fn(),
  exportClip: jest.fn(),
  cancelClipJob: jest.fn(),
  sendClip: jest.fn(),
}));
const mockPlan: { values: Record<string, unknown> } = { values: {} };
jest.mock('@/lib/entitlements', () => ({
  useEntitlements: () => ({
    snapshot: { values: mockPlan.values },
    status: 'ready',
    refresh: jest.fn(),
  }),
}));
const mockJobs = new Map<string, ClipJobView>();
jest.mock('../use-clip-job', () => ({
  useClipJob: (id: string | null) => ({
    job: id ? (mockJobs.get(id) ?? null) : null,
    error: null,
    refresh: jest.fn(),
  }),
}));

const apiMock = api as jest.MockedFunction<typeof api>;
const exportsMock = listClipExports as jest.MockedFunction<typeof listClipExports>;
const exportMock = exportClip as jest.MockedFunction<typeof exportClip>;
const cancelMock = cancelClipJob as jest.MockedFunction<typeof cancelClipJob>;
const sendMock = sendClip as jest.MockedFunction<typeof sendClip>;

const CHANNELS: Channel[] = [
  sendChannel('yt-1', 'youtube', 'Acme Shorts'),
  sendChannel('ig-1', 'instagram-standalone', 'Acme Reels'),
  sendChannel('li-1', 'linkedin', 'Acme On LinkedIn'),
];
let channels: Channel[] = CHANNELS;

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});

beforeEach(() => {
  jest.clearAllMocks();
  mockJobs.clear();
  mockPlan.values = { 'clips.export_max_quality': '1080p' };
  channels = CHANNELS;
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/channels') return { channels, limit: null } as never;
    if (path === '/channels/providers') return { providers: SEND_PROVIDERS } as never;
    throw new Error(`unexpected ${path}`);
  });
  exportsMock.mockResolvedValue([sendExport('a', { id: 'media-a' }, '720p')]);
  sendMock.mockResolvedValue({ group: 'group-1' });
  cancelMock.mockResolvedValue(undefined as never);
});

function props(overrides: Partial<SendClipDialogProps> = {}): SendClipDialogProps {
  return {
    open: true,
    onOpenChange: jest.fn(),
    orgId: 'org-1',
    clip: { id: 'clip-1', title: 'Team Talk', durationMs: 42_000, exportedMediaId: 'media-a' },
    outdated: false,
    onSent: jest.fn(),
    ...overrides,
  };
}

function show(overrides: Partial<SendClipDialogProps> = {}) {
  const all = props(overrides);
  const view = render(
    <TooltipProvider>
      <SendClipDialog {...all} />
    </TooltipProvider>,
  );
  const again = (next: Partial<SendClipDialogProps> = {}) =>
    view.rerender(
      <TooltipProvider>
        <SendClipDialog {...all} {...next} />
      </TooltipProvider>,
    );
  return { ...all, again };
}

/** From a card, Export Again waits for the last export's quality. */
async function exportAgainReady() {
  await waitFor(() => expect(screen.getByTestId('clip-send-export-again')).toBeEnabled());
}

function row(name: string) {
  const found = screen
    .getAllByTestId('clip-send-channel')
    .find((one) => within(one).queryByText(name) !== null);
  if (!found) throw new Error(`no row for ${name}`);
  return found;
}

describe('SendClipDialog', () => {
  it('lists every channel, greys the ones the clip does not fit with the reason, and sends the ticked ones', async () => {
    const { onSent } = show();
    await screen.findAllByTestId('clip-send-channel');

    const linkedIn = row('Acme On LinkedIn');
    expect(linkedIn).toHaveAttribute('data-disabled', 'true');
    expect(within(linkedIn).getByTestId('clip-send-reason')).toHaveTextContent(
      'LinkedIn does not take video here.',
    );
    const box = within(linkedIn).getByRole('checkbox');
    expect(box).toBeDisabled();
    expect(box).toHaveAccessibleDescription('LinkedIn does not take video here.');
    fireEvent.click(box);
    expect(box).not.toBeChecked();

    const open = screen.getByTestId('clip-send-open');
    expect(open).toBeDisabled();
    fireEvent.click(within(row('Acme Shorts')).getByRole('checkbox'));
    fireEvent.click(within(row('Acme Reels')).getByRole('checkbox'));
    fireEvent.change(screen.getByTestId('clip-send-caption'), { target: { value: 'Big moment' } });
    expect(screen.getByText('10 / 3,000')).toBeVisible();
    expect(open).toBeEnabled();
    fireEvent.click(open);

    await waitFor(() => expect(onSent).toHaveBeenCalledWith('group-1'));
    expect(sendMock).toHaveBeenCalledWith('clip-1', {
      channelIds: ['yt-1', 'ig-1'],
      caption: 'Big moment',
    });
  });

  it('reads the facts of the exported file: a 16 minute clip fits nowhere that takes video', async () => {
    exportsMock.mockResolvedValue([sendExport('a', { id: 'media-a', durationMs: 16 * 60_000 })]);
    show();
    await screen.findAllByTestId('clip-send-channel');
    expect(within(row('Acme Shorts')).getByTestId('clip-send-reason')).toHaveTextContent(
      'This clip is 16 min. YouTube takes up to 15 minutes.',
    );
    expect(within(row('Acme Reels')).getByRole('checkbox')).toBeDisabled();
  });

  it('opens on Export Again for a clip changed since its export; Send The Old Version sends the old file', async () => {
    const { onSent } = show({ outdated: true });
    const step = await screen.findByTestId('clip-send-outdated');
    expect(step).toHaveTextContent(SEND_OUTDATED);
    expect(screen.queryByTestId('clip-send-channels')).toBeNull();

    fireEvent.click(within(step).getByRole('button', { name: 'Send The Old Version' }));
    await screen.findAllByTestId('clip-send-channel');
    fireEvent.click(within(row('Acme Shorts')).getByRole('checkbox'));
    fireEvent.click(screen.getByTestId('clip-send-open'));
    await waitFor(() => expect(onSent).toHaveBeenCalledWith('group-1'));
    expect(sendMock).toHaveBeenCalledWith('clip-1', {
      channelIds: ['yt-1'],
      caption: '',
      oldVersion: true,
    });
  });

  it('exports again from a card at the last quality the plan allows, shows its progress, then goes on', async () => {
    exportMock.mockResolvedValue(sendJob('job-new', 'QUEUED'));
    mockJobs.set('job-new', sendJob('job-new', 'RUNNING'));
    const { again } = show({ outdated: true });
    await exportAgainReady();
    fireEvent.click(screen.getByTestId('clip-send-export-again'));
    await waitFor(() => expect(exportMock).toHaveBeenCalledWith('clip-1', '720p'));
    expect(await screen.findByTestId('clip-send-exporting')).toHaveTextContent(
      'Drawing the frames',
    );

    mockJobs.set('job-new', sendJob('job-new', 'DONE'));
    exportsMock.mockResolvedValue([
      sendExport('b', { id: 'media-b' }, '720p'),
      sendExport('a', { id: 'media-a' }, '720p'),
    ]);
    again();
    await screen.findAllByTestId('clip-send-channel');
    expect(exportsMock).toHaveBeenCalledTimes(2);
    fireEvent.click(within(row('Acme Shorts')).getByRole('checkbox'));
    fireEvent.click(screen.getByTestId('clip-send-open'));
    // A fresh export: no old version asked for.
    await waitFor(() =>
      expect(sendMock).toHaveBeenCalledWith('clip-1', { channelIds: ['yt-1'], caption: '' }),
    );
  });

  it('a plan below the last quality exports at the best one it allows', async () => {
    mockPlan.values = { 'clips.export_max_quality': '720p' };
    exportsMock.mockResolvedValue([sendExport('a', { id: 'media-a' }, '1080p')]);
    exportMock.mockResolvedValue(sendJob('job-new', 'QUEUED'));
    show({ outdated: true });
    await exportAgainReady();
    fireEvent.click(screen.getByTestId('clip-send-export-again'));
    await waitFor(() => expect(exportMock).toHaveBeenCalledWith('clip-1', '720p'));
  });

  it('in the editor, Export Again is the editor own export, and a declined question goes back to the step', async () => {
    const start = jest.fn();
    const run = (over: Partial<SendExportRun> = {}): SendExportRun => ({
      start,
      cancel: jest.fn(),
      jobId: 'job-old',
      job: sendJob('job-old', 'DONE'),
      busy: false,
      problem: null,
      ...over,
    });
    const { again } = show({ outdated: true, exportRun: run() });
    fireEvent.click(await screen.findByTestId('clip-send-export-again'));
    expect(start).toHaveBeenCalledTimes(1);

    // The editor asks about removed items first (busy), then the person says no.
    again({ exportRun: run({ busy: true }) });
    expect(screen.getByTestId('clip-send-exporting')).toBeVisible();
    again({ exportRun: run({ busy: false }) });
    expect(await screen.findByTestId('clip-send-export-again')).toBeVisible();

    // This time it runs and finishes.
    fireEvent.click(screen.getByTestId('clip-send-export-again'));
    again({ exportRun: run({ busy: true }) });
    again({ exportRun: run({ jobId: 'job-new', job: sendJob('job-new', 'RUNNING') }) });
    expect(screen.getByTestId('clip-send-exporting')).toHaveTextContent('Drawing the frames');
    again({ exportRun: run({ jobId: 'job-new', job: sendJob('job-new', 'DONE') }) });
    expect(await screen.findAllByTestId('clip-send-channel')).toHaveLength(3);
  });

  it('goes back to the step when the server says the clip changed after all', async () => {
    sendMock.mockRejectedValueOnce(
      new ApiError('You changed this clip after the last export.', 409, 'clip_export_outdated'),
    );
    show();
    await screen.findAllByTestId('clip-send-channel');
    fireEvent.click(within(row('Acme Shorts')).getByRole('checkbox'));
    fireEvent.click(screen.getByTestId('clip-send-open'));
    expect(await screen.findByTestId('clip-send-outdated')).toBeVisible();
  });

  it('says what went wrong when the draft is refused', async () => {
    sendMock.mockRejectedValueOnce(
      new ApiError('These channels cannot take this clip.', 422, 'clip_does_not_fit'),
    );
    const { onSent } = show();
    await screen.findAllByTestId('clip-send-channel');
    fireEvent.click(within(row('Acme Shorts')).getByRole('checkbox'));
    fireEvent.click(screen.getByTestId('clip-send-open'));
    expect(await screen.findByTestId('clip-send-problem')).toHaveTextContent(
      'These channels cannot take this clip.',
    );
    expect(onSent).not.toHaveBeenCalled();
  });

  it('with no channels, points to the Channels page and offers nothing to send', async () => {
    channels = [];
    show();
    const empty = await screen.findByTestId('clip-send-empty');
    expect(empty).toHaveTextContent(SEND_NO_CHANNELS);
    expect(within(empty).getByRole('link', { name: 'Go To Channels' })).toHaveAttribute(
      'href',
      '/org-1/channels',
    );
    expect(screen.queryByTestId('clip-send-caption')).toBeNull();
    expect(screen.getByTestId('clip-send-open')).toBeDisabled();
  });

  it('Cancel closes the dialog', async () => {
    const { onOpenChange } = show();
    await screen.findAllByTestId('clip-send-channel');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
