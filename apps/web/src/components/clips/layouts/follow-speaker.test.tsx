/**
 * Follow The Speaker in the editor (Module 08): the switch (on as one undo
 * step with keyframes written, off giving the layout back with a toast,
 * undo), Show Both, the many-faces picker, the none-found line, the strip
 * and Fix By Hand, Clear Fix, the Video pane while following, a layout tile
 * while following, and following on first open. The face file and the API
 * are stand-ins: nothing leaves the test.
 */
import { SpeakerStrip, TooltipProvider } from '@postgear/ui';
import {
  areaCropAt,
  type ClipDocument,
  type FacePictureInput,
  isFollowing,
} from '@postgear/video-engine';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { PlaybackStore } from '@/components/clips/editor/playback';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import type { ClipJobView } from '@/types/clips';
import { CropStage } from './crop-stage';
import {
  CLIP,
  faceData,
  MANY_X,
  manyPeople,
  nobody,
  onePersonWithGap,
  READY,
  tallClip,
  twoPeople,
  VIDEO_SIZE,
} from './follow-fixtures';
import {
  FOLLOW_FINDING,
  FOLLOW_OFF_NOTE,
  FOLLOW_ON_SENTENCE,
  FOLLOWING_NOTE,
  followWith,
  MANY_FACES,
  NO_ONE_TO_FOLLOW,
  OWN_LAYOUT_BACK,
  pickAnchor,
  planFollow,
} from './follow-model';
import { type LayoutEdit, LayoutsPanel } from './layouts-panel';
import { type FollowSpeakerDeps, useFollowSpeaker } from './use-follow-speaker';

jest.mock('@/lib/clips-api', () => ({
  ensureClipFaces: jest.fn(),
  readClipFaces: jest.fn(),
  listLayouts: jest.fn(async () => []),
  saveLayout: jest.fn(),
  renameLayout: jest.fn(),
  deleteLayout: jest.fn(),
}));

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
  HTMLCanvasElement.prototype.getContext = (() => ({ drawImage: () => undefined })) as never;
});

function job(progress: number): ClipJobView {
  return { id: 'job-1', kind: 'FACES', status: 'RUNNING', progress } as ClipJobView;
}

function deps(file: FacePictureInput[] | null, overrides: Partial<FollowSpeakerDeps> = {}) {
  return {
    ensure: jest.fn().mockResolvedValue({ status: 'ready', reused: true }),
    read: jest.fn().mockResolvedValue(READY),
    loadFile: jest.fn().mockResolvedValue(file),
    wait: jest.fn().mockResolvedValue(undefined),
    notify: jest.fn(),
    ...overrides,
  } as unknown as FollowSpeakerDeps & Record<string, jest.Mock>;
}

interface Options {
  available?: boolean;
  followOnOpen?: boolean;
  /** Render inside React's StrictMode, which runs every effect twice as development does. */
  strict?: boolean;
}

