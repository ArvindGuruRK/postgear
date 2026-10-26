/**
 * The credits chip says a low balance in words, not only with its red fill
 * (user story 5.5's warning), and offers a retry when the balance failed.
 */
import { render, screen } from '@testing-library/react';
import type { AiCredits } from '@/types/ai';
import { CreditsChip } from './credits-meter';

// The design-system barrel pulls in animated-icon subpaths this jest setup
// cannot resolve, and only `cn` is used while rendering here.
jest.mock('@postgear/ui', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

const credits: AiCredits = {
  allowance: 100,
  used: 30,
  remaining: 70,
  resetsAt: '2026-11-01T00:00:00.000Z',
  tier: 'STANDARD',
  low: false,
  costs: { generate_post: 5, generate_image: 10, copilot_message: 1, seo_advice: 3 },
};

describe('CreditsChip', () => {
  it('shows what is left, with the numbers on its test id', () => {
    render(<CreditsChip credits={credits} failed={false} onRetry={() => {}} testId="chip" />);
    const chip = screen.getByTestId('chip');
    expect(chip.textContent).toBe('70 of 100 credits left');
    expect(chip.getAttribute('data-used')).toBe('30');
    expect(screen.queryByText('Running low.')).toBeNull();
  });

  it('says a low balance in words', () => {
    render(
      <CreditsChip
        credits={{ ...credits, used: 90, remaining: 10, low: true }}
        failed={false}
        onRetry={() => {}}
        testId="chip"
      />,
    );
    expect(screen.getByText('Running low.')).toBeTruthy();
  });

  it('offers a retry when the balance did not load', () => {
    render(<CreditsChip credits={null} failed onRetry={() => {}} testId="chip" />);
    expect(screen.getByRole('button', { name: "Credits didn't load, retry" })).toBeTruthy();
  });
});
