import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import type { ClipsHostedLane } from '@/types/clips';
import {
  AI_PRIVACY_LINES,
  AiPrivacyHint,
  aiPrivacyLines,
  hostedLaneLine,
  SPEECH_STAYS_HERE_LINE,
} from './ai-privacy-hint';

beforeAll(() => stubBrowserLayout());

const GROQ: ClipsHostedLane = {
  on: true,
  provider: 'groq',
  providerName: 'Groq',
  aboveMinutes: 55,
};
const OFF: ClipsHostedLane = { on: false, provider: null, providerName: null, aboveMinutes: null };

async function open(lane: ClipsHostedLane | null) {
  render(
    <TooltipProvider>
      <AiPrivacyHint lane={lane} />
    </TooltipProvider>,
  );
  const trigger = screen.getByRole('button', { name: 'What AI Makes From A Video' });
  await act(async () => {
    fireEvent.focus(trigger);
  });
  return screen.findByRole('tooltip');
}

describe('the privacy lines', () => {
  it('say what is made, that faces are positions, and that both go with the video', () => {
    expect(aiPrivacyLines(OFF)).toEqual([...AI_PRIVACY_LINES]);
    const text = AI_PRIVACY_LINES.join(' ');
    expect(text).toMatch(/text of what is said/);
    expect(text).toMatch(/where faces are/);
    expect(text).toMatch(/positions only, never as who someone is/);
    expect(text).toMatch(/deleted with the video/);
  });

  it('name the hosted provider and the threshold only while long speech goes there', () => {
    expect(hostedLaneLine(GROQ)).toBe(
      'When more than 55 minutes are listened to at once, the sound is sent to Groq to be turned into text.',
    );
    expect(aiPrivacyLines(GROQ)).toHaveLength(4);
    for (const lane of [OFF, null, undefined]) {
      expect(hostedLaneLine(lane)).toBeNull();
    }
  });

  it('say every listen goes there when the threshold is 0', () => {
    expect(hostedLaneLine({ ...GROQ, aboveMinutes: 0 })).toBe(
      'To turn speech into text, the sound is sent to Groq.',
    );
  });

  it('say speech stays here, never the provider, for a workspace that keeps it (Module 17 item 26)', () => {
    const lines = aiPrivacyLines(GROQ, true);
    expect(lines).toEqual([...AI_PRIVACY_LINES, SPEECH_STAYS_HERE_LINE]);
    expect(lines.join(' ')).not.toMatch(/Groq/);
    expect(aiPrivacyLines(OFF, true)).toContain(SPEECH_STAYS_HERE_LINE);
  });

  it('are sentences: each starts with a capital and ends with a full stop', () => {
    for (const line of aiPrivacyLines(GROQ)) {
      expect(line).toMatch(/^[A-Z].*\.$/);
    }
  });
});

describe('AiPrivacyHint', () => {
  it('opens on focus with the three sentences and no provider while the lane is off', async () => {
    const tooltip = await open(OFF);
    for (const line of AI_PRIVACY_LINES) expect(tooltip).toHaveTextContent(line);
    expect(tooltip).not.toHaveTextContent(/Groq/);
  });

  it('names Groq when long speech is sent there', async () => {
    const tooltip = await open(GROQ);
    expect(tooltip).toHaveTextContent('the sound is sent to Groq to be turned into text.');
  });
});
