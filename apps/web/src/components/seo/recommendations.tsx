'use client';

/**
 * What to fix (revamped 2026-10-23): one panel, the three severities as a
 * segmented switch with their counts, and each fix as a light row.
 *
 * The switch opens on the most severe group that has anything in it, so
 * the first thing on screen is always the next thing to do. Each row leads
 * with a round severity sticker (red cross, orange triangle, blue "i", the
 * same vocabulary as the breakdown's checks), then the title, its impact and
 * category, the issue, and the fix in a box of its own, because the fix is
 * what the person came for.
 *
 * Violet marks what the model wrote and nothing else (design-system-rules.md
 * sections 16b and 16c): AI advice gets a violet badge and its summary a
 * violet speech bubble; rule-based advice gets an outline badge and plain
 * text.
 *
 * Each row carries `data-testid="seo-recommendation"` and `data-severity`
 * so a test can count what was prioritised, not match on colour.
 */
import { ExternalLinkIcon } from '@animateicons/react/lucide/external-link-icon';
import {
  Badge,
  cn,
  MotionIcon,
  Skeleton,
  SpeechBubble,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@postgear/ui';
import { AlertTriangle, Info, X } from 'lucide-react';
import type { SeoAdvice, SeoImpact, SeoRecommendation, SeoSeverity } from '@/types/seo';
import { SEO_CATEGORY_LABELS, SEO_SEVERITIES } from '@/types/seo';
import { INSET, PanelHeader, SEGMENTED_LIST, SEGMENTED_TRIGGER, SeoPanel } from './seo-ui';
import { SEVERITY_LABELS, severityVariant } from './seo-view-model';

const IMPACT_LABELS: Record<SeoImpact, string> = {
  high: 'High Impact',
  medium: 'Medium Impact',
  low: 'Low Impact',
};

const EMPTY_GROUP: Record<SeoSeverity, string> = {
  critical: 'Nothing critical: the page clears every check that blocks ranking.',
  warning: 'No warnings.',
  info: 'Nothing further to note.',
};

const STICKER: Record<SeoSeverity, { icon: typeof X; fill: string }> = {
  critical: { icon: X, fill: 'bg-actionDanger text-onActionLight' },
  warning: { icon: AlertTriangle, fill: 'bg-actionAccent text-onActionLight' },
  info: { icon: Info, fill: 'bg-actionPrimary text-onActionPrimary' },
};

export function Recommendations({
  advice,
  running,
  advising,
}: {
  advice: SeoAdvice | null;
  running: boolean;
  /** The advise stage is the one in progress. */
  advising: boolean;
}) {
  if (advice === null) {
    if (running) {
      return (
        <SeoPanel
          className="flex flex-col gap-4 p-4 sm:p-5"
          aria-label="Recommendations"
          aria-busy="true"
        >
          <PanelHeader id="seo-fixes" title="What To Fix" />
          <Skeleton
            className="h-24"
            aria-label={advising ? 'Writing advice' : 'Waiting for the scores'}
          />
        </SeoPanel>
      );
    }
    return null;
  }

  const groups = SEO_SEVERITIES.map((severity) => ({
    severity,
    items: advice.recommendations.filter((item) => item.severity === severity),
  }));
  const total = advice.recommendations.length;
  const opening = groups.find((group) => group.items.length > 0)?.severity ?? 'critical';

  return (
    <SeoPanel className="flex flex-col gap-4 p-4 sm:p-5" aria-labelledby="seo-fixes">
      <PanelHeader
        id="seo-fixes"
        title="What To Fix"
        sub={
          <span className="font-sans text-sm text-ink type-muted">
            {total === 0
              ? 'Nothing to fix on this page.'
              : `${total} ${total === 1 ? 'fix' : 'fixes'}, most severe first.`}
          </span>
        }
        aside={
          advice.source === 'ai' ? (
            <Badge variant="ai">AI Advice{advice.model ? ` (${advice.model})` : ''}</Badge>
          ) : (
            <Badge variant="outline">Rule-Based</Badge>
          )
        }
      />

      {advice.summary.trim().length > 0 ? (
        advice.source === 'ai' ? (
          <SpeechBubble variant="ai" className="whitespace-pre-wrap" aria-label="Summary">
            {advice.summary}
          </SpeechBubble>
        ) : (
          <p className="m-0 whitespace-pre-wrap font-sans text-sm text-ink">{advice.summary}</p>
        )
      ) : null}

      {/* Keyed by the audit's first fix, so a new audit opens on its own most severe group. */}
      <Tabs key={advice.recommendations[0]?.id ?? 'none'} defaultValue={opening}>
        <TabsList
          aria-label="Severity"
          className={cn(SEGMENTED_LIST, 'flex w-full sm:inline-flex sm:w-auto')}
        >
          {groups.map(({ severity, items }) => (
            <TabsTrigger
              key={severity}
              value={severity}
              className={cn(SEGMENTED_TRIGGER, 'flex-1 gap-2 sm:flex-none')}
            >
              {SEVERITY_LABELS[severity]}
              <SeverityCount severity={severity} count={items.length} />
            </TabsTrigger>
          ))}
        </TabsList>

        {groups.map(({ severity, items }) => (
          <TabsContent key={severity} value={severity} className="mt-4">
            {items.length === 0 ? (
              <p className={cn(INSET, 'm-0 p-4 font-sans text-sm text-ink type-muted')}>
                {EMPTY_GROUP[severity]}
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {items.map((item) => (
                  <RecommendationRow key={item.id} item={item} />
                ))}
              </ul>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </SeoPanel>
  );
}

/** A group's count in its own colour; an empty group is an outline, so 0 never looks alarming. */
function SeverityCount({ severity, count }: { severity: SeoSeverity; count: number }) {
  return (
    <>
      <Badge
        aria-hidden="true"
        variant={count === 0 ? 'outline' : severityVariant(severity)}
        className="min-w-6 justify-center px-1.5 py-0.5 leading-none tabular-nums"
      >
        {count}
      </Badge>
      <span className="sr-only">
        {count} {count === 1 ? 'fix' : 'fixes'}
      </span>
    </>
  );
}

function RecommendationRow({ item }: { item: SeoRecommendation }) {
  const { icon: Icon, fill } = STICKER[item.severity];

  return (
    <li
      data-testid="seo-recommendation"
      data-severity={item.severity}
      data-category={item.category}
      className={cn(INSET, 'flex gap-3 p-4 font-sans text-ink')}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-outline bg-clip-padding',
          fill,
        )}
      >
        <Icon className="h-4 w-4" strokeWidth={3} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="m-0 font-sans text-base font-bold text-ink">{item.title}</h3>
          <Badge variant="outline">{IMPACT_LABELS[item.impact]}</Badge>
          <span className="text-xs type-muted">{SEO_CATEGORY_LABELS[item.category]}</span>
        </div>
        <p className="m-0 text-sm">{item.issue}</p>
        <p className="m-0 rounded-md border-2 border-dashed border-outline px-3 py-2 text-sm">
          <span className="font-bold">Fix: </span>
          {item.fix}
        </p>
        {item.docsUrl ? (
          <a
            href={item.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1.5 text-xs font-bold text-ink underline decoration-2 underline-offset-2 outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
          >
            Learn more<span className="sr-only"> about {item.title}</span>
            <MotionIcon icon={ExternalLinkIcon} size={14} className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
    </li>
  );
}
