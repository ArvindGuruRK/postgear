'use client';

import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './button';

export interface PaginationProps extends Omit<React.ComponentPropsWithoutRef<'nav'>, 'onChange'> {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  siblingCount?: number;
}

function getPageRange(page: number, pageCount: number, siblingCount: number): Array<number | 'ellipsis'> {
  const totalVisible = siblingCount * 2 + 5;
  if (pageCount <= totalVisible) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const left = Math.max(page - siblingCount, 2);
  const right = Math.min(page + siblingCount, pageCount - 1);
  const range: Array<number | 'ellipsis'> = [1];
  if (left > 2) range.push('ellipsis');
  for (let i = left; i <= right; i++) range.push(i);
  if (right < pageCount - 1) range.push('ellipsis');
  range.push(pageCount);
  return range;
}

export function Pagination({
  className,
  page,
  pageCount,
  onPageChange,
  siblingCount = 1,
  ...props
}: PaginationProps) {
  const pages = getPageRange(page, pageCount, siblingCount);
  return (
    <nav aria-label="pagination" className={cn('flex items-center gap-2', className)} {...props}>
      <Button
        variant="secondary"
        size="sm"
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="w-9 px-0"
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={3} />
      </Button>
      {pages.map((p, index) =>
        p === 'ellipsis' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: at most two stable ellipsis positions
          <span key={`ellipsis-${index}`} className="flex h-9 w-9 items-center justify-center text-ink opacity-50">
            <MoreHorizontal className="h-4 w-4" strokeWidth={3} />
          </span>
        ) : (
          <Button
            key={p}
            variant={p === page ? 'primary' : 'secondary'}
            size="sm"
            aria-current={p === page ? 'page' : undefined}
            onClick={() => onPageChange(p)}
            className="w-9 px-0"
          >
            {p}
          </Button>
        ),
      )}
      <Button
        variant="secondary"
        size="sm"
        aria-label="Next page"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
        className="w-9 px-0"
      >
        <ChevronRight className="h-4 w-4" strokeWidth={3} />
      </Button>
    </nav>
  );
}
