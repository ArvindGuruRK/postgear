'use client';

/**
 * The breakdown: one tab per category, each its score bar over a table of
 * the checks the evaluators ran.
 *
 * This is the densest surface on the page and the one §15 of the design
 * rules was written for: a `Table` in `font-sans`, no shadow, tight rows,
 * and one glyph per row that says pass or fail — `Check` success, `X`
 * danger for a critical failure, `AlertTriangle` accent for a warning, and
 * `Info` primary for an informational one, the same severity vocabulary as
 * the recommendations (§16c). The tab strip is the chrome and keeps the
 * treatment.
 *
 * Authority is the one category that may be an estimate. When it is, the
 * tab says where the number came from and what would make it real, because
 * a score that looks measured and isn't is the one thing this screen must
 * never do.
 */
import {
  Alert,
  ScoreBar,
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
import { SEO_CATEGORIES, SEO_CATEGORY_LABELS, SEO_CATEGORY_WEIGHTS } from '@/types/seo';

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
      <section aria-label="Breakdown" aria-busy="true" className="flex flex-col gap-3">
        <h2 className="font-display text-sm uppercase tracking-wide text-ink">Breakdown</h2>
        <Skeleton className="h-11 w-full max-w-md" />
        <Skeleton className="h-40" />
      </section>
    ) : null;
  }

  const byCategory = new Map(categories.map((category) => [category.category, category]));

  return (
    <section aria-label="Breakdown" className="flex flex-col gap-3">
      <h2 className="font-display text-sm uppercase tracking-wide text-ink">Breakdown</h2>
      <Tabs defaultValue="onPage">
        <TabsList aria-label="Category" className="flex w-full flex-wrap sm:inline-flex sm:w-auto">
          {SEO_CATEGORIES.map((id) => (
            <TabsTrigger key={id} value={id} className="flex-1 sm:flex-none">
              {SEO_CATEGORY_LABELS[id]}
            </TabsTrigger>
          ))}
        </TabsList>

        {SEO_CATEGORIES.map((id) => {
          const category = byCategory.get(id);
          const weight = `${Math.round(SEO_CATEGORY_WEIGHTS[id] * 100)}% of the total`;
          return (
            <TabsContent key={id} value={id} className="flex flex-col gap-4">
              <ScoreBar
                label={SEO_CATEGORY_LABELS[id]}
                score={category ? category.score : null}
                hint={category?.estimated ? `${weight} · estimated` : weight}
              />

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
                    ? ` · PageRank ${crawl.authority.pageRank}`
                    : ''}{' '}
                  via {AUTHORITY_SOURCE[crawl.authority.source]}.
                </Text>
              ) : null}

              {category && category.checks.length > 0 ? (
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
                        <TableCell className="py-3 opacity-80">{check.detail}</TableCell>
                        <TableCell className="whitespace-nowrap py-3 text-right tabular-nums">
                          {check.value ?? '–'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Text size="sm" muted>
                  No checks were recorded for this category.
                </Text>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </section>
  );
}
