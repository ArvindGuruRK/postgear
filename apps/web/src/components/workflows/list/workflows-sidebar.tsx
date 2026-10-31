'use client';

/**
 * The Workflows page's left card (Workflows revamp, 2026-10-31), laid out as
 * the calendar's channel card: one framed card beside the main sidebar, the
 * page's two ways to start at the top (Create Workflow, then Connections as
 * the neutral tile) and under them the starter templates, one row each.
 *
 * A template is its title alone: no icons, no description on the row. Resting
 * the pointer or the keyboard on one opens a preview card beside the frame
 * (`template-preview.tsx`): the flow drawn as it will land on the canvas, what
 * it does and what it needs. Choosing one opens the builder with its Finish
 * Setup list, as before. Everything else on the page (the status filter and
 * the workflows) sits beside this card on the page ground.
 *
 * The frame clips its corners (`overflow-hidden`), so the preview is a sibling
 * of it, not inside. The page keeps the whole thing in view with
 * `position: sticky` (see `use-release-distance.ts`).
 */
import { PlugIcon } from '@animateicons/react/lucide/plug-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import {
  cn,
  fillHoverNeutral,
  fillHoverNeutralLayer,
  MotionIcon,
  pressSm,
  Spinner,
  useFillHover,
} from '@postgear/ui';
import { type Ref, useEffect, useRef, useState } from 'react';
import type { TemplateWithPicture } from '@/types/workflows';
import { TemplatePreview } from './template-preview';
import { FOCUS } from './template-gallery';

/** The pressable tile both buttons share, as in the calendar's card. */
const TILE = cn(
  'flex h-11 w-full items-center justify-center gap-2 rounded-lg border-2 border-outline px-3 type-ui text-sm',
  pressSm,
  'disabled:opacity-50',
  FOCUS,
);

/** Moving from one row to the next takes a moment; the preview waits so it does not flicker shut. */
const CLOSE_DELAY_MS = 90;

export function WorkflowsSidebar({
  templates,
  creating,
  onCreate,
  onChooseTemplate,
  onOpenConnections,
  ref,
  className,
}: {
  templates: readonly TemplateWithPicture[];
  /** `'blank'`, a template id, or null when nothing is being created. */
  creating: string | null;
  onCreate: () => void;
  onChooseTemplate: (id: string) => void;
  onOpenConnections: () => void;
  /** The page measures this to know how far to let the card go (`use-release-distance.ts`). */
  ref?: Ref<HTMLDivElement>;
  className?: string;
}) {
  const connectionsFill = useFillHover({});
  const [previewId, setPreviewId] = useState<string | null>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewed = templates.find((template) => template.id === previewId) ?? null;

  useEffect(
    () => () => {
      if (closing.current) clearTimeout(closing.current);
    },
    [],
  );

  function openPreview(id: string) {
    if (closing.current) clearTimeout(closing.current);
    setPreviewId(id);
  }

  function closePreview() {
    if (closing.current) clearTimeout(closing.current);
    closing.current = setTimeout(() => setPreviewId(null), CLOSE_DELAY_MS);
  }

  return (
    <div ref={ref} className={cn('relative', className)}>
      <aside
        aria-label="Start A Workflow"
        className="flex w-[16.25rem] flex-col overflow-hidden rounded-2xl border-2 border-outline bg-chrome shadow-surfaceMd"
      >
        <div className="flex flex-col gap-5 p-5">
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onCreate}
              disabled={creating !== null}
              data-testid="workflow-create"
              className={cn(TILE, 'bg-actionPrimary text-onActionPrimary')}
            >
              <MotionIcon icon={PlusIcon} className="h-4 w-4 shrink-0" />
              <span className="truncate">
                {creating === 'blank' ? 'Creating...' : 'Create Workflow'}
              </span>
            </button>
            <button
              ref={connectionsFill.rootRef}
              type="button"
              onClick={onOpenConnections}
              data-testid="workflow-connections"
              className={cn(TILE, fillHoverNeutral)}
            >
              <span ref={connectionsFill.fillRef} aria-hidden className={fillHoverNeutralLayer} />
              <MotionIcon icon={PlugIcon} className="h-4 w-4 shrink-0" />
              <span className="truncate">Connections</span>
            </button>
          </div>

          <section aria-labelledby="workflow-templates" className="flex min-w-0 flex-col gap-2">
            <h2 id="workflow-templates" className="type-heading text-lg text-ink">
              Templates
            </h2>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {templates.map((template) => {
                const busy = creating === template.id;
                return (
                  <li
                    key={template.id}
                    className="group/row relative"
                    onMouseEnter={() => openPreview(template.id)}
                    onMouseLeave={closePreview}
                    onFocus={() => openPreview(template.id)}
                    onBlur={closePreview}
                  >
                    {/* The calendar's hover marker on the card's edge. */}
                    <span
                      aria-hidden="true"
                      className="absolute -start-5 top-1 bottom-1 w-1 rounded-e-full bg-actionPrimary opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100"
                    />
                    <button
                      type="button"
                      onClick={() => onChooseTemplate(template.id)}
                      disabled={creating !== null}
                      aria-busy={busy}
                      data-testid="workflow-template"
                      data-template-id={template.id}
                      className={cn(
                        'flex w-full min-w-0 items-center gap-2 rounded-lg border-2 border-transparent px-3 py-2.5 text-start',
                        'type-ui text-sm text-ink hover:bg-primary disabled:cursor-not-allowed disabled:opacity-60',
                        FOCUS,
                      )}
                    >
                      <span className="min-w-0 flex-1 break-words">{template.title}</span>
                      {busy ? <Spinner className="h-4 w-4 shrink-0" /> : null}
                      {/* The preview is for the eye; this is what a screen reader hears. */}
                      <span className="sr-only">{template.description}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </aside>

      {previewed ? <TemplatePreview template={previewed} /> : null}
    </div>
  );
}
