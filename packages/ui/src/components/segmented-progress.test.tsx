import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { fillSegments, SegmentedProgress } from './segmented-progress';

describe('fillSegments', () => {
  it('lights the first cells and leaves the rest bare', () => {
    expect(fillSegments(2, 5)).toEqual(['full', 'full', 'empty', 'empty', 'empty']);
    expect(fillSegments(0, 3)).toEqual(['empty', 'empty', 'empty']);
  });

  it('never lights more than there are, or fewer than none', () => {
    expect(fillSegments(9, 3)).toEqual(['full', 'full', 'full']);
    expect(fillSegments(-4, 2)).toEqual(['empty', 'empty']);
    expect(fillSegments(Number.NaN, 2)).toEqual(['empty', 'empty']);
  });

  it('gives no cells for no total', () => {
    expect(fillSegments(3, 0)).toEqual([]);
    expect(fillSegments(3, -1)).toEqual([]);
  });
});

describe('SegmentedProgress', () => {
  it('is one image to assistive tech, named by the caller', () => {
    render(<SegmentedProgress segments={fillSegments(3, 7)} aria-label="3 of 7 published" />);

    expect(screen.getByRole('img', { name: '3 of 7 published' })).toBeInTheDocument();
    // The cells are decoration for that one label, not 7 progress bars.
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('draws a cell per segment and lights only the full ones', () => {
    const { container } = render(
      <SegmentedProgress segments={['full', 'empty', 'open', 'full']} aria-label="Weeks" />,
    );
    const cells = container.querySelectorAll('[data-segment]');

    expect([...cells].map((cell) => cell.getAttribute('data-segment'))).toEqual([
      'full',
      'empty',
      'open',
      'full',
    ]);
    expect(container.querySelectorAll('.bg-stripes-flow')).toHaveLength(2);
    // Only the open cell has the dashed outline.
    expect(container.querySelectorAll('.border-dashed')).toHaveLength(1);
    expect(cells[2]).toHaveClass('border-dashed');
  });

  it('hands every cell its place in the row, so the stripes can run through the gaps', () => {
    const { container } = render(
      <SegmentedProgress segments={fillSegments(3, 3)} aria-label="Done" />,
    );
    const cells = [...container.querySelectorAll<HTMLElement>('[data-segment]')];

    expect(cells.map((cell) => cell.style.getPropertyValue('--i'))).toEqual(['0', '1', '2']);
    expect(cells.map((cell) => cell.style.getPropertyValue('--n'))).toEqual(['3', '3', '3']);
    // The row is the size container the cells measure themselves against.
    expect(container.firstElementChild).toHaveClass('@container');
  });

  it('takes its fill from the tone, as Progress does', () => {
    const { container } = render(
      <SegmentedProgress segments={['full']} tone="accent" aria-label="Streak" />,
    );

    expect(container.querySelector('.bg-stripes-flow')).toHaveClass('bg-actionAccent');
  });

  it('crawls the stripes unless told not to, and never under reduced motion', () => {
    const { container, rerender } = render(
      <SegmentedProgress segments={['full']} aria-label="Crawling" />,
    );
    const fill = () => container.querySelector('.bg-stripes-flow');

    expect(fill()).toHaveClass('animate-segmentStripes', 'motion-reduce:animate-none');

    rerender(<SegmentedProgress segments={['full']} animated={false} aria-label="Still" />);
    expect(fill()).not.toHaveClass('animate-segmentStripes');
  });

  it('takes the size from the system, like Progress', () => {
    const { container } = render(
      <SegmentedProgress segments={['empty']} size="lg" aria-label="Large" />,
    );

    expect(container.querySelector('[data-segment]')).toHaveClass('h-8');
  });

  it('draws nothing but an empty row for no segments', () => {
    const { container } = render(<SegmentedProgress segments={[]} aria-label="None" />);

    expect(container.querySelectorAll('[data-segment]')).toHaveLength(0);
  });
});
