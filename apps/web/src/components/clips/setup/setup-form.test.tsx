import { TooltipProvider } from '@postgear/ui';
import { defaultClipSetup } from '@postgear/video-engine';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import type { ClipVideoDetail, SetupPriceView } from '@/types/clips';
import { fixtureVideo } from '../clips-fixtures';
import { SetupForm } from './setup-form';
import {
  ACTION_HELP,
  ACTION_VISION_NOTE,
  actionPriceLabel,
  FOLLOW_HELP,
  FOLLOW_OFF_NOTE,
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

function renderForm(action?: { available: boolean; vision: boolean }, faces?: boolean) {
  const video = { ...fixtureVideo(), durationMs: 600_000, status: 'READY' };
  const detail = { video } as unknown as ClipVideoDetail;
  render(
    <TooltipProvider>
      <SetupForm orgId="org-1" detail={detail} action={action} faces={faces} />
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

describe('Look For Action (Module 06)', () => {
  it('shows its price before it is switched on and turns it on in the setup', () => {
    const start = defaultClipSetup(600_000);
    expect(actionPriceLabel(start)).toBe('+5 AI Minutes');
    const on = setupReducer(start, { type: 'action', on: true });
    expect(on.action).toBe(true);
    expect(summaryLines(on, null)).toContain('Looking for action');
  });

  it('is hidden when it cannot run, and says so when stills go to AI', async () => {
    renderForm();
    await settle();
    expect(screen.queryByTestId('clip-setup-action')).toBeNull();
  });

  it('sends the switch with the price, and adds the still sentence only with vision on', async () => {
    renderForm({ available: true, vision: true });
    await settle();
    expect(screen.getByText('+5 AI Minutes')).toBeTruthy();
    expect(screen.getByText(`${ACTION_HELP} ${ACTION_VISION_NOTE}`)).toBeTruthy();
    fireEvent.click(screen.getByTestId('clip-setup-action'));
    await settle();
    expect(api.priceClipSetup).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ action: true }),
      expect.anything(),
    );
  });

  it('leaves the still sentence out with vision off', async () => {
    renderForm({ available: true, vision: false });
    await settle();
    expect(screen.getByText(ACTION_HELP)).toBeTruthy();
    expect(screen.queryByText(new RegExp(ACTION_VISION_NOTE))).toBeNull();
  });
});

describe('Follow The Speaker (Module 08)', () => {
  it('turns on only for a shape that can follow, and a wide shape turns it off', () => {
    const start = defaultClipSetup(600_000);
    const on = setupReducer(start, { type: 'follow', on: true });
    expect(on.follow).toBe(true);
    expect(summaryLines(on, null)).toContain('Following the speaker');
    const wide = setupReducer(on, { type: 'ratio', ratio: '16:9' });
    expect(wide.follow).toBe(false);
    expect(setupReducer(wide, { type: 'follow', on: true }).follow).toBe(false);
    // Back to a tall shape it stays off until switched on again.
    expect(setupReducer(wide, { type: 'ratio', ratio: '1:1' }).follow).toBe(false);
  });

  it('is free: the card says so and sends the switch with the price', async () => {
    renderForm(undefined, true);
    await settle();
    const card = screen.getByTestId('clip-setup-follow-card');
    expect(card).toHaveTextContent('Follow The Speaker');
    expect(card).toHaveTextContent('Free');
    expect(screen.getByText(FOLLOW_HELP)).toBeTruthy();
    expect(screen.getByTestId('clip-setup-follow')).toBeEnabled();
    fireEvent.click(screen.getByTestId('clip-setup-follow'));
    await settle();
    expect(api.priceClipSetup).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ follow: true, ratio: '9:16' }),
      expect.anything(),
    );
  });

  it('is off, and says why, when faces cannot be found', async () => {
    renderForm(undefined, false);
    await settle();
    expect(screen.getByTestId('clip-setup-follow')).toBeDisabled();
    expect(screen.getByText(`${FOLLOW_HELP} ${FOLLOW_OFF_NOTE}`)).toBeTruthy();
  });

  it('is hidden for the Horizontal shape, and the switch goes off with it', async () => {
    renderForm(undefined, true);
    await settle();
    fireEvent.click(screen.getByTestId('clip-setup-follow'));
    fireEvent.click(screen.getByText('Horizontal'));
    await settle();
    expect(screen.queryByTestId('clip-setup-follow-card')).toBeNull();
    expect(api.priceClipSetup).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ follow: false, ratio: '16:9' }),
      expect.anything(),
    );
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
