import {
  type ClipDocument,
  createClipDocument,
  type FacePictureInput,
  applyLayout,
} from '@postgear/video-engine';
import { act, renderHook } from '@testing-library/react';
import type { LayoutEdit } from '../layouts/layouts-panel';
import { type CameraOnOpenDeps, useCameraOnOpen } from './use-camera-on-open';

const VIDEO = { width: 1920, height: 1080 };

function splitDoc(): ClipDocument {
  const doc = createClipDocument({
    videoId: '3f2a9c1e-0000-4000-8000-000000000001',
    fromMs: 10_000,
    toMs: 40_000,
    ratio: '9:16',
  });
  return applyLayout(doc, 'split', VIDEO);
}

function fakeDeps(): jest.Mocked<CameraOnOpenDeps> {
  return {
    ensure: jest.fn(async (_clipId: string) => ({ status: 'ready' }) as never),
    read: jest.fn(
      async (_clipId: string, _options?: unknown) =>
        ({ status: 'ready', url: 'https://space.test/faces.gz' }) as never,
    ),
    loadFile: jest.fn(async (_url: string, _signal: AbortSignal) => [] as FacePictureInput[]),
    wait: jest.fn(async (_ms: number) => undefined),
  } as jest.Mocked<CameraOnOpenDeps>;
}

function run(options: { doc?: ClipDocument; enabled?: boolean; available?: boolean }) {
  const deps = fakeDeps();
  const onEdit = jest.fn() as jest.MockedFunction<LayoutEdit>;
  const hook = renderHook(
    (props: { enabled: boolean; doc: ClipDocument }) =>
      useCameraOnOpen({
        clipId: 'clip-1',
        document: props.doc,
        videoSize: VIDEO,
        enabled: props.enabled,
        available: options.available ?? true,
        onEdit,
        deps,
      }),
    { initialProps: { enabled: options.enabled ?? true, doc: options.doc ?? splitDoc() } },
  );
  return { hook, deps, onEdit };
}

describe('Detect Camera on first open', () => {
  it('runs once, quietly, as one edit', async () => {
    const { hook, deps, onEdit } = run({});
    await act(async () => undefined);
    expect(deps.ensure).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
    // The change gives the document back unchanged when no face camera is found.
    const [change] = onEdit.mock.calls[0] ?? [];
    const doc = splitDoc();
    expect(change?.(doc)).toBe(doc);

    hook.rerender({ enabled: true, doc: splitDoc() });
    await act(async () => undefined);
    expect(deps.ensure).toHaveBeenCalledTimes(1);
  });

  it('waits for the faces job while it looks', async () => {
    const { deps, onEdit } = (() => {
      const made = run({ enabled: false });
      made.deps.read
        .mockResolvedValueOnce({ status: 'running', job: { progress: 10 } } as never)
        .mockResolvedValue({ status: 'ready', url: 'https://space.test/faces.gz' } as never);
      made.hook.rerender({ enabled: true, doc: splitDoc() });
      return made;
    })();
    await act(async () => undefined);
    expect(deps.wait).toHaveBeenCalled();
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('does nothing when not asked, when faces are off, or without a Camera area', async () => {
    const notAsked = run({ enabled: false });
    const off = run({ available: false });
    const noCamera = run({
      doc: createClipDocument({
        videoId: '3f2a9c1e-0000-4000-8000-000000000001',
        fromMs: 10_000,
        toMs: 40_000,
        ratio: '9:16',
      }),
    });
    await act(async () => undefined);
    for (const made of [notAsked, off, noCamera]) {
      expect(made.deps.ensure).not.toHaveBeenCalled();
      expect(made.onEdit).not.toHaveBeenCalled();
    }
  });

  it('says nothing when finding faces fails', async () => {
    const { hook, deps, onEdit } = run({ enabled: false });
    deps.ensure.mockRejectedValue(new Error('down'));
    hook.rerender({ enabled: true, doc: splitDoc() });
    await act(async () => undefined);
    expect(deps.ensure).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });
});
