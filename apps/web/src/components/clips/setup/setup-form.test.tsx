import { TooltipProvider } from '@postgear/ui';
import { defaultClipSetup } from '@postgear/video-engine';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import type { ClipVideoDetail, SetupPriceView } from '@/types/clips';
import { fixtureVideo } from '../clips-fixtures';
import { SetupForm } from './setup-form';
import {
  minutesLabel,
  priceLines,
  setupButtonLabel,
  setupReducer,
  shortfallSentence,
  summaryLines,
} from './setup-model';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('@/lib/clips-api', () => ({
  priceClipSetup: jest.fn(),
  startHighlights: jest.fn(),
}));
jest.mock('../home/clips-meters', () => ({ AiMinutesChip: () => null }));
const api = jest.requireMock('@/lib/clips-api') as Record<string, jest.Mock>;

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});

function price(total: number, remaining: number | null = 300): SetupPriceView {
  return {
    lines: [
      { step: 'listen', aiMinutes: total - 3 },
      { step: 'read', aiMinutes: 3 },
      { step: 'signals', aiMinutes: 0 },
    ],
    total,
    rangeMs: 600_000,
    remaining,
    limit: 300,
    cycleEnd: '2026-12-01T00:00:00.000Z',
  };
}

function renderForm() {
  const video = { ...fixtureVideo(), durationMs: 600_000, status: 'READY' };
  const detail = { video } as unknown as ClipVideoDetail;
  render(
    <TooltipProvider>
      <SetupForm orgId="org-1" detail={detail} />
    </TooltipProvider>,
  );
  return video;
}

beforeEach(() => {
  jest.useFakeTimers();
  push.mockClear();
  for (const mock of Object.values(api)) mock.mockReset();
  api.priceClipSetup?.mockResolvedValue(price(13));
});
afterEach(() => jest.useRealTimers());

async function settle() {
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
}

describe('the setup model', () => {
  it('reads the price back line by line, free when 0', () => {
    expect(priceLines(price(13))).toEqual([
      { step: 'listen', name: 'Listening', value: '10' },
      { step: 'read', name: 'Reading', value: '3' },
      { step: 'signals', name: 'Sound And Picture', value: 'free' },
    ]);
    expect(setupButtonLabel(price(1))).toBe('Find Clips (1 AI Minute)');
    expect(setupButtonLabel(null)).toBe('Find Clips');
    expect(minutesLabel(73)).toBe('73 AI Minutes');
  });

  it('says how many minutes are needed and left, or that none are left', () => {
    expect(shortfallSentence(price(15, 9))).toBe(
      'This needs 15 AI minutes and you have 9 left. They come back on 1 December, or you can upgrade the plan.',
    );
    expect(shortfallSentence(price(15, 0))).toBe(
      'This workspace has used all its AI minutes for this month. They reset on 1 December.',
    );
    expect(shortfallSentence(price(15, 20))).toBeNull();
    expect(shortfallSentence(price(15, null))).toBeNull();
  });

  it('changes one choice at a time and summarises them', () => {
    const start = defaultClipSetup(600_000);
    const next = setupReducer(setupReducer(start, { type: 'ratio', ratio: '1:1' }), {
      type: 'length',
      length: '30to60',
    });
    expect(next).toMatchObject({ ratio: '1:1', length: '30to60', genre: 'auto' });
    expect(summaryLines(next, null)).toEqual(['10:00 of video', 'Square, 30 to 60 seconds']);
    const captioned = setupReducer(next, { type: 'captions', on: true });
    expect(summaryLines({ ...captioned, genre: 'gaming' }, 'Bold Pop')).toEqual([
      '10:00 of video',
      'Square, 30 to 60 seconds',
      'Captions: Bold Pop',
      'Genre: Gaming',
    ]);
  });
});

describe('Clip Setup', () => {
  it('asks the price for the whole video first and puts the total on the button', async () => {
    const video = renderForm();
    await settle();
    expect(api.priceClipSetup).toHaveBeenCalledWith(
      video.id,
      expect.objectContaining({ range: { fromMs: 0, toMs: 600_000 }, genre: 'auto' }),
      expect.anything(),
    );
    expect(await screen.findByTestId('clip-setup-find')).toHaveTextContent(
      'Find Clips (13 AI Minutes)',
    );
    expect(screen.getByTestId('clip-setup-total')).toHaveTextContent('13');
  });

  it('asks again when a choice changes, and sends the request and the shape', async () => {
    renderForm();
    await settle();
    fireEvent.change(screen.getByTestId('clip-setup-request'), {
      target: { value: 'tunnel jump' },
    });
    fireEvent.click(screen.getByText('Square'));
    await settle();
    expect(api.priceClipSetup).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ request: 'tunnel jump', ratio: '1:1' }),
      expect.anything(),
    );
  });

  it('keeps Find Clips off with the sentence when the minutes are short', async () => {
    api.priceClipSetup?.mockResolvedValue(price(15, 9));
    renderForm();
    await settle();
    expect(await screen.findByTestId('clip-setup-shortfall')).toHaveTextContent(
      'This needs 15 AI minutes and you have 9 left.',
    );
    expect(screen.getByTestId('clip-setup-find')).toBeDisabled();
  });

  it('starts the run with the setup and goes back to the video page', async () => {
    api.startHighlights?.mockResolvedValue({});
    const video = renderForm();
    await settle();
    await waitFor(() => expect(screen.getByTestId('clip-setup-find')).toBeEnabled());
    fireEvent.click(screen.getByTestId('clip-setup-find'));
    await act(async () => undefined);
    expect(api.startHighlights).toHaveBeenCalledWith(
      video.id,
      expect.objectContaining({ captions: expect.objectContaining({ on: false }) }),
    );
    expect(push).toHaveBeenCalledWith(`/org-1/clips/video/${video.id}`);
  });
});