/** The editor's store in small: one undo step per edit, and Undo. */
function renderEditor(fakes: FollowSpeakerDeps, initial = tallClip(), options: Options = {}) {
  const state = {
    doc: initial,
    history: [] as ClipDocument[],
    spoken: [] as string[],
    revealed: 0,
  };
  const playback = new PlaybackStore();
  let undo: () => void = () => undefined;

  function Host({ followOnOpen }: { followOnOpen: boolean }) {
    const [doc, setDoc] = useState(initial);
    state.doc = doc;
    const edit: LayoutEdit = (change, sentence) => {
      const next = change(state.doc);
      if (next === state.doc) return;
      state.history.push(state.doc);
      state.spoken.push(sentence);
      state.doc = next;
      setDoc(next);
    };
    undo = () => {
      const previous = state.history.pop();
      if (!previous) return;
      state.doc = previous;
      setDoc(previous);
    };
    const follow = useFollowSpeaker({
      clipId: CLIP,
      document: doc,
      videoSize: VIDEO_SIZE,
      available: options.available ?? true,
      onEdit: edit,
      followOnOpen,
      onReveal: () => {
        state.revealed += 1;
      },
      deps: fakes,
    });
    return (
      <>
        <h2 id="panel-heading">Layouts</h2>
        <LayoutsPanel
          clipId={CLIP}
          document={doc}
          videoSize={VIDEO_SIZE}
          labelledBy="panel-heading"
          facesAvailable={options.available ?? true}
          onEdit={edit}
          follow={follow}
        />
        <CropStage
          engine={null}
          playback={playback}
          document={doc}
          shown={doc}
          videoSize={VIDEO_SIZE}
          hasVideo
          selection={null}
          onSelect={() => undefined}
          onCommit={() => undefined}
          onDraft={() => undefined}
          onEdit={edit}
          onAnnounce={() => undefined}
          follow={{
            fixing: follow.fixing,
            onFixDone: follow.finishFix,
            onFixCancel: follow.cancelFix,
          }}
        />
        {follow.following ? (
          <SpeakerStrip
            data-testid="strip"
            onSelect={follow.select}
            stretches={follow.stretches.map((s) => ({
              key: s.key,
              kind: s.kind,
              person: s.person,
              leftPx: s.fromMs / 100,
              widthPx: (s.toMs - s.fromMs) / 100,
              label: s.label,
              selected: s.key === follow.selected?.key,
            }))}
          />
        ) : null}
      </>
    );
  }
  const tree = (
    <TooltipProvider>
      <Host followOnOpen={options.followOnOpen ?? false} />
    </TooltipProvider>
  );
  const view = render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
  const rerender = (followOnOpen: boolean) =>
    view.rerender(
      <TooltipProvider>
        <Host followOnOpen={followOnOpen} />
      </TooltipProvider>,
    );
  return { state, undo: () => act(() => undo()), rerender };
}

const theSwitch = () => screen.getByTestId('clip-follow-switch');

async function turnOn(state: { history: ClipDocument[] }, steps = 1) {
  fireEvent.click(theSwitch());
  await waitFor(() => expect(state.history).toHaveLength(steps));
}

describe('the Follow The Speaker switch', () => {
  it('turns on as one undo step, writing the keyframes into the frame', async () => {
    const fakes = deps(onePersonWithGap());
    const { state } = renderEditor(fakes);
    expect(theSwitch()).toHaveAttribute('aria-checked', 'false');
    await turnOn(state);
    expect(isFollowing(state.doc)).toBe(true);
    expect(state.doc.layout.areas[0]?.crop.length).toBeGreaterThan(1);
    expect(state.spoken).toEqual([FOLLOW_ON_SENTENCE]);
    expect(fakes.loadFile).toHaveBeenCalledWith(READY.url, expect.anything());
    expect(theSwitch()).toHaveAttribute('aria-checked', 'true');
  });

  it('shows "Finding faces" while a job looks, then follows', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fakes = deps(onePersonWithGap(), {
      ensure: jest.fn().mockResolvedValue({ status: 'running', job: job(10), joined: false }),
      read: jest
        .fn()
        .mockResolvedValueOnce({ status: 'running', job: job(40) })
        .mockResolvedValue(READY),
      wait: jest.fn(() => held),
    });
    const { state } = renderEditor(fakes);
    fireEvent.click(theSwitch());
    expect(await screen.findByRole('progressbar', { name: FOLLOW_FINDING })).toBeInTheDocument();
    release();
    await waitFor(() => expect(state.history).toHaveLength(1));
    expect(screen.queryByTestId('clip-follow-finding')).toBeNull();
  });

  it('turns off giving back the own layout exactly, with a toast, as one step', async () => {
    const fakes = deps(onePersonWithGap());
    const { state } = renderEditor(fakes);
    const before = state.doc;
    await turnOn(state);
    fireEvent.click(theSwitch());
    expect(state.history).toHaveLength(2);
    expect(state.doc.layout).toEqual(before.layout);
    expect(fakes.notify).toHaveBeenCalledWith(OWN_LAYOUT_BACK);
    expect(state.spoken.at(-1)).toBe(OWN_LAYOUT_BACK);
  });

  it('is undone in one step', async () => {
    const { state, undo } = renderEditor(deps(onePersonWithGap()));
    const before = state.doc;
    await turnOn(state);
    undo();
    expect(state.doc).toBe(before);
    expect(theSwitch()).toHaveAttribute('aria-checked', 'false');
  });

  it('says so and stays off when nobody is found', async () => {
    const { state } = renderEditor(deps(nobody()));
    fireEvent.click(theSwitch());
    expect(await screen.findByText(NO_ONE_TO_FOLLOW)).toBeInTheDocument();
    expect(state.history).toHaveLength(0);
    expect(theSwitch()).toHaveAttribute('aria-checked', 'false');
  });

  it('is off, with the reason, when finding faces is not available', () => {
    renderEditor(deps(onePersonWithGap()), tallClip(), { available: false });
    expect(theSwitch()).toBeDisabled();
    expect(screen.getByText(new RegExp(FOLLOW_OFF_NOTE))).toBeInTheDocument();
  });
});

