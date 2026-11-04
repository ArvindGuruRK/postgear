import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stepColour } from './step-glyph';

describe('stepColour', () => {
  it.each([
    ['schedule', 'var(--color-brutal-accent)'],
    ['sparkles', 'var(--color-brutal-ai)'],
    ['review', 'var(--color-forth)'],
    ['bell', 'var(--color-brutal-success)'],
  ])('%s goes by its icon: %s', (icon, colour) => {
    expect(stepColour(icon)).toBe(colour);
  });

  it('falls back to the blue of an unknown icon', () => {
    expect(stepColour('not-an-icon')).toBe('var(--color-forth)');
  });

  // Every logo's token has to exist, or a selected step's ring would vanish with no error anywhere.
  it.each([
    'instagram',
    'facebook',
    'x',
    'linkedin',
    'youtube',
    'tiktok',
    'pinterest',
    'slack',
    'teams',
    'discord',
    'google-sheets',
    'excel',
  ])('%s goes by a logo colour that is declared', (icon) => {
    const colours = readFileSync(
      join(__dirname, '../../../../../../packages/ui/src/styles/colors.css'),
      'utf8',
    );
    expect(stepColour(icon)).toBe(`var(--color-logo-${icon})`);
    expect(colours).toContain(`--color-logo-${icon}: #`);
  });
});
