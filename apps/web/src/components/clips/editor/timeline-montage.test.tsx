import { TooltipProvider } from '@postgear/ui';
import { type ClipDocument, createClipDocument, createMontage } from '@postgear/video-engine';
import { render, screen } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { PlaybackStore } from './playback';
import { TimelineDock, type TimelineDockProps } from './timeline-dock';

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.testid === 'clip-timeline' ? 1104 : 0;
    },
  });
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

const VIDEO_A = '3f2a9c1e-0000-4000-8000-00000000000a';
const VIDEO_B = '3f2a9c1e-0000-4000-8000-00000000000b';

function montage(transition: 'cut' | 'fade'): ClipDocument {
  const result = createMontage(
    [
      {
        id: 'clip-a',
        title: 'Team Talk',
        document: createClipDocument({ videoId: VIDEO_A, fromMs: 0, toMs: 10_000, ratio: '9:16' }),
      },
      {
        id: 'clip-b',
        title: 'Big Play',
        document: createClipDocument({
          videoId: VIDEO_B,
          fromMs: 5_000,
          toMs: 15_000,
          ratio: '9:16',
        }),
      },
    ],
    { transition },
  );
  if (!result.ok) throw new Error(result.code);
  return result.document;
}

function setup(document: ClipDocument, overrides: Partial<TimelineDockProps> = {}) {
  const props: TimelineDockProps = {
    document,
    selection: null,
    playback: new PlaybackStore(),
    filmstrip: null,
    waveform: null,
    fps: 30,
    held: null,
    videoDurationMs: 600_000,
    gettingMore: false,
    notice: null,
    splitProblemAt: () => null,
    removeProblem: null,
    controlRef: { current: null },
    onSelect: jest.fn(),
    onOpen: jest.fn(),
    onCommit: jest.fn(),
    onDraft: jest.fn(),
    onSplit: jest.fn(),
    onRemove: jest.fn(),
    onAnnounce: jest.fn(),
    ...overrides,
  };
  return render(
    <TooltipProvider>
      <TimelineDock {...props} />
    </TooltipProvider>,
  );
}

describe('a montage on the timeline', () => {
  it('names each original clip at its first part, with a divider between them', () => {
    setup(montage('cut'));
    const names = screen.getAllByTestId('clip-montage-part-name').map((chip) => chip.textContent);
    expect(names).toEqual(['Team Talk', 'Big Play']);
    // No divider before the first clip.
    expect(screen.getAllByTestId('clip-montage-divider')).toHaveLength(1);
    expect(screen.queryByTestId('clip-join-fade')).toBeNull();
    const parts = screen.getAllByTestId('clip-part');
    expect(parts[1]?.getAttribute('aria-label')).toMatch(/^Big Play, /);
  });

  it('marks a Fade join where the two parts overlap', () => {
    setup(montage('fade'));
    expect(screen.getAllByTestId('clip-join-fade')).toHaveLength(1);
  });

  it('draws no dividers on a clip that is not a montage', () => {
    setup(createClipDocument({ videoId: VIDEO_A, fromMs: 0, toMs: 10_000, ratio: '9:16' }));
    expect(screen.queryByTestId('clip-montage-divider')).toBeNull();
    expect(screen.queryByTestId('clip-montage-part-name')).toBeNull();
  });
});
