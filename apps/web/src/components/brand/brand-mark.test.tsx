/**
 * The logo stays out of the accessibility tree unless it is the only thing
 * naming the product, and the mark draws the gear plus both letters.
 */
import { render, screen } from '@testing-library/react';
import { BrandMark, BrandWordmark } from './brand-mark';
import { BRAND_MARK } from './brand-paths';

// The design-system barrel pulls in animated-icon subpaths this jest setup
// cannot resolve, and only `cn` is used while rendering here.
jest.mock('@postgear/ui', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

describe('BrandMark', () => {
  it('is hidden from assistive tech by default', () => {
    const { container } = render(<BrandMark />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('is announced as an image when given a label', () => {
    render(<BrandMark label="PostGear" />);
    expect(screen.getByRole('img', { name: 'PostGear' }).getAttribute('aria-hidden')).toBeNull();
  });

  it('draws the gear and one path per letter of PG', () => {
    const { container } = render(<BrandMark />);
    expect(BRAND_MARK.letters).toHaveLength(2);
    expect(container.querySelectorAll('path')).toHaveLength(3);
  });
});

describe('BrandWordmark', () => {
  it('takes the surrounding text colour', () => {
    const { container } = render(<BrandWordmark className="h-6" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('fill-current');
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('h-6');
  });

  it('is announced as an image when given a label', () => {
    render(<BrandWordmark label="PostGear" />);
    expect(screen.getByRole('img', { name: 'PostGear' })).toBeTruthy();
  });
});
