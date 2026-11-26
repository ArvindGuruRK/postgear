/**
 * Detect Camera (Sprint 13, Module 07): shown only with a Camera area, the
 * "Finding faces" state while a job looks, the Camera box moved onto the face
 * camera as one undo step, and the warning (nothing changed) when there is
 * none. The face file and the API are stand-ins: nothing leaves the test.
 */
import {
  applyLayout,
  type ClipDocument,
  createClipDocument,
  type FacePictureInput,
} from '@postgear/video-engine';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import type { ClipJobView } from '@/types/clips';
import { DetectCamera, type DetectCameraDeps } from './detect-camera';
import {
  cameraAreaOf,
  FINDING_FACES,
  faceCameraCrop,
  NO_FACE_CAMERA,
  picturesInClip,
} from './detect-camera-model';
import type { LayoutEdit } from './layouts-panel';

jest.mock('@/lib/clips-api', () => ({ ensureClipFaces: jest.fn(), readClipFaces: jest.fn() }));

beforeAll(() => {
  stubBrowserLayout();
});

const VIDEO = '3f2a9c1e-0000-4000-8000-000000000001';
const CLIP = '55555555-5555-4555-8555-555555555555';
const VIDEO_SIZE = { width: 1280, height: 720 };

function splitClip(): ClipDocument {
  const doc = createClipDocument({ videoId: VIDEO, fromMs: 10_000, toMs: 40_000, ratio: '9:16' });
  return applyLayout(doc, 'split', VIDEO_SIZE);
}

/** Five pictures a second over the clip, each with `boxes`. */
function frames(boxes: FacePictureInput['boxes'], fromMs = 5_000, toMs = 45_000) {
  const out: FacePictureInput[] = [];
  for (let t = fromMs; t < toMs; t += 200) out.push({ t, boxes });
  return out;
}

const CORNER = [{ x: 0.875, y: 0.782, w: 0.06, h: 0.106, score: 0.9 }];
const TALKING_HEAD = [{ x: 0.39, y: 0.2, w: 0.22, h: 0.4, score: 0.95 }];
const READY = {
  status: 'ready' as const,
  url: 'http://localhost:3001/clips/files/x?sig=1',
  meta: { fromMs: 5_000, toMs: 45_000, sampleFps: 5, found: 1, producer: 'simulation' },
};

function job(progress: number): ClipJobView {
  return { id: 'job-1', kind: 'FACES', status: 'RUNNING', progress } as ClipJobView;
}

function deps(file: FacePictureInput[] | null, overrides: Partial<DetectCameraDeps> = {}) {
  return {
    ensure: jest.fn().mockResolvedValue({ status: 'ready', reused: true }),
    read: jest.fn().mockResolvedValue(READY),
    loadFile: jest.fn().mockResolvedValue(file),
    wait: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DetectCameraDeps & Record<string, jest.Mock>;
}

function renderButton(initial: ClipDocument, fakes: DetectCameraDeps, available = true) {
  const state = { doc: initial, steps: 0, spoken: [] as string[], select: [] as unknown[] };
  function Host() {
    const [doc, setDoc] = useState(initial);
    state.doc = doc;
    const edit: LayoutEdit = (change, sentence, options) => {
      const next = change(state.doc);
      if (next === state.doc) return;
      state.steps += 1;
      state.spoken.push(sentence);
      state.select.push(options?.selectArea);
      state.doc = next;
      setDoc(next);
    };
    return (
      <DetectCamera
        clipId={CLIP}
        document={doc}
        videoSize={VIDEO_SIZE}
        available={available}
        onEdit={edit}
        deps={fakes}
      />
    );
  }
  render(<Host />);
  return state;
}

describe('the Detect Camera sums', () => {
  it('finds the Camera area of Split, and none in Fullscreen', () => {
    expect(cameraAreaOf(splitClip())?.name).toBe('Camera');
    const full = createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 30_000, ratio: '9:16' });
    expect(cameraAreaOf(full)).toBeNull();
  });

  it('counts only the pictures the clip plays', () => {
    const doc = splitClip();
    const inside = picturesInClip(doc, frames(CORNER));
    expect(inside[0]?.t).toBe(10_000);
    expect(inside.at(-1)?.t).toBe(39_800);
  });

  it('puts the Camera box on a corner face, and finds nothing on a talking head', () => {
    const doc = splitClip();
    const area = cameraAreaOf(doc);
    if (!area) throw new Error('Split has a Camera area');
    const crop = faceCameraCrop(doc, area, frames(CORNER), VIDEO_SIZE);
    expect(crop).not.toBeNull();
    expect((crop?.x ?? 0) + (crop?.w ?? 0)).toBeCloseTo(1);
    expect(faceCameraCrop(doc, area, frames(TALKING_HEAD), VIDEO_SIZE)).toBeNull();
  });
});

describe('<DetectCamera />', () => {
  it('is not shown without a Camera area', () => {
    const full = createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 30_000, ratio: '9:16' });
    renderButton(full, deps(frames(CORNER)));
    expect(screen.queryByTestId('clip-detect-camera')).toBeNull();
  });

  it('is disabled while finding faces is off', () => {
    renderButton(splitClip(), deps(frames(CORNER)), false);
    expect(screen.getByTestId('clip-detect-camera-button')).toBeDisabled();
  });

  it('moves the Camera box onto the face camera as one undo step and selects it', async () => {
    const fakes = deps(frames(CORNER));
    const state = renderButton(splitClip(), fakes);
    const before = cameraAreaOf(state.doc)?.crop;
    fireEvent.click(screen.getByTestId('clip-detect-camera-button'));
    await waitFor(() => expect(state.steps).toBe(1));
    expect(cameraAreaOf(state.doc)?.crop).not.toEqual(before);
    expect(state.select).toEqual(['camera']);
    expect(fakes.loadFile).toHaveBeenCalledWith(READY.url, expect.anything());
    expect(screen.queryByTestId('clip-detect-camera-warning')).toBeNull();
  });

  it('shows "Finding faces" while a job looks, then applies the result', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fakes = deps(frames(CORNER), {
      ensure: jest.fn().mockResolvedValue({ status: 'running', job: job(10), joined: false }),
      read: jest
        .fn()
        .mockResolvedValueOnce({ status: 'running', job: job(40) })
        .mockResolvedValue(READY),
      wait: jest.fn(() => held),
    });
    const state = renderButton(splitClip(), fakes);
    fireEvent.click(screen.getByTestId('clip-detect-camera-button'));
    expect(await screen.findByText(FINDING_FACES)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: FINDING_FACES })).toBeInTheDocument();
    release();
    await waitFor(() => expect(state.steps).toBe(1));
    expect(screen.queryByText(FINDING_FACES)).toBeNull();
  });

  it('warns and changes nothing when there is no face camera', async () => {
    const state = renderButton(splitClip(), deps(frames(TALKING_HEAD)));
    const before = state.doc;
    fireEvent.click(screen.getByTestId('clip-detect-camera-button'));
    expect(await screen.findByText(NO_FACE_CAMERA)).toBeInTheDocument();
    expect(state.steps).toBe(0);
    expect(state.doc).toBe(before);
  });

  it('warns when the face file cannot be read', async () => {
    const state = renderButton(splitClip(), deps(null));
    fireEvent.click(screen.getByTestId('clip-detect-camera-button'));
    expect(await screen.findByTestId('clip-detect-camera-warning')).toBeInTheDocument();
    expect(state.steps).toBe(0);
  });
});
