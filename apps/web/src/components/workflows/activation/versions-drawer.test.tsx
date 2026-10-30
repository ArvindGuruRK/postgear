import { GRAPH_SCHEMA_VERSION } from '@postgear/automation';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { AutomationDetail, VersionDetail, VersionSummary } from '@/types/workflows';
import { stubBrowserLayout } from '../fields/test-dom';
import { NO_VERSIONS } from './activation-model';
import { VersionPreviewBanner, VersionsDrawer } from './versions-drawer';

jest.mock('@/lib/workflows-api', () => ({
  listVersions: jest.fn(),
  getVersion: jest.fn(),
  restoreVersion: jest.fn(),
}));
jest.mock('@postgear/ui', () => ({ ...jest.requireActual('@postgear/ui'), toast: jest.fn() }));

const api = jest.requireMock('@/lib/workflows-api') as Record<string, jest.Mock>;
const { toast } = jest.requireMock('@postgear/ui') as { toast: jest.Mock };

beforeAll(() => {
  stubBrowserLayout();
  // The sheet focuses its close button on open, which plays its animated icon;
  // the icon stub is a bare <svg> without the animation handle.
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});
beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  toast.mockReset();
});

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const versions: VersionSummary[] = [
  {
    version: 2,
    note: 'Shorter message',
    triggerType: 'trigger.postPublished',
    createdAt: minutesAgo(120),
    createdBy: { id: 'u1', name: 'Priya' },
    active: true,
  },
  {
    version: 1,
    note: null,
    triggerType: 'trigger.postPublished',
    createdAt: minutesAgo(60 * 24 * 3),
    createdBy: null,
    active: false,
  },
];

const detail: VersionDetail = {
  ...versions[1],
  graph: { schemaVersion: GRAPH_SCHEMA_VERSION, nodes: [], edges: [], notes: [] },
};

describe('VersionsDrawer', () => {
  it('lists each version with its number, author, time, note and the Active marker', async () => {
    api.listVersions.mockResolvedValue(versions);
    await act(async () => {
      render(
        <VersionsDrawer
          open
          onOpenChange={jest.fn()}
          automationId="wf-1"
          previewing={null}
          onPreview={jest.fn()}
        />,
      );
    });
    expect(api.listVersions).toHaveBeenCalledWith('wf-1');
    const rows = screen.getAllByTestId('version-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Version 2')).toBeTruthy();
    expect(within(rows[0]).getByText('Active')).toBeTruthy();
    expect(within(rows[0]).getByText('Turned on by Priya, 2 hours ago')).toBeTruthy();
    expect(within(rows[0]).getByText('Shorter message')).toBeTruthy();
    expect(within(rows[1]).getByText('Version 1')).toBeTruthy();
    expect(within(rows[1]).queryByText('Active')).toBeNull();
    expect(within(rows[1]).getByText('Turned on 3 days ago')).toBeTruthy();
  });

  it('previews a version on the canvas and closes', async () => {
    api.listVersions.mockResolvedValue(versions);
    api.getVersion.mockResolvedValue(detail);
    const onPreview = jest.fn();
    const onOpenChange = jest.fn();
    await act(async () => {
      render(
        <VersionsDrawer
          open
          onOpenChange={onOpenChange}
          automationId="wf-1"
          previewing={null}
          onPreview={onPreview}
        />,
      );
    });
    await act(async () => {
      fireEvent.click(screen.getAllByTestId('version-row')[1]);
    });
    expect(api.getVersion).toHaveBeenCalledWith('wf-1', 1);
    expect(onPreview).toHaveBeenCalledWith(detail);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('says when there are no versions yet', async () => {
    api.listVersions.mockResolvedValue([]);
    await act(async () => {
      render(
        <VersionsDrawer
          open
          onOpenChange={jest.fn()}
          automationId="wf-1"
          previewing={null}
          onPreview={jest.fn()}
        />,
      );
    });
    expect(screen.getByText(NO_VERSIONS)).toBeTruthy();
  });
});

describe('VersionPreviewBanner', () => {
  it('restores the version as the draft after saving the latest edits', async () => {
    const restored = { id: 'wf-1', draftRevision: 9 } as AutomationDetail;
    api.restoreVersion.mockResolvedValue(restored);
    const flush = jest.fn(async () => 8);
    const onRestored = jest.fn();
    render(
      <VersionPreviewBanner
        automationId="wf-1"
        version={detail}
        flush={flush}
        onRestored={onRestored}
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByText('Viewing version 1.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Restore As Draft' }));
    });
    expect(flush).toHaveBeenCalled();
    expect(api.restoreVersion).toHaveBeenCalledWith('wf-1', 1, 8);
    expect(onRestored).toHaveBeenCalledWith(restored);
    expect(toast).toHaveBeenCalledWith({ title: 'Version 1 copied into the draft.' });
  });

  it('closes the preview', () => {
    const onClose = jest.fn();
    render(
      <VersionPreviewBanner
        automationId="wf-1"
        version={detail}
        flush={jest.fn(async () => 1)}
        onRestored={jest.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