describe('Show Both and the picker', () => {
  it('offers Show Both with two people and stacks them, one step each way', async () => {
    const { state } = renderEditor(deps(twoPeople()));
    await turnOn(state);
    const both = await screen.findByTestId('clip-follow-both');
    fireEvent.click(both);
    await waitFor(() => expect(state.history).toHaveLength(2));
    expect(state.doc.layout.follow?.mode).toBe('both');
    expect(state.doc.layout.areas).toHaveLength(2);
    fireEvent.click(screen.getByTestId('clip-follow-both'));
    await waitFor(() => expect(state.history).toHaveLength(3));
    expect(state.doc.layout.follow?.mode).toBe('speaker');
  });

  it('has no Show Both with one person', async () => {
    const { state } = renderEditor(deps(onePersonWithGap()));
    await turnOn(state);
    expect(screen.queryByTestId('clip-follow-both')).toBeNull();
  });

  it('asks whom to follow with many faces, then follows the one picked', async () => {
    const { state } = renderEditor(deps(manyPeople()));
    fireEvent.click(theSwitch());
    expect(await screen.findByText(MANY_FACES)).toBeInTheDocument();
    expect(state.history).toHaveLength(0);
    const people = screen.getAllByTestId('clip-follow-person');
    expect(people).toHaveLength(5);
    // No picture at the playhead: numbered tiles.
    expect(people[2]).toHaveTextContent('3');
    fireEvent.click(people[2] as HTMLElement);
    await waitFor(() => expect(state.history).toHaveLength(1));
    expect(isFollowing(state.doc)).toBe(true);
    expect(screen.queryByText(MANY_FACES)).toBeNull();
  });
});

describe('the strip and Fix By Hand', () => {
  it('shows the lost stretch, and Fix By Hand writes an override as one step', async () => {
    const { state } = renderEditor(deps(onePersonWithGap()));
    await turnOn(state);
    const strip = await screen.findByTestId('strip');
    expect(within(strip).getAllByRole('img').length).toBeGreaterThan(0);
    const lost = within(strip).getByRole('button', { name: /lost the speaker/ });
    expect(lost).toHaveClass('bg-stripes');
    fireEvent.click(lost);
    expect(state.revealed).toBe(1);
    expect(screen.getByTestId('clip-follow-lost')).toHaveTextContent(
      /We lost the speaker for \d seconds here\./,
    );
    fireEvent.click(screen.getByTestId('clip-follow-fix'));
    const box = await screen.findByTestId('clip-follow-fix-box');
    fireEvent.keyDown(box, { key: 'ArrowLeft', shiftKey: true });
    fireEvent.click(screen.getByTestId('clip-follow-fix-done'));
    await waitFor(() => expect(state.history).toHaveLength(2));
    expect(state.doc.layout.follow?.overrides).toHaveLength(1);
    expect(screen.queryByTestId('clip-follow-fix-box')).toBeNull();
    // The stretch now shows as fixed, and Clear Fix takes it away.
    const fixed = within(screen.getByTestId('strip')).getByRole('button', { name: /by hand/ });
    fireEvent.click(fixed);
    fireEvent.click(screen.getByTestId('clip-follow-clear-fix'));
    await waitFor(() => expect(state.history).toHaveLength(3));
    expect(state.doc.layout.follow?.overrides).toEqual([]);
  });

  it('has no Fix By Hand in Show Both', async () => {
    const { state } = renderEditor(
      deps(twoPeople().map((p) => (p.t >= 20_000 && p.t < 24_000 ? { ...p, boxes: [] } : p))),
    );
    await turnOn(state);
    fireEvent.click(await screen.findByTestId('clip-follow-both'));
    await waitFor(() => expect(state.doc.layout.follow?.mode).toBe('both'));
    const lost = within(screen.getByTestId('strip')).getAllByRole('button')[0];
    fireEvent.click(lost as HTMLElement);
    expect(screen.queryByTestId('clip-follow-fix')).toBeNull();
  });
});

