import { TooltipProvider } from '@postgear/ui';
import {
  type ClipDocument,
  createClipDocument,
  lookSvgValues,
  setSpeed,
  setZoomTiming,
  updateZoom,
} from '@postgear/video-engine';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import type { EditorSelection } from '../editor/editor-state';
import { PlaybackStore } from '../editor/playback';
import { SPEED_PICK_NOTE, SPEED_ROUGH_NOTE } from './effects-model';
import { EffectsPanel } from './effects-panel';

const VIDEO = '3f2a9c1e-0000-4000-8000-000000000003';

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

/** 10 s to 40 s of the video, one part, with a zoom at 14 to 16 s of it. */
function clip(): ClipDocument {
  const doc = createClipDocument({ videoId: VIDEO, fromMs: 10_000, toMs: 40_000, ratio: '9:16' });
  return {
    ...doc,
    // A fixed id, so a selection made before the harness made its own document still names it.
    segments: doc.segments.map((segment) => ({ ...segment, id: 'seg_a' })),
    zooms: [
      {
        id: 'z1',
        source: doc.segments[0]?.source ?? '',
        from: 14_000,
        to: 16_000,
        scale: 1.5,
        focus: { x: 0.5, y: 0.5 },
        ease: 300,
      },
    ],
  };
}

interface Spy {
  added: number;
  zoom: Array<[string, object, string | undefined]>;
  timing: Array<[string, number, number, string]>;
  removed: string[];
  speed: Array<[string, number]>;
  looks: Array<[object, string | undefined]>;
  fades: object[];
}

/** The panel over a document, applying each change as the editor does. */
function Harness({ selection, spy }: { selection: EditorSelection; spy: Spy }) {
  const [doc, setDoc] = useState(clip);
  const [playback] = useState(() => new PlaybackStore());
  return (
    <TooltipProvider>
      <EffectsPanel
        document={doc}
        selection={selection}
        fps={30}
        playback={playback}
        onBlur={(make) =>
          setDoc((current) => {
            const result = make(current);
            return result.ok ? result.doc : current;
          })
        }
        filmstrip={null}
        onAddZoom={() => {
          spy.added += 1;
        }}
        onZoom={(id, change, key) => {
          spy.zoom.push([id, change, key]);
          setDoc((current) => {
            const result = updateZoom(current, id, change);
            return result.ok ? result.doc : current;
          });
        }}
        onZoomTiming={(id, start, duration, keep) => {
          spy.timing.push([id, start, duration, keep]);
          setDoc((current) => {
            const result = setZoomTiming(current, id, start, duration, keep);
            return result.ok ? result.doc : current;
          });
        }}
        onRemoveZoom={(id) => spy.removed.push(id)}
        onSpeed={(id, speed) => {
          spy.speed.push([id, speed]);
          setDoc((current) => {
            const result = setSpeed(current, id, speed);
            return result.ok ? result.doc : current;
          });
        }}
        onLooks={(change, key) => {
          spy.looks.push([change, key]);
          setDoc((current) => ({ ...current, looks: { ...current.looks, ...change } }));
        }}
        onFades={(change) => {
          spy.fades.push(change);
          setDoc((current) => ({ ...current, fades: { ...current.fades, ...change } }));
        }}
      />
      <output data-testid="doc">{JSON.stringify(doc)}</output>
    </TooltipProvider>
  );
}

function setup(selection: EditorSelection = null) {
  const spy: Spy = {
    added: 0,
    zoom: [],
    timing: [],
    removed: [],
    speed: [],
    looks: [],
    fades: [],
  };
  const view = render(<Harness selection={selection} spy={spy} />);
  const doc = (): ClipDocument => JSON.parse(screen.getByTestId('doc').textContent ?? '{}');
  const card = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });
  return { spy, view, doc, card };
}

