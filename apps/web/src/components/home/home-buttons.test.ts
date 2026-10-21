/**
 * Home's buttons are the design system's, never lookalikes.
 *
 * A hand-built "secondary" button (card surface, border, `hover:bg-primary`)
 * once lived on this page. It looked the same but had only a plain CSS hover,
 * so the soft circle that every real secondary button grows from the pointer
 * never ran here (2026-10-22). The tell is the CSS hover fill: the design
 * system's secondary gets it from its own classes and hook, so a Home file
 * that writes `hover:bg-primary` itself has rebuilt the button by hand.
 *
 * Use `Button` (variant "secondary") for a button, and `ActionLink`
 * (`home-actions.tsx`) for a link that acts as one.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const HOME_DIR = __dirname;
const FILES = readdirSync(HOME_DIR).filter((name) => name.endsWith('.tsx'));

describe('Home buttons', () => {
  it('finds the Home components to check', () => {
    expect(FILES).toEqual(expect.arrayContaining(['first-steps.tsx', 'home-banners.tsx']));
  });

  it.each(FILES)('%s has no hand-built hover fill', (name) => {
    const source = readFileSync(join(HOME_DIR, name), 'utf8');
    // Comments may mention the class; the code may not use it.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toContain('hover:bg-primary');
  });
});
