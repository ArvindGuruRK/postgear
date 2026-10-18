'use client';

/**
 * The crawl in one line of chips: where the crawler ended up, what the
 * server said, how fast, whether it was HTTPS, how the page was fetched,
 * how much text there was, and how long the whole run took.
 *
 * `font-sans` throughout (these are readings, not chrome) in bordered
 * chips with no shadow (design-system-rules.md §15). The lock is the one
 * tinted glyph: green closed for HTTPS, red open for plain HTTP, because
 * that is the one fact here with a right answer. The mode is a badge rather
 * than a chip so "HTML only" stands out when the person expected rendering.
 */
import { Badge, cn, Skeleton } from '@postgear/ui';
import { Clock, ExternalLink, FileText, Lock, LockOpen, Timer } from 'lucide-react';
import type { SeoCrawlSummary } from '@/types/seo';
import { formatDuration } from './seo-view-model';

function Chip({
  children,
  title,
  className,
}: {
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-8 max-w-full items-center gap-1.5 rounded-md border-2 border-outline bg-secondary px-2.5 font-sans text-xs font-medium text-ink',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function CrawlFacts({
  crawl,
  durationMs,
  running,
}: {
  crawl: SeoCrawlSummary | null;
  durationMs: number | null;
  running: boolean;
}) {
  if (crawl === null) {
    return running ? <Skeleton className="h-8 w-full max-w-xl" aria-label="Crawling" /> : null;
  }

  const statusTone =
    crawl.statusCode >= 400
      ? 'text-actionDanger'
      : crawl.statusCode >= 300
        ? 'text-actionAccent'
        : 'text-actionSuccess';

  return (
    <ul className="m-0 flex list-none flex-wrap items-center gap-2 p-0" aria-label="Crawl facts">
      <li className="min-w-0 max-w-full">
        <a
          href={crawl.finalUrl}
          target="_blank"
          rel="noreferrer"
          title={crawl.finalUrl}
          className={cn(
            'inline-flex h-8 max-w-full items-center gap-1.5 rounded-md border-2 border-outline bg-secondary px-2.5 font-sans text-xs font-bold text-ink underline decoration-2 underline-offset-2',
            'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
          )}
        >
          <span className="truncate">{crawl.finalUrl}</span>
          <ExternalLink className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
        </a>
      </li>
      <li>
        <Chip title="HTTP status">
          <span className={cn('font-bold tabular-nums', statusTone)}>{crawl.statusCode}</span>
          {crawl.redirects.length > 0
            ? ` · ${crawl.redirects.length} ${crawl.redirects.length === 1 ? 'redirect' : 'redirects'}`
            : ''}
        </Chip>
      </li>
      <li>
        <Chip title="Time to first byte">
          <Timer className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
          <span className="tabular-nums">{formatDuration(crawl.responseTimeMs)}</span>
        </Chip>
      </li>
      <li>
        <Chip title={crawl.https ? 'Served over HTTPS' : 'Served over plain HTTP'}>
          {crawl.https ? (
            <Lock className="h-3.5 w-3.5 text-actionSuccess" strokeWidth={2.5} aria-hidden="true" />
          ) : (
            <LockOpen
              className="h-3.5 w-3.5 text-actionDanger"
              strokeWidth={2.5}
              aria-hidden="true"
            />
          )}
          {crawl.https ? 'HTTPS' : 'HTTP'}
          {crawl.https && crawl.certificateValid === false ? ' · bad certificate' : ''}
        </Chip>
      </li>
      <li>
        <Badge variant="outline" title="How the page was fetched">
          {crawl.mode === 'browser' ? 'Rendered' : 'HTML only'}
        </Badge>
      </li>
      <li>
        <Chip title="Words of visible text">
          <FileText className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
          <span className="tabular-nums">{crawl.text.wordCount.toLocaleString()}</span> words
        </Chip>
      </li>
      {durationMs !== null ? (
        <li>
          <Chip title="Whole analysis">
            <Clock className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
            <span className="tabular-nums">{formatDuration(durationMs)}</span>
          </Chip>
        </li>
      ) : null}
    </ul>
  );
}
