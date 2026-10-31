'use client';

/**
 * Templates (Module 05, blueprint section 9): a grid of cards, each with its
 * first apps as a stack of logo stickers, the name, one sentence and what it
 * needs. Choosing one creates a draft from it and opens the builder with the
 * Finish Setup list.
 *
 * Used on the list page and, three cards wide, under the empty canvas's Add
 * A Trigger tile, so a blank workflow is never a dead end.
 *
 * The stickers overlap and carry no shadow of their own (2026-10-31): six
 * bordered tiles with six hard shadows in a row read as clutter, and a
 * template with a long flow ran out of its card. The stack shows four and
 * counts the rest.
 */
import { cn, pressSm, Spinner } from '@postgear/ui';
import type { TemplateSummary } from '@/types/workflows';
import { AppIcon } from '../app-icon';
import { usesText } from './workflows-view-model';

export const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

/** Logo stickers a card's stack shows before it counts the rest. */
const STACK_LIMIT = 4;

const STICKER =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-secondary';

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
  const shown = template.apps.slice(0, STACK_LIMIT);
  const rest = template.apps.length - shown.length;
  return (
    <button
      type="button"
      onClick={() => onChoose(template.id)}
      disabled={disabled}
      aria-busy={busy}
      data-testid="workflow-template"
      data-template-id={template.id}
      className={cn(
        'flex min-w-0 flex-col items-start gap-3 rounded-card border-2 border-outline bg-chrome p-4 text-left',
        pressSm,
        FOCUS,
        'disabled:cursor-not-allowed disabled:opacity-60',
      )}
    >
      <span className="flex items-center" aria-hidden="true">
        <span className="flex -space-x-1">
          {shown.map((icon, index) => (
            <span
              // Apps can repeat in a flow (two Slack steps), so the index keys them.
              // biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed per template
              key={`${icon}-${index}`}
              className={STICKER}
            >
              <AppIcon icon={icon} className="h-4 w-4" />
            </span>
          ))}
          {rest > 0 ? (
            <span className={cn(STICKER, 'type-ui text-xs text-ink')}>+{rest}</span>
          ) : null}
        </span>
        {busy ? <Spinner className="ms-2 h-4 w-4" /> : null}
      </span>
      <span className="type-heading text-lg text-ink">{template.title}</span>
      {compact ? null : (
        <span className="line-clamp-2 font-sans text-sm text-ink type-muted">
          {template.description}
        </span>
      )}
      {uses ? <span className="mt-auto type-ui text-xs text-ink">{uses}</span> : null}
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
        Templates
      </h2>
      <div className="grid grid-cols-3 gap-4 pb-1 2xl:grid-cols-5">
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
