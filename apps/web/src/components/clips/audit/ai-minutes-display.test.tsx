/**
 * Where the AI minutes number shows (Sprint 13, Module 15 section 4): the
 * number on a button is the number the Summary adds up and the API charges;
 * too few minutes keeps the button off and says the missing number; and the
 * two AI currencies keep their own names (Clips: AI minutes; text and
 * images: AI credits), never each other's.
 */
import { TooltipProvider } from '@postgear/ui';
import { aiMinutesCost, defaultClipSetup } from '@postgear/video-engine';
import { act, render, screen } from '@testing-library/react';
import { CreditsChip, CreditsMeter } from '@/components/ai/credits-meter';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import type { AiCredits } from '@/types/ai';
import type { ClipVideoDetail, SetupPriceView } from '@/types/clips';
import { fixtureVideo } from '../clips-fixtures';
import { AiMinutesChipView } from '../home/clips-meters';
import { voiceButtonLabel } from '../panels/ai-effects-model';
import { pricedLabel } from '../panels/captions-model';
import { SetupForm } from '../setup/setup-form';
import { actionPriceLabel, setupButtonLabel } from '../setup/setup-model';
import { autoEditButtonLabel } from '../video/auto-edit-model';
import { findClipsLabel, quickFindLabel } from '../video/find-clips-model';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/clips-api', () => ({ priceClipSetup: jest.fn(), startHighlights: jest.fn() }));
jest.mock('@/lib/clips-recipes-api', () => ({
  listRecipes: jest.fn(async () => ({ recipes: [], own: 0, max: 50 })),
  listClipBrandKits: jest.fn(async () => ({ brandKits: [] })),
  createRecipe: jest.fn(),
}));
// The page's own chip reads the plan snapshot; the view is drawn on its own below.
jest.mock('@/lib/entitlements', () => ({ meterOf: () => null, useEntitlements: () => ({}) }));
const api = jest.requireMock('@/lib/clips-api') as Record<string, jest.Mock>;

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const TEN_MINUTES = 600_000;
const CYCLE_END = '2026-12-01T00:00:00.000Z';

/** What `POST /clips/videos/:id/setup/price` answers: listening, reading, the signals. */
function price(listen: number, read: number, remaining: number | null): SetupPriceView {
  return {
    lines: [
      { step: 'listen', aiMinutes: listen },
      { step: 'read', aiMinutes: read },
      { step: 'signals', aiMinutes: listen === 0 ? 3 : 0 },
    ],
    total: listen + read + (listen === 0 ? 3 : 0),
    rangeMs: TEN_MINUTES,
    remaining,
    limit: 300,
    cycleEnd: CYCLE_END,
  };
}

async function drawSetup(answer: SetupPriceView) {
  api.priceClipSetup?.mockResolvedValue(answer);
  const video = { ...fixtureVideo(), durationMs: TEN_MINUTES, status: 'READY' };
  render(
    <TooltipProvider>
      <SetupForm orgId="org-1" detail={{ video } as unknown as ClipVideoDetail} />
    </TooltipProvider>,
  );
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
  return screen.findByTestId('clip-setup-find');
}

/** The number in "Find Clips (13 AI Minutes)". */
const buttonNumber = (text: string | null) => Number(/\((\d+) AI Minutes?\)/.exec(text ?? '')?.[1]);

describe('Clip Setup: the Find Clips label and the Summary total are one number', () => {
  it.each([
    ['a fresh ten-minute video (listen 10, read 3)', price(10, 3, 300)],
    ['a video already listened to (read 3, signals 3)', price(0, 3, 300)],
    ['an hour of talk (listen 58, read 15)', price(58, 15, 300)],
  ])('%s', async (_name, answer) => {
    const button = await drawSetup(answer);
    const total = Number(screen.getByTestId('clip-setup-total').textContent);
    expect(total).toBe(answer.total);
    expect(buttonNumber(button.textContent)).toBe(total);
    expect(button).toHaveTextContent(setupButtonLabel(answer));
    expect(button).toBeEnabled();
  });

  it('is enough when the minutes left equal the price, as the API agrees', async () => {
    const button = await drawSetup(price(10, 3, 13));
    expect(screen.queryByTestId('clip-setup-shortfall')).toBeNull();
    expect(button).toBeEnabled();
  });
});