describe('the Video pane and the layouts while following', () => {
  it('shows moving outlines instead of boxes to drag, and says why', async () => {
    const { state } = renderEditor(deps(onePersonWithGap()));
    expect(screen.getAllByTestId('clip-crop-box').length).toBeGreaterThan(0);
    await turnOn(state);
    expect(screen.queryByTestId('clip-crop-box')).toBeNull();
    expect(screen.getAllByTestId('clip-follow-frame').length).toBeGreaterThan(0);
    expect(screen.getByTestId('clip-follow-note')).toHaveTextContent(FOLLOWING_NOTE);
  });

  it('turns following off first when a layout tile is chosen, in the same step', async () => {
    const { state } = renderEditor(deps(onePersonWithGap()));
    await turnOn(state);
    const tiles = within(screen.getByRole('group', { name: 'Layouts' })).getAllByRole('button');
    const split = tiles.find((t) => t.textContent === 'Split');
    fireEvent.click(split as HTMLElement);
    expect(state.history).toHaveLength(2);
    expect(isFollowing(state.doc)).toBe(false);
    expect(state.doc.layout.kind).toBe('split');
    expect(state.doc.layout.areas.every((a) => a.crop.length === 1)).toBe(true);
  });
});

describe('the many-faces pick, kept in the document', () => {
  /** The crop's centre the followed area shows at `ms` of the video. */
  const centreAt = (doc: ClipDocument, ms: number) => {
    const area = doc.layout.areas[0];
    if (!area) throw new Error('area');
    const rect = areaCropAt(area, ms);
    return rect.x + rect.w / 2;
  };
  /** The picker's tile for the face at `x`. */
  async function pickFace(x: number) {
    fireEvent.click(theSwitch());
    await screen.findByText(MANY_FACES);
    const tiles = screen.getAllByTestId('clip-follow-person');
    fireEvent.click(tiles[MANY_X.indexOf(x)] as HTMLElement);
  }

  it('keeps the pick when the clip is opened again (the strip shows)', async () => {
    const data = faceData(manyPeople(2));
    const doc = tallClip();
    const plan = planFollow(doc, data, VIDEO_SIZE, { mode: 'speaker' });
    if (plan.kind !== 'many') throw new Error('many');
    const middle = plan.people.find((p) => Math.abs((p.boxes[0]?.rect.x ?? 0) - 0.45) < 0.01);
    const anchor = middle ? pickAnchor(doc, data, middle) : null;
    const opened = followWith(doc, data, VIDEO_SIZE, { mode: 'speaker', pick: anchor }).doc;
    expect(opened.layout.follow?.personId).toBe(anchor);
    const fakes = deps(manyPeople(2));
    renderEditor(fakes, opened);
    const strip = await screen.findByTestId('strip');
    await waitFor(() => expect(within(strip).getAllByRole('img').length).toBeGreaterThan(0));
    expect(within(strip).getByRole('button', { name: /lost the speaker/ })).toBeInTheDocument();
    // A quiet read: no new faces asked for.
    expect(fakes.ensure).not.toHaveBeenCalled();
  });

  it('reads the faces for the strip on open even when the first read is cancelled', async () => {
    // StrictMode runs the quiet read's effect twice, cancelling the first read; the
    // second must still happen (found live: the strip and Show Both never showed).
    const data = faceData(twoPeople());
    const opened = followWith(tallClip(), data, VIDEO_SIZE, { mode: 'speaker' }).doc;
    expect(opened.layout.follow).toBeDefined();
    const fakes = deps(twoPeople());
    renderEditor(fakes, opened, { strict: true });
    expect(await screen.findByTestId('strip')).toBeInTheDocument();
    expect(await screen.findByTestId('clip-follow-both')).toBeInTheDocument();
    expect(fakes.ensure).not.toHaveBeenCalled();
  });

  it('follows A again after picking B and undoing, and Fix By Hand keeps A', async () => {
    const { state, undo } = renderEditor(deps(manyPeople(2)));
    // The face at 0.45 is A (missing from 20 s to 24 s), the one at 0.85 is B.
    await pickFace(0.45);
    await waitFor(() => expect(state.history).toHaveLength(1));
    const followingA = state.doc;
    expect(centreAt(followingA, 30_000)).toBeCloseTo(0.49, 1);
    fireEvent.click(theSwitch());
    expect(state.history).toHaveLength(2);
    await pickFace(0.85);
    await waitFor(() => expect(state.history).toHaveLength(3));
    expect(centreAt(state.doc, 30_000)).toBeCloseTo(0.89, 1);
    undo();
    undo();
    expect(state.doc).toBe(followingA);

    const lost = within(await screen.findByTestId('strip')).getByRole('button', {
      name: /lost the speaker/,
    });
    fireEvent.click(lost);
    fireEvent.click(screen.getByTestId('clip-follow-fix'));
    fireEvent.click(await screen.findByTestId('clip-follow-fix-done'));
    await waitFor(() => expect(state.doc.layout.follow?.overrides).toHaveLength(1));
    expect(state.doc.layout.follow?.personId).toBe(followingA.layout.follow?.personId);
    expect(centreAt(state.doc, 30_000)).toBeCloseTo(0.49, 1);
  });
});

