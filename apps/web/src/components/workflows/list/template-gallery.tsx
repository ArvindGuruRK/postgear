'use client';

/**
 * Start From A Template (Module 05, blueprint section 9): a row of large
 * cards, each with its apps as logo stickers in flow order, the name, one
 * sentence and what it uses. Choosing one creates a draft from it and opens
 * the builder with the Finish Setup list.
 *
 * Used on the list page and, three cards wide, under the empty canvas's Add
 * A Trigger tile, so a blank workflow is never a dead end.
 */
import { cn, pressMd, Spinner } from '@postgear/ui';
import type { TemplateSummary } from '@/types/workflows';
import { AppIcon } from '../app-icon';
import { usesText } from './workflows-view-model';

export const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

export function TemplateCard({
  template,
  onChoose,
  busy,
  disabled,
  compact = false,
}: {
  template: TemplateSummary;
  onChoose: (id: string) => void;
  busy: boolean;
  disabled: boolean;
  compact?: boolean;
}) {
  const uses = usesText(template);
  return (
    <button
      type="button"
      onClick={() => onChoose(template.id)}
      disabled={disabled}
      aria-busy={busy}
      data-testid="workflow-template"
      data-template-id={template.id}
      className={cn(
        'flex shrink-0 flex-col items-start gap-3 rounded-card border-2 border-outline bg-secondary p-4 text-left',
        pressMd,
        FOCUS,
        'disabled:cursor-not-allowed disabled:opacity-60',
        compact ? 'w-60' : 'w-72',
      )}
    >
      <span className="flex items-center gap-1.5" aria-hidden="true">
        {template.apps.map((icon, index) => (
          <span
            // Apps can repeat in a flow (two Slack steps), so the index keys them.
            // biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed per template
            key={`${icon}-${index}`}
            className="flex h-9 w-9 items-center justify-center rounded-md border-2 border-outline bg-secondary shadow-brutalSm"
          >
            <AppIcon icon={icon} className="h-4 w-4" />
          </span>
        ))}
        {busy ? <Spinner className="ms-1 h-4 w-4" /> : null}
      </span>
      <span className="type-heading text-lg text-ink">{template.title}</span>
      {compact ? null : (
        <span className="font-sans text-sm text-ink type-muted">{template.description}</span>
      )}
      {uses ? <span className="type-label text-xs text-ink">{uses}</span> : null}
    </button>
  );
}

export function TemplateGallery({
  templates,
  onChoose,
  busyId,
  compact = false,
  limit,
}: {
  templates: readonly TemplateSummary[];
  onChoose: (id: string) => void;
  /** The template being created right now, if any. */
  busyId: string | null;
  compact?: boolean;
  limit?: number;
}) {
  const shown = limit ? templates.slice(0, limit) : templates;
  if (shown.length === 0) return null;
  return (
    <section aria-labelledby="workflow-templates" className="flex min-w-0 flex-col gap-3">
      <h2 id="workflow-templates" className="type-heading text-lg text-ink">
        {compact ? 'Or Start From A Template' : 'Start From A Template'}
      </h2>
      <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pt-1 pb-3">
        {shown.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onChoose={onChoose}
            busy={busyId === template.id}
            disabled={busyId !== null}
            compact={compact}
          />
        ))}
      </div>
    </section>
  );
}
