'use client';

/**
 * What the page shows before any audit is open (2026-10-23): the four scores
 * an analysis returns, each with what it checks and its share of the total,
 * in the cards' own shape with the numbers still blank.
 *
 * It replaced a dashed "your audit will appear here" box, which said where
 * the result would go but not what it would be. This says both: a person
 * sees the result's frame before spending anything, and the blanks fill the
 * moment they press Analyze.
 */
import { cn } from '@postgear/ui';
import { SEO_CATEGORIES, SEO_CATEGORY_LABELS, SEO_CATEGORY_WEIGHTS } from '@/types/seo';
import { CATEGORY_META, INSET, PanelHeader, SeoPanel } from './seo-ui';

export function AuditPreview() {
  return (
    <SeoPanel className="flex flex-col gap-4 p-4 sm:p-5" aria-labelledby="seo-preview">
      <PanelHeader
        id="seo-preview"
        title="Four Scores For Any Page"
        sub={
          <span className="font-sans text-sm text-ink type-muted">
            Enter an address above. The crawl, the scores and the fixes arrive stage by stage, in
            about half a minute for most sites.
          </span>
        }
      />

      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
        {SEO_CATEGORIES.map((category) => {
          const { icon: Icon, covers } = CATEGORY_META[category];
          return (
            <li key={category} className={cn(INSET, 'flex flex-col gap-3 p-4')}>
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-sans text-sm font-bold text-ink">
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
                  {SEO_CATEGORY_LABELS[category]}
                </span>
                <span className="font-sans text-xs text-ink type-muted">
                  {Math.round(SEO_CATEGORY_WEIGHTS[category] * 100)}% of total
                </span>
              </span>
              <span aria-hidden="true" className="flex items-baseline gap-1">
                <span className="type-heading text-4xl leading-none text-ink muted-tone">–</span>
                <span className="font-sans text-sm text-ink type-muted">/100</span>
              </span>
              <span className="font-sans text-sm text-ink">{covers}</span>
            </li>
          );
        })}
      </ul>
    </SeoPanel>
  );
}