describe('Clip Setup: too few minutes', () => {
  it('keeps the button off and states the number needed and the number left', async () => {
    const button = await drawSetup(price(10, 3, 9));
    const shortfall = await screen.findByTestId('clip-setup-shortfall');
    expect(shortfall).toHaveTextContent('This needs 13 AI minutes and you have 9 left.');
    expect(shortfall).toHaveTextContent('They come back on 1 December');
    // The number missing is the button's own number less what is left.
    expect(buttonNumber(button.textContent)).toBe(13);
    expect(button).toBeDisabled();
  });

  it('says none are left, and stays off, at zero', async () => {
    const button = await drawSetup(price(10, 3, 0));
    expect(await screen.findByTestId('clip-setup-shortfall')).toHaveTextContent(
      'This workspace has used all its AI minutes for this month. They reset on 1 December.',
    );
    expect(button).toBeDisabled();
  });
});

describe('every priced Clips button reads the rate table, in AI minutes', () => {
  it('labels each step with what the API charges for it', () => {
    expect(quickFindLabel(aiMinutesCost('signals', TEN_MINUTES))).toBe('Quick Find (3 AI Minutes)');
    expect(findClipsLabel(aiMinutesCost('signals', 60_000))).toBe('Find Clips (1 AI Minute)');
    expect(actionPriceLabel(defaultClipSetup(TEN_MINUTES))).toBe(
      `+${aiMinutesCost('action', TEN_MINUTES)} AI Minutes`,
    );
    expect(pricedLabel('Add Captions', aiMinutesCost('listen', 60_000))).toBe(
      'Add Captions (2 AI Minutes)',
    );
    expect(pricedLabel('Translate To Tamil', aiMinutesCost('translate', 30_000))).toBe(
      'Translate To Tamil (1 AI Minute)',
    );
    expect(voiceButtonLabel(35)).toBe('Make The Voice (1 AI Minute)');
    expect(voiceButtonLabel(500)).toBe('Make The Voice (1 AI Minute)');
    expect(autoEditButtonLabel(aiMinutesCost('listen', TEN_MINUTES))).toBe(
      'Auto-Edit Video (10 AI Minutes)',
    );
  });

  it('drops the price when a step costs nothing (already listened to)', () => {
    expect(pricedLabel('Add Captions', 0)).toBe('Add Captions');
    expect(autoEditButtonLabel(0)).toBe('Auto-Edit Video');
  });
});

const credits: AiCredits = {
  allowance: 100,
  used: 30,
  remaining: 70,
  resetsAt: '2026-11-01T00:00:00.000Z',
  tier: 'STANDARD',
  low: false,
  costs: {
    generate_post: 5,
    generate_image: 10,
    copilot_message: 1,
    seo_advice: 3,
    generate_snippet: 2,
  },
};

describe('two currencies, two names', () => {
  it('the Clips chip says AI minutes, never credits', () => {
    render(
      <TooltipProvider>
        <AiMinutesChipView meter={{ limit: 300, remaining: 240, cycleEnd: CYCLE_END }} orgId="o" />
      </TooltipProvider>,
    );
    const chip = screen.getByTestId('clips-ai-minutes');
    expect(chip).toHaveTextContent('240 of 300 AI minutes left');
    expect(chip.textContent).not.toMatch(/credit/i);
  });

  it('the text and image meter says AI Credits, and its chip credits, never minutes', () => {
    render(
      <>
        <CreditsMeter credits={credits} failed={false} onRetry={() => undefined} />
        <CreditsChip credits={credits} failed={false} onRetry={() => undefined} testId="chip" />
      </>,
    );
    const meter = screen.getByTestId('credits-meter');
    expect(meter).toHaveTextContent('AI Credits');
    expect(screen.getByRole('progressbar')).toHaveAccessibleName('AI credits: 30 of 100 used');
    const chip = screen.getByTestId('chip');
    expect(chip).toHaveTextContent('70 of 100 AI credits left');
    for (const text of [meter.textContent, chip.textContent]) {
      expect(text).not.toMatch(/minute/i);
    }
  });
});
