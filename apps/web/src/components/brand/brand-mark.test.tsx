/**
 * The logo stays out of the accessibility tree unless it is the only thing
 * naming the product, and the mark draws the gear plus both letters.
 */
import { render, screen } from '@testing-library/react';
import { BrandMark, BrandName, BrandTile, BrandWordmark } from './brand-mark';
import { BRAND_MARK, BRAND_TILE_LETTERS } from './brand-paths';

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

  it('draws the white centre, the shadow, the sticker rim and band, and the gear', () => {
    const { container } = render(<BrandMark />);
    expect(container.querySelectorAll('circle')).toHaveLength(1);
    expect(container.querySelectorAll('path')).toHaveLength(5);
    expect(container.querySelector('g')?.getAttribute('transform')).toBe(
      `translate(${BRAND_MARK.shadow} ${BRAND_MARK.shadow})`,
    );
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

describe('BrandName', () => {
  it('draws the wordmark sized from the text, with the real word for screen readers', () => {
    const { container } = render(<BrandName />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('class')).toContain('h-[0.76em]');
    expect(svg?.getAttribute('class')).toContain('fill-current');
    expect(container.textContent).toBe('PostGear');
    expect(container.querySelector('.sr-only')?.textContent).toBe('PostGear');
  });

  it('never wraps the name apart from itself', () => {
    const { container } = render(<BrandName className="ml-1" />);
    expect(container.firstElementChild?.getAttribute('class')).toContain('whitespace-nowrap');
    expect(container.firstElementChild?.getAttribute('class')).toContain('ml-1');
  });
});

describe('BrandTile', () => {
  it('is hidden from assistive tech by default', () => {
    const { container } = render(<BrandTile />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('is announced once, as one image, when given a label', () => {
    render(<BrandTile label="PostGear" />);
    const tile = screen.getByRole('img', { name: 'PostGear' });
    expect(tile.getAttribute('title')).toBe('PostGear');
    expect(tile.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps the old tile frame and draws the letters from path data, with no text', () => {
    const { container } = render(<BrandTile label="PostGear" />);
    const tile = container.firstElementChild;
    for (const name of [
      'h-14',
      'w-14',
      'rounded-xl',
      'border-2',
      'bg-actionPrimary',
      'shadow-brutalSm',
    ]) {
      expect(tile?.getAttribute('class')).toContain(name);
    }
    expect(tile?.textContent).toBe('');
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe(
      BRAND_TILE_LETTERS.viewBox,
    );
    const paths = container.querySelectorAll('path');
    expect(paths).toHaveLength(BRAND_TILE_LETTERS.paths.length);
    paths.forEach((path, i) => {
      expect(path.getAttribute('d')).toBe(BRAND_TILE_LETTERS.paths[i]);
      expect(path.getAttribute('class')).toContain('fill-onActionPrimary');
      expect(path.getAttribute('class')).toContain('stroke-onActionLight');
      expect(path.getAttribute('paint-order')).toBe('stroke');
    });
  });
});
