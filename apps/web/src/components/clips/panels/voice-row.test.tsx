/**
 * Text To Speech with the real job hook (`useClipJob`, the default `useJob`):
 * the job's view first, then its event stream, as the editor runs it.
 */
import { TooltipProvider } from '@postgear/ui';
import {
  addSound,
  type ClipDocument,
  countSounds,
  createClipDocument,
  MAX_SOUNDS,
} from '@postgear/video-engine';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useRef, useState } from 'react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import type { ClipJobEvent, ClipJobView } from '@/types/clips';
import { PlaybackStore } from '../editor/playback';
import { useClipJob } from '../use-clip-job';
import type { AiEffectsDeps } from './ai-effects-deps';
import { TOO_MANY_SOUNDS } from './audio-model';
import { VoiceRow } from './voice-row';

jest.mock('../home/clips-meters', () => ({ AiMinutesChip: () => null }));
jest.mock('@/lib/clips-api', () => ({
  getClipJob: jest.fn(),
  clipJobEventsPath: (jobId: string) => `/clips/jobs/${jobId}/events`,
}));
jest.mock('@/lib/sse', () => ({ streamGetEvents: jest.fn() }));

const clipsApi = jest.requireMock('@/lib/clips-api') as { getClipJob: jest.Mock };
const sse = jest.requireMock('@/lib/sse') as { streamGetEvents: jest.Mock };

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});

const VIDEO = '3f2a9c1e-0000-4000-8000-000000000010';
const JOB = 'd128e796-2366-4789-86c8-8904c5db4039';

function view(status: ClipJobView['status']): ClipJobView {
  const done = status === 'DONE';
  return {
    id: JOB,
    kind: 'SPEECH',
    status,
    stage: 'voice',
    stageLabel: done ? 'Done' : 'Making the voice',
    progress: done ? 100 : 0,
    etaSeconds: null,
    videoId: null,
    clipId: 'clip-1',
    error: null,
    result: done ? { assetId: JOB, durationMs: 2_580 } : null,
    createdAt: '2026-11-27T00:00:00Z',
    startedAt: null,
    finishedAt: null,
  } as unknown as ClipJobView;
}

function deps(reused: boolean[]): AiEffectsDeps {
  return {
    voices: jest.fn(async () => ({
      enabled: true,
      voices: [{ id: 'sim-river', name: 'River', languages: ['en'], sampleUrl: null }],
    })),
    makeVoice: jest.fn(async () => {
      const again = reused.shift() ?? false;
      return { job: view(again ? 'DONE' : 'QUEUED'), price: again ? 0 : 1, reused: again };
    }),
    cancelJob: jest.fn(async () => undefined),
    useJob: useClipJob,
    playSample: jest.fn(() => () => undefined),
  } as unknown as AiEffectsDeps;
}

function plainClip(): ClipDocument {
  return createClipDocument({ videoId: VIDEO, fromMs: 5_000, toMs: 40_000, ratio: '9:16' });
}

function Harness({
  deps: given,
  playback,
  initial = plainClip(),
}: {
  deps: AiEffectsDeps;
  playback: PlaybackStore;
  initial?: ClipDocument;
}) {
  const [doc, setDoc] = useState<ClipDocument>(initial);
  const latest = useRef(doc);
  latest.current = doc;
  return (
    <TooltipProvider>
      <VoiceRow
        input={{
          orgId: 'org-1',
          clipId: 'clip-1',
          videoId: VIDEO,
          videoDurationMs: 180_000,
          waveform: null,
          status: null,
          onEdit: (change) => {
            const next = change(latest.current);
            if (next === latest.current) return false;
            latest.current = next;
            setDoc(next);
            return true;
          },
          flushRevision: async () => 7,
          deps: given,
        }}
        deps={given}
        playback={playback}
      />
      <output data-testid="doc">{JSON.stringify(doc)}</output>
    </TooltipProvider>
  );
}

describe('Text To Speech with the real job hook', () => {
  it('adds the voice when the stream says done, and again when the same line is reused', async () => {
    // The first view is still queued; the stream then reports done and ends.
    clipsApi.getClipJob.mockResolvedValueOnce(view('QUEUED')).mockResolvedValue(view('DONE'));
    sse.streamGetEvents.mockImplementation(
      async (_path: string, options: { onEvent: (event: ClipJobEvent) => void }) => {
        await Promise.resolve();
        options.onEvent({ type: 'progress', ...view('RUNNING') });
        options.onEvent({ type: 'done', ...view('DONE') });
      },
    );
    const playback = new PlaybackStore();
    render(
      <StrictMode>
        <Harness deps={deps([false, true])} playback={playback} />
      </StrictMode>,
    );
    const doc = (): ClipDocument => JSON.parse(screen.getByTestId('doc').textContent ?? '{}');
    await screen.findByRole('radio', { name: 'River' });
    fireEvent.change(screen.getByPlaceholderText('Enter your words'), {
      target: { value: 'Wait for the twist at the end of this clip.' },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('clip-voice-make'));
    });
    await waitFor(() => expect(countSounds(doc())).toBe(1));
    await waitFor(() => expect(screen.queryByTestId('clip-voice-progress')).toBeNull());

    // The same line and voice: the finished job comes back (no charge) and is added again.
    await act(async () => {
      fireEvent.click(screen.getByTestId('clip-voice-make'));
    });
    await waitFor(() => expect(countSounds(doc())).toBe(2));
    await waitFor(() => expect(screen.queryByTestId('clip-voice-progress')).toBeNull());
  });

  it('says the clip is full instead of hanging when the sound row has no room', async () => {
    clipsApi.getClipJob.mockResolvedValue(view('DONE'));
    let full = plainClip();
    for (let k = 0; k < MAX_SOUNDS; k += 1) {
      const result = addSound(full, { asset: `asset-${k}` }, 'sfx', k * 1_500, {
        durationMs: 1_000,
      });
      if (result.ok) full = result.doc;
    }
    expect(countSounds(full)).toBe(MAX_SOUNDS);
    const playback = new PlaybackStore();
    render(<Harness deps={deps([false])} playback={playback} initial={full} />);
    await screen.findByRole('radio', { name: 'River' });
    fireEvent.change(screen.getByPlaceholderText('Enter your words'), { target: { value: 'Hi' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('clip-voice-make'));
    });
    expect(await screen.findByTestId('clip-voice-problem')).toHaveTextContent(TOO_MANY_SOUNDS);
    expect(screen.queryByTestId('clip-voice-progress')).toBeNull();
  });
});
