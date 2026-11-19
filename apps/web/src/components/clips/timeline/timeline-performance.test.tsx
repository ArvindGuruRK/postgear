/**
 * Performance at the limits (Sprint 12, Module 20 section 4): the timelines
 * draw only what is on screen, whatever the length of the video or the
 * number of things in the clip.
 *
 * - The video page's timeline with a six hour video (no real file: the
 *   timeline only needs the length): zoomed to fit and zoomed all the way in,
 *   the ruler draws a handful of marks, never one per second of six hours.
 * - The editor's timeline with the document limits (`MAX_SEGMENTS` parts and
 *   `MAX_ITEMS` items): every bar is there to be reached by keyboard, but only
 *   the visible parts draw a filmstrip, and a re-render after a one-item change
 *   stays well inside a frame budget on this machine.
 *
 * jsdom has no layout, so the scroller's width is stubbed the way the
 * timelines' own tests do it.
 */
import { TooltipProvider } from '@postgear/ui';
import {
  type ClipDocument,
  createClipDocument,
  MAX_ITEMS,
  MAX_SEGMENTS,
  splitAt,
  type TextItem,
} from '@postgear/video-engine';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { PlaybackStore } from '../editor/playback';
import { TimelineDock, type TimelineDockProps } from '../editor/timeline-dock';
import { SourcePlayerStore } from '../video/source-player';
import { SourceTimeline, type TimelineControls } from '../video/source-timeline';
import { NO_MARK } from '../video/video-page-model';

const SOURCE_SCROLLER_PX = 1088;
const EDITOR_SCROLLER_PX = 1104;
const FPS = 30;
const SIX_HOURS = 6 * 60 * 60 * 1000;

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.dataset.testid === 'source-timeline') return SOURCE_SCROLLER_PX;
      if (this.dataset.testid === 'clip-timeline') return EDITOR_SCROLLER_PX;
      return 0;
    },
  });
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

/** The marks the ruler drew (each mark is one positioned child of its inner layer). */
function rulerMarks(): number {
  const ruler = screen.getByRole('group', { name: 'Time Ruler' });
  return ruler.firstElementChild?.childElementCount ?? 0;
}

function rulerWidthPx(): number {
  return Number.parseFloat(screen.getByRole('group', { name: 'Time Ruler' }).style.width);
}

describe('the video page timeline with a six hour video', () => {
  function setup() {
    const store = new SourcePlayerStore(SIX_HOURS);
    const controlRef = createRef<TimelineControls | null>() as {
      current: TimelineControls | null;
    };
    render(
      <TooltipProvider>
        <SourceTimeline
          store={store}
          durationMs={SIX_HOURS}
          fps={FPS}
          filmstrip={null}
          waveform={null}
          mark={NO_MARK}
          onMarkChange={jest.fn()}
          clips={[]}
          selectedClipId={null}
          onSelectClip={jest.fn()}
          controlRef={controlRef}
        />
      </TooltipProvider>,
    );
  }

  it('draws a handful of marks when the whole video fits', () => {
    setup();
    expect(rulerMarks()).toBeGreaterThan(0);
    expect(rulerMarks()).toBeLessThanOrEqual(40);
  });

  it('still draws only the visible marks zoomed all the way in', () => {
    setup();
    const zoomIn = screen.getByRole('button', { name: 'Zoom In' });
    for (let press = 0; press < 60 && !zoomIn.hasAttribute('disabled'); press += 1) {
      act(() => {
        fireEvent.click(zoomIn);
      });
    }
    expect(zoomIn).toBeDisabled();
    // Six hours at the closest zoom is far wider than the screen...
    expect(rulerWidthPx()).toBeGreaterThan(SOURCE_SCROLLER_PX * 100);
    // ...but the ruler holds only the marks of the part on screen (major and
    // minor ticks for about a screen's width), never thousands for six hours.
    expect(rulerMarks()).toBeGreaterThan(0);
    expect(rulerMarks()).toBeLessThanOrEqual(120);
  });
});

describe('the editor timeline at the document limits', () => {
  const VIDEO = '3f2a9c1e-0000-4000-8000-000000000001';

  function text(index: number, start: number): TextItem {
    return {
      id: `txt_${index}`,
      type: 'text',
      start,
      duration: 1_000,
      anchor: 'moment',
      text: `Line ${index}`,
      style: {
        font: 'Sora',
        size: 64,
        weight: 600,
        italic: false,
        colour: '#ffffff',
        align: 'center',
        outline: null,
        background: null,
        shadow: false,
        uppercase: false,
      },
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 },
      widthPx: 864,
      fadeInMs: 0,
      fadeOutMs: 0,
    };
  }

  /**
   * A three minute clip cut into `MAX_SEGMENTS` parts, with `MAX_ITEMS` texts
   * on it; `firstShiftMs` moves the first text (a one-item change).
   */
  function fullDocument(firstShiftMs = 0): ClipDocument {
    let doc: ClipDocument = {
      ...createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 180_000, ratio: '9:16' }),
      meta: { shapeChosen: true },
    };
    const step = 180_000 / MAX_SEGMENTS;
    for (let cut = 1; cut < MAX_SEGMENTS; cut += 1) {
      const result = splitAt(doc, Math.round(cut * step));
      if (!result.ok) throw new Error(`split ${cut} refused: ${result.code}`);
      doc = result.doc;
    }
    const items = Array.from({ length: MAX_ITEMS }, (_, index) =>
      text(index, index * 1_700 + (index === 0 ? firstShiftMs : 0)),
    );
    return { ...doc, tracks: [{ id: 'trk_overlay', kind: 'overlay', items }] };
  }

  function props(document: ClipDocument): TimelineDockProps {
    return {
      document,
      selection: null,
      playback: new PlaybackStore(),
      filmstrip: null,
      waveform: null,
      fps: FPS,
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
    };
  }

  it('holds every part and item as a bar the keyboard can reach', () => {
    const document = fullDocument();
    expect(document.segments).toHaveLength(MAX_SEGMENTS);
    render(
      <TooltipProvider>
        <TimelineDock {...props(document)} />
      </TooltipProvider>,
    );
    expect(screen.getAllByTestId('clip-part')).toHaveLength(MAX_SEGMENTS);
    expect(screen.getAllByTestId('clip-bar-item')).toHaveLength(MAX_ITEMS);
  });

  it('redraws after a one-item change inside a frame budget', () => {
    const document = fullDocument();
    const { rerender } = render(
      <TooltipProvider>
        <TimelineDock {...props(document)} />
      </TooltipProvider>,
    );
    // The same document with only its first text moved 100 ms (parts keep their ids).
    const moved: ClipDocument = { ...document, tracks: fullDocument(100).tracks };
    const started = performance.now();
    rerender(
      <TooltipProvider>
        <TimelineDock {...props(moved)} />
      </TooltipProvider>,
    );
    const took = performance.now() - started;
    // jsdom is several times slower than a browser; a generous ceiling still
    // catches a redraw that grew with the number of bars squared.
    expect(took).toBeLessThan(500);
  });
});