describe('EffectsPanel cards', () => {
  it('shows the closed cards, each with its name and line', () => {
    const { card } = setup();
    for (const [name, line] of [
      ['Zoom', 'Zoom in on a moment'],
      ['Speed Control', 'Slow down or speed up a part'],
      ['Looks', 'Give the whole clip a look'],
      ['Blur A Region', 'Hide a face or a screen'],
    ]) {
      const trigger = card(name as string);
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(trigger).toHaveTextContent(line as string);
    }
    // No Sprint 13 placeholders.
    expect(screen.queryByText(/censor|silence|hook/i)).toBeNull();
  });

  it('opens the card a timeline selection belongs to', () => {
    const { card, view } = setup({ kind: 'zoom', id: 'z1' });
    expect(card('Zoom')).toHaveAttribute('aria-expanded', 'true');
    const doc = clip();
    view.rerender(
      <Harness
        selection={{ kind: 'segment', id: doc.segments[0]?.id ?? '' }}
        spy={{
          added: 0,
          zoom: [],
          timing: [],
          removed: [],
          speed: [],
          looks: [],
          fades: [],
        }}
      />,
    );
    expect(card('Speed Control')).toHaveAttribute('aria-expanded', 'true');
    expect(card('Zoom')).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('the Blur A Region card (Module 17 item 18)', () => {
  it('adds a box in the middle, and removes it', () => {
    const { card, doc } = setup();
    fireEvent.click(card('Blur A Region'));
    fireEvent.click(screen.getByTestId('clip-blur-add'));
    expect(doc().blurs).toEqual([
      expect.objectContaining({ source: doc().sources[0]?.id, x: 0.4, y: 0.4, w: 0.2, h: 0.2 }),
    ]);
    expect(screen.getAllByTestId('clip-blur-box')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('clip-blur-remove'));
    expect(doc().blurs).toBeUndefined();
  });
});

describe('the Zoom card', () => {
  it('adds a zoom, and says to pick one when there are zooms but none is selected', () => {
    const { spy, card } = setup();
    fireEvent.click(card('Zoom'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Zoom' }));
    expect(spy.added).toBe(1);
    expect(screen.getByText('Select a zoom on the timeline to change it.')).toBeInTheDocument();
  });

  it('changes the selected zoom: amount, ease, timing and remove', () => {
    const { spy, doc } = setup({ kind: 'zoom', id: 'z1' });
    const zone = screen.getByTestId('clip-selected-zoom');
    expect(within(zone).getByText('1.5x')).toBeInTheDocument();

    const amount = screen.getByRole('slider', { name: 'Amount' });
    expect(amount).toHaveAttribute('aria-valuetext', '1.5x');
    act(() => amount.focus());
    fireEvent.keyDown(amount, { key: 'ArrowRight' });
    expect(doc().zooms[0]?.scale).toBe(1.6);
    expect(spy.zoom.at(-1)?.[2]).toBe('zoom-amount:z1');

    fireEvent.click(screen.getByRole('button', { name: 'Snap' }));
    expect(doc().zooms[0]?.ease).toBe(0);
    expect(screen.getByRole('button', { name: 'Snap' })).toHaveAttribute('aria-pressed', 'true');

    const forField = screen.getByRole('spinbutton', { name: 'For' });
    fireEvent.change(forField, { target: { value: '3' } });
    fireEvent.keyDown(forField, { key: 'Enter' });
    expect(spy.timing.at(-1)).toEqual(['z1', 4_000, 3_000, 'from']);
    expect(doc().zooms[0]).toMatchObject({ from: 14_000, to: 17_000 });

    fireEvent.click(screen.getByRole('button', { name: 'Remove Zoom' }));
    expect(spy.removed).toEqual(['z1']);
  });
});

describe('the Speed Control card', () => {
  it('asks for a part first', () => {
    const { card } = setup();
    fireEvent.click(card('Speed Control'));
    expect(screen.getByTestId('clip-speed-none')).toHaveTextContent(SPEED_PICK_NOTE);
  });

  it('sets the selected part speed and says its new length', () => {
    const segmentId = clip().segments[0]?.id ?? '';
    const { spy } = setup({ kind: 'segment', id: segmentId });
    expect(screen.getByTestId('clip-speed-length')).toHaveTextContent('This part is 30.0 s long.');
    expect(screen.queryByText(SPEED_ROUGH_NOTE)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '2x' }));
    expect(spy.speed).toEqual([[segmentId, 2]]);
    expect(screen.getByTestId('clip-speed-length')).toHaveTextContent('30.0 s becomes 15.0 s');

    fireEvent.click(screen.getByRole('button', { name: '0.5x' }));
    expect(screen.getByTestId('clip-speed-length')).toHaveTextContent('30.0 s becomes 60.0 s');
    expect(screen.getByText(SPEED_ROUGH_NOTE)).toBeInTheDocument();
  });
});

describe('the Looks card', () => {
  it('picks a look on its tile, each tile drawn with the matrix the export uses', () => {
    const { spy, doc, card, view } = setup();
    fireEvent.click(card('Looks'));
    expect(screen.getByTestId('clip-look-name')).toHaveTextContent('None');
    // None has no strength to set.
    expect(screen.queryByRole('slider', { name: 'Strength' })).toBeNull();

    const warm = screen.getByRole('button', { name: 'Warm' });
    const sample = warm.querySelector('[style*="filter"]') as HTMLElement;
    const id = /url\(#(.+)\)/.exec(sample.style.filter)?.[1] ?? '';
    const filter = view.container.querySelector(`filter[id="${id}"] feColorMatrix`);
    expect(filter?.getAttribute('values')).toBe(lookSvgValues({ colour: 'warm', strength: 1 }));

    fireEvent.click(warm);
    expect(spy.looks.at(-1)).toEqual([{ colour: 'warm' }, undefined]);
    expect(doc().looks.colour).toBe('warm');
    expect(screen.getByTestId('clip-look-name')).toHaveTextContent('Warm');
    expect(warm).toHaveAttribute('aria-pressed', 'true');

    const strength = screen.getByRole('slider', { name: 'Strength' });
    act(() => strength.focus());
    fireEvent.keyDown(strength, { key: 'ArrowLeft' });
    expect(doc().looks.strength).toBe(0.95);
    expect(spy.looks.at(-1)?.[1]).toBe('look-strength');

    const vignette = screen.getByRole('slider', { name: 'Vignette' });
    act(() => vignette.focus());
    fireEvent.keyDown(vignette, { key: 'ArrowRight' });
    expect(doc().looks.vignette).toBe(0.05);
    expect(spy.looks.at(-1)?.[1]).toBe('look-vignette');
  });

  it('brings the strength back when a look is picked at 0%', () => {
    const { spy, card } = setup();
    fireEvent.click(card('Looks'));
    fireEvent.click(screen.getByRole('button', { name: 'Sepia' }));
    const strength = screen.getByRole('slider', { name: 'Strength' });
    act(() => strength.focus());
    fireEvent.keyDown(strength, { key: 'Home' });
    fireEvent.click(screen.getByRole('button', { name: 'Cinematic' }));
    expect(spy.looks.at(-1)).toEqual([{ colour: 'cinematic', strength: 1 }, undefined]);
  });

  it('turns the fades on at 1 second and changes their length', () => {
    const { spy, doc, card } = setup();
    fireEvent.click(card('Looks'));
    expect(screen.queryByRole('button', { name: '2 s' })).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Fade In' }));
    expect(spy.fades.at(-1)).toEqual({ inMs: 1_000 });
    fireEvent.click(screen.getByRole('button', { name: '2 s' }));
    expect(doc().fades).toEqual({ inMs: 2_000, outMs: 0 });

    fireEvent.click(screen.getByRole('switch', { name: 'Fade Out' }));
    expect(doc().fades).toEqual({ inMs: 2_000, outMs: 1_000 });
    fireEvent.click(screen.getByRole('switch', { name: 'Fade In' }));
    expect(doc().fades).toEqual({ inMs: 0, outMs: 1_000 });
  });
});
