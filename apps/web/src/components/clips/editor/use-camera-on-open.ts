'use client';

/**
 * Detect Camera on first open (Sprint 13, Module 10): a clip a Find Clips
 * run made with a recipe's Split or Gameplay layout is marked
 * `meta.cameraOnOpen`, and its faces were asked for by the run. The first
 * time it opens, the editor puts the Camera box on the face camera quietly,
 * once, as one undo step: the same flow and sums as the Layouts tab's
 * Detect Camera button (`layouts/detect-camera.tsx`), with nothing said when
 * it fails or finds no face camera.
 *
 * The API takes the mark away on the clip's first document save, as it does
 * for `followOnOpen`, so a person who moves the box is never overridden.
 */
import {
  type CanvasSize,
  type ClipDocument,
  disableFollow,
  type FacePictureInput,
  setAreaCrop,
} from '@postgear/video-engine';
import { useEffect, useRef } from 'react';
import { ensureClipFaces, readClipFaces } from '@/lib/clips-api';
import {
  CAMERA_MOVED,
  cameraAreaOf,
  faceCameraCrop,
  readFaceFileBytes,
} from '../layouts/detect-camera-model';
import type { LayoutEdit } from '../layouts/layouts-panel';

/** How often the job is asked about while it looks, and for how long at most. */
const POLL_MS = 1_000;
const POLL_LIMIT = 180;

export interface CameraOnOpenDeps {
  ensure: typeof ensureClipFaces;
  read: typeof readClipFaces;
  loadFile: (url: string, signal: AbortSignal) => Promise<FacePictureInput[] | null>;
  wait: (ms: number) => Promise<void>;
}

async function loadFaceFile(url: string, signal: AbortSignal) {
  const response = await fetch(url, { credentials: 'omit', signal });
  if (!response.ok || !response.body) return null;
  return readFaceFileBytes(response.body);
}

export const CAMERA_ON_OPEN_DEPS: CameraOnOpenDeps = {
  ensure: ensureClipFaces,
  read: readClipFaces,
  loadFile: loadFaceFile,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** The face camera's crop on the document as it is: one change, or the document itself. */
export function cameraChange(
  current: ClipDocument,
  frames: readonly FacePictureInput[],
  videoSize: CanvasSize,
): ClipDocument {
  // While following, the box moves in the person's own layout (following goes off in the same step).
  const doc = disableFollow(current);
  const camera = cameraAreaOf(doc);
  const crop = camera ? faceCameraCrop(doc, camera, frames, videoSize) : null;
  if (!camera || !crop) return current;
  return setAreaCrop(doc, camera.id, crop, videoSize);
}

export function useCameraOnOpen({
  clipId,
  document,
  videoSize,
  enabled,
  available,
  onEdit,
  deps = CAMERA_ON_OPEN_DEPS,
}: {
  clipId: string;
  document: ClipDocument;
  videoSize: CanvasSize;
  /** The clip asks for it (`meta.cameraOnOpen`) and the editor is ready (the shape question answered). */
  enabled: boolean;
  /** Finding faces can run right now (`ai.faces`). */
  available: boolean;
  onEdit: LayoutEdit;
  deps?: CameraOnOpenDeps;
}): void {
  const ran = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const latest = useRef({ document, videoSize, onEdit, deps });
  latest.current = { document, videoSize, onEdit, deps };
  const hasCamera = cameraAreaOf(document) !== null;

  useEffect(() => {
    if (!enabled || !available || !hasCamera || ran.current) return;
    ran.current = true;
    const controller = new AbortController();
    abort.current = controller;
    const { signal } = controller;
    const { deps: d } = latest.current;
    // The layout as it opened: a person's own layout change while the faces load wins.
    const openedLayout = JSON.stringify(latest.current.document.layout);
    void (async () => {
      try {
        await d.ensure(clipId);
        let read = await d.read(clipId, { signal });
        for (let tries = 0; read.status === 'running' && tries < POLL_LIMIT; tries += 1) {
          await d.wait(POLL_MS);
          if (signal.aborted) return;
          read = await d.read(clipId, { signal });
        }
        if (signal.aborted || read.status !== 'ready') return;
        const frames = await d.loadFile(read.url, signal);
        if (signal.aborted || !frames) return;
        if (JSON.stringify(latest.current.document.layout) !== openedLayout) return;
        latest.current.onEdit(
          (current) => cameraChange(current, frames, latest.current.videoSize),
          CAMERA_MOVED,
        );
      } catch {
        // Quiet: the Layouts tab's Detect Camera is still there to press.
      } finally {
        if (abort.current === controller) abort.current = null;
      }
    })();
  }, [enabled, available, hasCamera, clipId]);

  // Only leaving stops it (a change meanwhile does not: it runs once per open). A stop before it
  // finished lets the next mount run it again (React mounts twice in development).
  useEffect(
    () => () => {
      if (abort.current && !abort.current.signal.aborted) {
        abort.current.abort();
        abort.current = null;
        ran.current = false;
      }
    },
    [],
  );
}
