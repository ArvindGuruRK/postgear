'use client';

/**
 * Pieces the SEO page's sections share (revamp, 2026-10-23).
 *
 * The page follows Analytics: every section is a frame-colour panel
 * (`AnalyticsPanel`) with a Title Case name, and what you read inside it
 * (category cards, recommendation rows, the checks table, history rows)
 * sits on the light card layer. The category list below is what the empty
 * state, the score cards and the breakdown tabs all draw from, so the four
 * names, icons and blurbs never drift apart.
 */
import { cn } from '@postgear/ui';
import { FileText, Gauge, type LucideIcon, ShieldCheck, Tags } from 'lucide-react';
import type { SeoCategory } from '@/types/seo';

export {
  AnalyticsPanel as SeoPanel,
  PanelHeader,
  SEGMENTED_LIST,
  SEGMENTED_TRIGGER,
} from '../analytics/analytics-ui';

/** What each score covers, in the words of its checks (`packages/seo-engine`). */
export const CATEGORY_META: Record<SeoCategory, { icon: LucideIcon; covers: string }> = {
  onPage: {
    icon: Tags,
    covers: 'Title, meta description, headings, image alt text and social tags.',
  },
  technical: {
    icon: Gauge,
    covers: 'HTTPS, speed, mobile viewport, robots.txt, sitemap and broken links.',
  },
  content: {
    icon: FileText,
    covers: 'Length, readability, keyword focus, headings and internal links.',
  },
  backlink: {
    icon: ShieldCheck,
    covers: 'Domain authority and the trust signals around it.',
  },
};

/** A box set into its panel (the inset layer), for what you read. */
export const INSET = 'rounded-lg border-2 border-outline bg-inset';

/** "Thu 22 Oct, 09:15" in the viewer's locale: a run's moment. */
export function formatRunMoment(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "22 Oct": an axis tick. */
export function formatRunDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** A small reading on the light layer: "200", "640 ms", "HTTPS". */
export function FactChip({
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