describe('following on first open', () => {
  it('runs once, as the first undo step', async () => {
    const fakes = deps(onePersonWithGap());
    const { state, rerender } = renderEditor(fakes, tallClip(), { followOnOpen: true });
    await waitFor(() => expect(state.history).toHaveLength(1));
    expect(isFollowing(state.doc)).toBe(true);
    rerender(false);
    rerender(true);
    await act(async () => undefined);
    expect(fakes.ensure).toHaveBeenCalledTimes(1);
    expect(state.history).toHaveLength(1);
  });

  it('is silent when nobody is found', async () => {
    const fakes = deps(nobody());
    const { state } = renderEditor(fakes, tallClip(), { followOnOpen: true });
    await waitFor(() => expect(fakes.loadFile).toHaveBeenCalled());
    await act(async () => undefined);
    expect(state.history).toHaveLength(0);
    expect(screen.queryByText(NO_ONE_TO_FOLLOW)).toBeNull();
  });

  it('steps aside when the person changes the layout while the faces load (Module 10)', async () => {
    let deliver: (file: FacePictureInput[]) => void = () => undefined;
    const fakes = deps(null, {
      loadFile: jest.fn(
        () =>
          new Promise<FacePictureInput[]>((resolve) => {
            deliver = resolve;
          }),
      ),
    });
    const { state } = renderEditor(fakes, tallClip(), { followOnOpen: true });
    await waitFor(() => expect(fakes.loadFile).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Blurred/ }));
    await waitFor(() => expect(state.history).toHaveLength(1));
    const chosen = state.doc;
    await act(async () => deliver(onePersonWithGap()));
    expect(state.history).toHaveLength(1);
    expect(state.doc).toBe(chosen);
    expect(isFollowing(state.doc)).toBe(false);
  });

  it('waits until finding faces is available', async () => {
    const fakes = deps(onePersonWithGap());
    renderEditor(fakes, tallClip(), { followOnOpen: true, available: false });
    await act(async () => undefined);
    expect(fakes.ensure).not.toHaveBeenCalled();
  });
});
