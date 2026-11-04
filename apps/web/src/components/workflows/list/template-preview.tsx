'use client';

/**
 * The card that opens beside the template list (Workflows revamp,
 * 2026-10-31): how a template will look once it is a workflow, and what it
 * will do.
 *
 * From the top: a stage in the template's own colour with its steps on it, by
 * name and in order, each with its number (the first six; the rest are
 * counted); the name, the step count and what it does; what it needs; and a
 * line saying a click starts from it. The stage is a plain colour: no
 * texture, and the steps are named, not drawn as icons alone.
 *
 * Its icons are Phosphor's duotone set, coloured by kind of step
 * (`step-glyph.tsx`); the rest of the app keeps lucide.
 *
 * It plays a short entrance for each template (GSAP): the card rises in and
 * the steps slide in one after another. A step's line down to the next is part
 * of its own row, so nothing of the flow is on screen before its row is.
 * People who ask for less motion get the finished card at once. The card is
 * keyed by template, so moving down the list plays it again for each one.
 *
 * It sits over the grid's first column and takes no pointer events, so it
 * never gets between the pointer and the page. It is for the eye: the row's
 * button carries the description for a screen reader.
 */
import { Badge, cn, gsap, useGSAP } from '@postgear/ui';
import { useRef } from 'react';
import type { TemplateWithPicture } from '@/types/workflows';
import { NeedGlyph } from './step-glyph';
import { WorkflowFlow } from './workflow-flow';
import { needNames } from './workflows-view-model';

/** A colour for each starter, so five cards in a row are told apart at a glance. */
const ACCENTS: Record<string, string> = {
  'publishing-report': 'bg-actionSuccess',
  'ai-weekly-post': 'bg-actionAi',
  'failed-post-alert': 'bg-actionDanger',
  'repurpose-for-x': 'bg-actionAccent',
  'blog-to-draft': 'bg-actionPrimary',
};
const DEFAULT_ACCENT = 'bg-actionPrimary';

/** Steps the stage names before it counts the rest. */
const STAGE_STEPS = 6;

export function TemplatePreview({
  template,
  className,
}: {
  template: TemplateWithPicture;
  className?: string;
}) {
  const card = useRef<HTMLDivElement>(null);
  const accent = ACCENTS[template.id] ?? DEFAULT_ACCENT;
  const needs = needNames(template);
  const steps = template.preview.stepCount;

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const timeline = gsap.timeline({ defaults: { ease: 'power2.out' } });
        timeline
          .fromTo(
            card.current,
            { autoAlpha: 0, y: 14, scale: 0.96 },
            { autoAlpha: 1, y: 0, scale: 1, duration: 0.28, ease: 'back.out(1.6)' },
          )
          .fromTo(
            '[data-step]',
            { autoAlpha: 0, x: -12 },
            { autoAlpha: 1, x: 0, duration: 0.26, stagger: 0.06 },
            0.1,
          );
        return () => timeline.kill();
      });
      return () => media.revert();
    },
    { dependencies: [template.id], scope: card },
  );

  return (
    <div
      ref={card}
      aria-hidden="true"
      data-testid="template-preview"
      className={cn(
        'pointer-events-none absolute start-full top-0 z-30 ms-4 w-[21rem] origin-left overflow-hidden rounded-card border-2 border-outline bg-secondary shadow-surfaceMd',
        className,
      )}
    >
      <div className={cn('border-b-2 border-outline p-4', accent)}>
        <WorkflowFlow preview={template.preview} limit={STAGE_STEPS} numbered roomy />
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-start justify-between gap-3">
            <p className="type-heading text-xl text-ink">{template.title}</p>
            <Badge variant="outline" className="mt-1 shrink-0">
              {steps} {steps === 1 ? 'Step' : 'Steps'}
            </Badge>
          </div>
          <p className="line-clamp-3 font-sans text-sm text-ink type-muted">
            {template.description}
          </p>
        </div>

        {needs.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="type-ui text-sm text-ink">Needs</span>
            {needs.map((need) => (
              <span
                key={need}
                className="inline-flex items-center gap-1.5 type-ui text-sm text-ink"
              >
                <NeedGlyph name={need} className="h-4 w-4" />
                {need}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2 border-t-2 border-outline bg-inset px-4 py-3">
        <span className="font-sans text-sm text-ink">Click to start from this template</span>
      </div>
    </div>
  );
}
