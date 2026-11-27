import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { ApiError } from '@/lib/api';
import type { ClipJobView } from '@/types/clips';
import type { AutoEditPriceView } from '@/types/clips-recipes';
import { type AutoEditDeps, AutoEditDialog } from './auto-edit-dialog';
import { AUTO_EDIT_TOO_LONG, NO_SPEECH_NOTE } from './auto-edit-model';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('@/lib/clips-api', () => ({ cancelClipJob: jest.fn() }));
jest.mock('@/lib/clips-recipes-api', () => ({
  listRecipes: jest.fn(),
  autoEditPrice: jest.fn(),
  startAutoEdit: jest.fn(),
}));
jest.mock('../home/clips-meters', () => ({ AiMinutesChip: () => null }));
const mockJob: { current: ClipJobView | null } = { current: null };
jest.mock('../use-clip-job', () => ({
  useClipJob: (jobId: string | null) => ({
    job: jobId && mockJob.current?.id === jobId ? mockJob.current : null,
    error: null,
    refresh: jest.fn(),
  }),
}));

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});
beforeEach(() => {
  push.mockReset();
  mockJob.current = null;
});

function priceOf(aiMinutes: number, remaining: number | null = 100): AutoEditPriceView {
  return {
    aiMinutes,
    range: { fromMs: 0, toMs: 600_000 },
    needsRange: false,
    remaining,
    limit: 200,
    cycleEnd: '2026-12-01T00:00:00.000Z',
  };
}

function fakeDeps(price = priceOf(12)): jest.Mocked<AutoEditDeps> {
  return {
    list: jest.fn(async () => ({ recipes: [], own: 0, max: 50 })),
    price: jest.fn(async () => price),
    start: jest.fn(),
    cancel: jest.fn(async () => ({}) as never),
  } as unknown as jest.Mocked<AutoEditDeps>;
}

function renderDialog(deps: AutoEditDeps, durationMs = 600_000) {
  return render(
    <TooltipProvider>
      <AutoEditDialog
        orgId="org-1"
        video={{ id: 'video-1', title: 'Talk', durationMs }}
        open
        onOpenChange={jest.fn()}
        deps={deps}
      />
    </TooltipProvider>,
  );
}

const startButton = () => screen.getByTestId('clip-auto-edit-start') as HTMLButtonElement;

