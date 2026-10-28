'use client';

/**
 * The design system's `Pagination`, fitted to a phone. With a neighbour each
 * side of the current page it can show nine buttons (388px), wider than a
 * phone's panel, so below `sm` it shows none (the first, current and last
 * pages and the arrows: seven buttons at most, 288px with the tighter gap),
 * and from `sm` the usual one. Both are rendered and CSS shows one, so the
 * server and the browser always agree; the hidden one is out of the
 * accessibility tree. Nothing at all when everything fits on one page.
 */
import { cn, Pagination } from '@postgear/ui';

export function StudioPagination({
  page,
  pageCount,
  onPageChange,
  label,
  className,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** What the navigation landmark is called ("Template pages"). */
  label: string;
  className?: string;
}) {
  if (pageCount <= 1) return null;

  return (
    <>
      <Pagination
        aria-label={label}
        page={page}
        pageCount={pageCount}
        onPageChange={onPageChange}
        siblingCount={0}
        className={cn('gap-1.5 sm:hidden', className)}
      />
      <Pagination
        aria-label={label}
        page={page}
        pageCount={pageCount}
        onPageChange={onPageChange}
        className={cn('hidden sm:flex', className)}
      />
    </>
  );
}
