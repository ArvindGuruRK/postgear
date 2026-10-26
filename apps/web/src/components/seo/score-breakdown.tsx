'use client';

/**
 * The breakdown (revamped 2026-10-23): every check the analyzer ran, one
 * category at a time behind a segmented switch that carries each score.
 *
 * The densest surface on the page and the one section 15 of the design rules
 * was written for: a `Table` on the light layer, no shadow, tight rows, and
 * one glyph per row that says pass or fail; `Check` success, `X` danger for
 * a critical failure, `AlertTriangle` accent for a warning, and `Info`
 * primary for an informational one, the same severity vocabulary as the
 * fixes (section 16c).
 *
 * Authority is the one category that may be an estimate. When it is, the tab
 * says where the number came from and what would make it real, because a
 * score that looks measured and isn't is the one thing this screen must
 * never do.
 */
import {
  Alert,
  cn,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
} from '@postgear/ui';
import { AlertTriangle, Check, Info, X } from 'lucide-react';
import type { SeoCategoryScore, SeoCheck, SeoCrawlSummary } from '@/types/seo';
import { SEO_CATEGORIES, SEO_CATEGORY_LABELS } from '@/types/seo';
import {
  CATEGORY_META,
  INSET,
  PanelHeader,
  SEGMENTED_LIST,
  SEGMENTED_TRIGGER,
  SeoPanel,
} from './seo-ui';

const AUTHORITY_SOURCE: Record<NonNullable<SeoCrawlSummary['authority']>['source'], string> = {
  openpagerank: 'Open PageRank',
  heuristic: 'on-page signals',
  simulation: 'a local stand-in (AI_SIMULATION)',
};

function CheckGlyph({ check }: { check: SeoCheck }) {
  if (check.passed) {
    return <Check className="h-4 w-4 text-actionSuccess" strokeWidth={3} aria-label="Passed" />;
  }
  switch (check.severity) {
    case 'critical':
      return <X className="h-4 w-4 text-actionDanger" strokeWidth={3} aria-label="Failed" />;
    case 'warning':
      return (
        <AlertTriangle className="h-4 w-4 text-actionAccent" strokeWidth={3} aria-label="Warning" />
      );
    default:
      return <Info className="h-4 w-4 text-actionPrimary" strokeWidth={3} aria-label="Note" />;
  }
}

export function ScoreBreakdown({
  categories,
  crawl,
  running,
}: {
  categories: SeoCategoryScore[] | null;
  crawl: SeoCrawlSummary | null;
  running: boolean;
}) {
  if (categories === null) {
    return running ? (
      <SeoPanel className="flex flex-col gap-4 p-4 sm:p-5" aria-label="Breakdown" aria-busy="true">
        <PanelHeader id="seo-breakdown" title="Breakdown" />
        <Skeleton className="h-10 w-full max-w-lg" />
        <Skeleton className="h-48" />
      </SeoPanel>
    ) : null;
  }

  const byCategory = new Map(categories.map((category) => [category.category, category]));
  const passed = categories.reduce(
    (sum, category) => sum + category.checks.filter((check) => check.passed).length,
    0,
  );
  const checks = categories.reduce((sum, category) => sum + category.checks.length, 0);

  return (
    <SeoPanel className="flex flex-col gap-4 p-4 sm:p-5" aria-labelledby="seo-breakdown">
      <PanelHeader
        id="seo-breakdown"
        title="Breakdown"
        sub={
          <span className="font-sans text-sm text-ink type-muted">
            {passed} of {checks} checks passed.
          </span>
        }
      />

      <Tabs defaultValue="onPage">
        <TabsList
          aria-label="Category"
          className={cn(
            SEGMENTED_LIST,
            'flex w-full max-w-full overflow-x-auto pg-scrollbar pg-scrollbar-primary sm:inline-flex sm:w-auto',
          )}
        >
          {SEO_CATEGORIES.map((id) => {
            const category = byCategory.get(id);
            const { icon: Icon } = CATEGORY_META[id];
            return (
              <TabsTrigger
                key={id}
                value={id}
                className={cn(SEGMENTED_TRIGGER, 'flex-1 gap-2 whitespace-nowrap sm:flex-none')}
              >
                <Icon className="hidden h-4 w-4 sm:block" strokeWidth={2.5} aria-hidden="true" />
                {SEO_CATEGORY_LABELS[id]}
                {category ? (
                  <span className="font-sans text-xs font-bold tabular-nums muted-tone">
                    {Math.round(category.score)}
                  </span>
                ) : null}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {SEO_CATEGORIES.map((id) => {
          const category = byCategory.get(id);
          return (
            <TabsContent key={id} value={id} className="mt-4 flex flex-col gap-3">
              <p className="m-0 font-sans text-sm text-ink type-muted">
                {CATEGORY_META[id].covers}
              </p>

              {id === 'backlink' && category?.estimated ? (
                <Alert>
                  <Text size="sm" as="span">
                    Authority is estimated from{' '}
                    {AUTHORITY_SOURCE[crawl?.authority?.source ?? 'heuristic']}, not a backlink
                    index. Set <code className="font-bold">OPEN_PAGERANK_API_KEY</code> on the API
                    to connect Open PageRank for a measured domain score.
                  </Text>
                </Alert>
              ) : null}

              {id === 'backlink' && crawl?.authority && !category?.estimated ? (
                <Text size="xs" muted>
                  Domain authority {crawl.authority.domainAuthority ?? '–'}
                  {crawl.authority.pageRank !== null
                    ? `, PageRank ${crawl.authority.pageRank}`
                    : ''}{' '}
                  via {AUTHORITY_SOURCE[crawl.authority.source]}.
                </Text>
              ) : null}

              {category && category.checks.length > 0 ? (
                <div className={cn(INSET, 'overflow-hidden [&_table]:border-0')}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <span className="sr-only">Result</span>
                        </TableHead>
                        <TableHead>Check</TableHead>
                        <TableHead>Detail</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {category.checks.map((check) => (
                        <TableRow
                          key={check.id}
                          data-testid="seo-check"
                          data-check={check.id}
                          data-passed={check.passed}
                        >
                          <TableCell className="py-3">
                            <CheckGlyph check={check} />
                          </TableCell>
                          <TableCell className="py-3 font-bold">{check.label}</TableCell>
                          <TableCell className="py-3 type-muted">{check.detail}</TableCell>
                          <TableCell className="whitespace-nowrap py-3 text-right tabular-nums">
                            {check.value ?? '–'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className={cn(INSET, 'm-0 p-4 font-sans text-sm text-ink type-muted')}>
                  No checks were recorded for this category.
                </p>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </SeoPanel>
  );
}
