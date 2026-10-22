'use client';

/**
 * What to fix, in priority order: three groups (Critical, Warning, Info)
 * each an accordion with its count, critical open by default because that
 * is where to start.
 *
 * Violet marks what the model wrote and nothing else (design-system-rules.md
 * §16b, §16c): when `advice.source` is `ai`, the summary sits in a
 * `SpeechBubble variant="ai"` under a `Badge variant="ai"` naming the model.
 * Rule-based advice (the evaluators' findings, which no model wrote) gets
 * a plain `Text` and an `outline` badge. The recommendations themselves are
 * the same restrained rows either way: a title, the issue, the fix labelled
 * as such, an impact chip, and a "Learn more" link when the API has one.
 *
 * Each row carries `data-testid="seo-recommendation"` and `data-severity`
 * so a test can count what was prioritised, not match on colour.
 */
import { ExternalLinkIcon } from '@animateicons/react/lucide/external-link-icon';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  MotionIcon,
  Skeleton,
  SpeechBubble,
  Text,
} from '@postgear/ui';
import type { SeoAdvice, SeoImpact, SeoRecommendation, SeoSeverity } from '@/types/seo';
import { SEO_CATEGORY_LABELS, SEO_SEVERITIES } from '@/types/seo';
import { SEVERITY_LABELS, severityVariant } from './seo-view-model';

const IMPACT_LABELS: Record<SeoImpact, string> = {
  high: 'High impact',
  medium: 'Medium impact',
  low: 'Low impact',
};

const EMPTY_GROUP: Record<SeoSeverity, string> = {
  critical: 'Nothing critical: the page clears every check that blocks ranking.',
  warning: 'No warnings.',
  info: 'Nothing further to note.',
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
        <section aria-label="Recommendations" aria-busy="true" className="flex flex-col gap-3">
          <h2 className="type-label text-sm text-ink">What To Fix</h2>
          <Skeleton
            className="h-20"
            aria-label={advising ? 'Writing advice' : 'Waiting for the scores'}
          />
        </section>
      );
    }
    return null;
  }

  const groups = SEO_SEVERITIES.map((severity) => ({
    severity,
    items: advice.recommendations.filter((item) => item.severity === severity),
  }));
  const total = advice.recommendations.length;

  return (
    <section aria-label="Recommendations" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="type-label text-sm text-ink">What To Fix</h2>
        {advice.source === 'ai' ? (
          <Badge variant="ai">AI Advice{advice.model ? ` (${advice.model})` : ''}</Badge>
        ) : (
          <Badge variant="outline">Rule-based</Badge>
        )}
        <Text size="xs" muted as="span" className="ms-auto">
          {total === 0 ? 'Nothing to fix' : `${total} ${total === 1 ? 'item' : 'items'}`}
        </Text>
      </div>

      {advice.summary.trim().length > 0 ? (
        advice.source === 'ai' ? (
          <SpeechBubble variant="ai" className="whitespace-pre-wrap" aria-label="Summary">
            {advice.summary}
          </SpeechBubble>
        ) : (
          <Text size="sm" className="whitespace-pre-wrap">
            {advice.summary}
          </Text>
        )
      ) : null}

      <Accordion type="multiple" defaultValue={['critical']} className="flex flex-col gap-3">
        {groups.map(({ severity, items }) => (
          <AccordionItem key={severity} value={severity}>
            <AccordionTrigger>
              <span className="flex items-center gap-3">
                {SEVERITY_LABELS[severity]}
                <Badge
                  variant={severityVariant(severity)}
                  aria-label={`${items.length} ${severity}`}
                >
                  {items.length}
                </Badge>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              {items.length === 0 ? (
                <Text size="sm" muted>
                  {EMPTY_GROUP[severity]}
                </Text>
              ) : (
                <ul className="m-0 flex list-none flex-col divide-y-2 divide-outline p-0">
                  {items.map((item) => (
                    <RecommendationRow key={item.id} item={item} />
                  ))}
                </ul>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

function RecommendationRow({ item }: { item: SeoRecommendation }) {
  return (
    <li
      data-testid="seo-recommendation"
      data-severity={item.severity}
      data-category={item.category}
      className="flex flex-col gap-2 py-3 font-sans text-ink first:pt-1 last:pb-1"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 font-sans text-sm font-bold text-ink">{item.title}</h3>
        <Badge variant="outline">{IMPACT_LABELS[item.impact]}</Badge>
        <span className="text-xs font-medium opacity-70">{SEO_CATEGORY_LABELS[item.category]}</span>
      </div>
      <p className="m-0 text-sm">{item.issue}</p>
      <p className="m-0 text-sm">
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
    </li>
  );
}
