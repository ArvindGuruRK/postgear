'use client';

/**
 * Detect Camera (Sprint 13, Module 07): under the layout tiles when the
 * layout has a Camera area. One press finds the streamer's face camera and
 * puts the Camera box on it, as one undo step.
 *
 * Press: `POST /clips/:clipId/faces` (free). When no face file covers the
 * clip yet, a small `ai` Progress says "Finding faces" while the job looks
 * (a minute of clip takes a few seconds), polling `GET` for the file. Then
 * the file is read once and the sums run here (`detect-camera-model.ts`):
 * people, the face camera, the crop. None found: a warning, and nothing
 * changes. The Camera area is selected afterwards, so its box shows where it
 * moved on the Video pane.
 */
import { Alert, Button, Progress } from '@postgear/ui';
import {
  type CanvasSize,
  type ClipDocument,
  disableFollow,
  type FacePictureInput,
  setAreaCrop,
} from '@postgear/video-engine';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NOTE } from '@/components/studio/panel-ui';
import { ApiError } from '@/lib/api';
import { ensureClipFaces, readClipFaces } from '@/lib/clips-api';
import type { ClipJobView } from '@/types/clips';
import { WaitingNote } from '../waiting-note';
import { queuedOr } from '../waiting-words';
import {
  CAMERA_MOVED,
  cameraAreaOf,
  DETECT_CAMERA_LABEL,
  FACES_FAILED,
  FINDING_FACES,
  faceCameraCrop,
  NO_FACE_CAMERA,
  readFaceFileBytes,
} from './detect-camera-model';
import type { LayoutEdit } from './layouts-panel';

/** How often the job is asked about while it looks, and for how long at most. */
const POLL_MS = 1_000;
const POLL_LIMIT = 180;

type Phase =
  | { kind: 'idle' }
  | { kind: 'finding'; progress: number; job: Pick<ClipJobView, 'status' | 'waiting'> | null }
  | { kind: 'none' }
  | { kind: 'failed'; message: string };

export interface DetectCameraDeps {
  ensure: typeof ensureClipFaces;
  read: typeof readClipFaces;
  /** Fetches the face file from its address (the browser's own `fetch` by default). */
  loadFile: (url: string, signal: AbortSignal) => Promise<FacePictureInput[] | null>;
  wait: (ms: number) => Promise<void>;
}

async function loadFaceFile(url: string, signal: AbortSignal) {
  const response = await fetch(url, { credentials: 'omit', signal });
  if (!response.ok || !response.body) return null;
  return readFaceFileBytes(response.body);
}

const DEFAULT_DEPS: DetectCameraDeps = {
  ensure: ensureClipFaces,
  read: readClipFaces,
  loadFile: loadFaceFile,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export function DetectCamera({
  clipId,
  document,
  videoSize,
  available,
  onEdit,
  deps = DEFAULT_DEPS,
}: {
  clipId: string;
  document: ClipDocument;
  videoSize: CanvasSize;
  /** `ai.faces` from the status: false when the media service is off. */
  available: boolean;
  onEdit: LayoutEdit;
  deps?: DetectCameraDeps;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const area = cameraAreaOf(document);
  if (!area) return null;

  const fail = (message: string) => setPhase({ kind: 'failed', message });

  async function detect() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const { signal } = controller;
    setPhase({ kind: 'finding', progress: 0, job: null });
    try {
      const started = await deps.ensure(clipId);
      let read = await deps.read(clipId, { signal });
      for (let tries = 0; read.status === 'running' && tries < POLL_LIMIT; tries += 1) {
        setPhase({ kind: 'finding', progress: read.job.progress, job: read.job });
        await deps.wait(POLL_MS);
        if (signal.aborted) return;
        read = await deps.read(clipId, { signal });
      }
      if (started.status === 'running' && read.status === 'none') return fail(FACES_FAILED);
      if (read.status !== 'ready') return fail(FACES_FAILED);
      const frames = await deps.loadFile(read.url, signal);
      if (signal.aborted) return;
      if (!frames) return fail(FACES_FAILED);

      // The sums run on the document as it is now: the user may have edited meanwhile.
      let moved = false;
      // While following the speaker, the Camera box is moved in the person's own layout:
      // following goes off in the same undo step (Module 08), so `follow.saved` is never stale.
      onEdit(
        (current) => {
          const doc = disableFollow(current);
          const camera = cameraAreaOf(doc);
          const crop = camera ? faceCameraCrop(doc, camera, frames, videoSize) : null;
          if (!camera || !crop) return current;
          moved = true;
          return setAreaCrop(doc, camera.id, crop, videoSize);
        },
        CAMERA_MOVED,
        { selectArea: 'camera' },
      );
      setPhase(moved ? { kind: 'idle' } : { kind: 'none' });
    } catch (error) {
      if (signal.aborted) return;
      fail(error instanceof ApiError && error.message ? error.message : FACES_FAILED);
    }
  }

  const finding = phase.kind === 'finding';
  return (
    <div className="flex flex-col gap-2" data-testid="clip-detect-camera">
      {finding ? (
        <div className="flex flex-col gap-2">
          <Progress tone="ai" value={phase.progress} aria-label={FINDING_FACES} />
          <p className={NOTE}>{queuedOr(phase.job, FINDING_FACES)}</p>
          <WaitingNote job={phase.job} className={NOTE} />
        </div>
      ) : (
        <Button
          variant="secondary"
          className="w-full"
          disabled={!available}
          onClick={() => void detect()}
          data-testid="clip-detect-camera-button"
        >
          {DETECT_CAMERA_LABEL}
        </Button>
      )}
      {phase.kind === 'none' || phase.kind === 'failed' ? (
        <Alert variant="warning" className="items-center" data-testid="clip-detect-camera-warning">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">
            {phase.kind === 'none' ? NO_FACE_CAMERA : phase.message}
          </p>
        </Alert>
      ) : null}
    </div>
  );
}