describe('Auto-Edit Video', () => {
  it('opens on Auto-Edit Talking Video with its line, and prices the whole video', async () => {
    const deps = fakeDeps();
    renderDialog(deps);
    expect(screen.getByTestId('clip-auto-edit-line').textContent).toBe(
      'Removes silences and filler words, adds captions',
    );
    await waitFor(() => expect(startButton().textContent).toBe('Auto-Edit Video (12 AI Minutes)'));
    expect(deps.price).toHaveBeenCalledWith('video-1', {
      recipeId: 'starter-auto-edit-talking-video',
    });
    expect(startButton().disabled).toBe(false);
    expect(screen.queryByTestId('clip-auto-edit-range')).toBeNull();
  });

  it('says when no AI minutes are needed', async () => {
    renderDialog(fakeDeps(priceOf(0)));
    expect(await screen.findByText('No AI minutes needed')).toBeTruthy();
    expect(startButton().textContent).toBe('Auto-Edit Video');
  });

  it('shows the range handles and the sentence past 30 minutes, and sends the range', async () => {
    const deps = fakeDeps();
    renderDialog(deps, 3_600_000);
    expect(screen.getByTestId('clip-auto-edit-range').textContent).toContain(AUTO_EDIT_TOO_LONG);
    await waitFor(() =>
      expect(deps.price).toHaveBeenCalledWith('video-1', {
        recipeId: 'starter-auto-edit-talking-video',
        range: { fromMs: 0, toMs: 1_800_000 },
      }),
    );
  });

  it('turns the button off with the missing minutes and See Plans', async () => {
    renderDialog(fakeDeps(priceOf(12, 5)));
    const shortfall = await screen.findByTestId('clip-auto-edit-shortfall');
    expect(shortfall.textContent).toContain('This needs 12 AI minutes and you have 5 left.');
    expect(screen.getByText('See Plans')).toBeTruthy();
    expect(startButton().disabled).toBe(true);
  });

  it('shows a refusal from the server in an Alert', async () => {
    const deps = fakeDeps();
    deps.start.mockRejectedValue(
      new ApiError('You have used this month of AI minutes.', 402, 'clips_ai_minutes'),
    );
    renderDialog(deps);
    await waitFor(() => expect(startButton().disabled).toBe(false));
    await act(async () => {
      fireEvent.click(startButton());
    });
    expect(screen.getByText('You have used this month of AI minutes.')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('shows the job in words, then opens the clip by itself with the skipped parts', async () => {
    const deps = fakeDeps();
    deps.start.mockResolvedValue({
      clipId: 'clip-9',
      job: { id: 'job-1', status: 'RUNNING' } as ClipJobView,
      aiMinutes: 12,
      skipped: [],
      noSpeech: false,
    });
    mockJob.current = {
      id: 'job-1',
      status: 'RUNNING',
      stage: 'listening',
      stageLabel: 'Listening',
      progress: 30,
    } as ClipJobView;
    const view = renderDialog(deps);
    await waitFor(() => expect(startButton().disabled).toBe(false));
    await act(async () => {
      fireEvent.click(startButton());
    });
    expect(screen.getByTestId('clip-auto-edit-progress').textContent).toContain(
      'Listening to what is said',
    );

    mockJob.current = {
      id: 'job-1',
      status: 'RUNNING',
      stage: 'applying',
      stageLabel: 'Applying',
      progress: 80,
    } as ClipJobView;
    view.rerender(
      <TooltipProvider>
        <AutoEditDialog
          orgId="org-1"
          video={{ id: 'video-1', title: 'Talk', durationMs: 600_000 }}
          open
          onOpenChange={jest.fn()}
          deps={deps}
        />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('clip-auto-edit-progress').textContent).toContain(
      'Applying your recipe',
    );

    mockJob.current = {
      id: 'job-1',
      status: 'DONE',
      clipId: 'clip-9',
      result: {
        clipId: 'clip-9',
        skipped: [{ part: 'follow', reason: 'no_faces' }],
        noSpeech: false,
      },
    } as unknown as ClipJobView;
    await act(async () => {
      view.rerender(
        <TooltipProvider>
          <AutoEditDialog
            orgId="org-1"
            video={{ id: 'video-1', title: 'Talk', durationMs: 600_000 }}
            open
            onOpenChange={jest.fn()}
            deps={deps}
          />
        </TooltipProvider>,
      );
    });
    expect(push).toHaveBeenCalledWith('/org-1/clips/edit/clip-9');
    expect(screen.getByTestId('clip-auto-edit-note').textContent).toBe(
      'Follow The Speaker was skipped: we could not find anyone to follow.',
    );
    fireEvent.click(screen.getByTestId('clip-auto-edit-open'));
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('keeps a failed listen sentence on screen after the new price comes back', async () => {
    const deps = fakeDeps();
    deps.start.mockResolvedValue({
      clipId: 'clip-9',
      job: { id: 'job-1', status: 'RUNNING' } as ClipJobView,
      aiMinutes: 12,
      skipped: [],
      noSpeech: false,
    });
    mockJob.current = { id: 'job-1', status: 'RUNNING', stage: 'listening' } as ClipJobView;
    const view = renderDialog(deps);
    await waitFor(() => expect(startButton().disabled).toBe(false));
    await act(async () => {
      fireEvent.click(startButton());
    });
    const sentence =
      'We could not finish listening to this video. Your AI minutes were given back.';
    mockJob.current = {
      id: 'job-1',
      status: 'FAILED',
      error: { code: 'transcribe_failed', message: sentence },
    } as unknown as ClipJobView;
    const calls = deps.price.mock.calls.length;
    await act(async () => {
      view.rerender(
        <TooltipProvider>
          <AutoEditDialog
            orgId="org-1"
            video={{ id: 'video-1', title: 'Talk', durationMs: 600_000 }}
            open
            onOpenChange={jest.fn()}
            deps={deps}
          />
        </TooltipProvider>,
      );
    });
    await waitFor(() => expect(deps.price.mock.calls.length).toBeGreaterThan(calls));
    await act(async () => undefined);
    expect(screen.getByText(sentence)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('opens the editor at once when nothing needs listening, and says nobody spoke', async () => {
    const deps = fakeDeps(priceOf(0));
    deps.start.mockResolvedValue({
      clipId: 'clip-3',
      job: null,
      aiMinutes: 0,
      skipped: [],
      noSpeech: true,
    });
    renderDialog(deps);
    await waitFor(() => expect(startButton().disabled).toBe(false));
    await act(async () => {
      fireEvent.click(startButton());
    });
    expect(push).toHaveBeenCalledWith('/org-1/clips/edit/clip-3');
    expect(screen.getByTestId('clip-auto-edit-note').textContent).toBe(NO_SPEECH_NOTE);
  });
});
