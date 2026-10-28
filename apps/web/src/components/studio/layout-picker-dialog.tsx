'use client';

/**
 * Choosing a slide layout, for Add Slide (DS-5.1) and the panel's Change
 * Layout: every layout the design's format takes, grouped Cover, Content,
 * List, Quote, Statistic and Closing CTA, each drawn as it would really look.
 *
 * - **Add** draws each layout as the new slide would be: sample words in the
 *   design's theme and brand, numbered where it will land, right after the
 *   slide on the canvas. The new slide is then shown.
 * - **Change** draws the person's own slide on each layout, so they see where
 *   their words go before choosing. Anything a layout has no room for is back
 *   with Undo.
 *
 * One click chooses and closes: nothing to confirm, since Undo takes it back.
 */
import {
  addSlide,
  type DesignDocument,
  FORMATS,
  layoutKey,
  layoutsForRole,
  slideId as newSlideId,
  SLIDE_ROLE_LABELS,
  SLIDE_ROLES,
  type SlideLayout,
  setSlideLayout,
} from '@postgear/design-engine';
import {
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  pressSm,
} from '@postgear/ui';
import { useId, useMemo } from 'react';
import { FOCUS } from './design-card';
import type { ApplyChange } from './editor-state';
import { SlideFrame } from './slide-frame';
import { INSET } from './studio-ui';
import { CHOSEN } from './wizard-steps';

/** Stands in for the new slide's id in the previews; real ids are longer. */
const PREVIEW_ID = 's-preview';

export type LayoutPickerMode =
  /** A new slide, after the one with this id. */
  | { kind: 'add'; after: string }
  /** Another layout for the slide with this id. */
  | { kind: 'change'; slideId: string };

interface Choice {
  layout: SlideLayout;
  key: string;
  /** The design as it would be with this layout, and where the slide sits in it. */
  preview: { design: DesignDocument; index: number } | null;
}

export function LayoutPickerDialog({
  document,
  mode,
  resolveMedia,
  onChange,
  onClose,
}: {
  document: DesignDocument;
  /** Null while closed. */
  mode: LayoutPickerMode | null;
  resolveMedia: (mediaId: string) => string | null;
  onChange: ApplyChange;
  onClose: () => void;
}) {
  const groupId = useId();
  const spec = FORMATS[document.format];
  // Tall slides are narrowed so their height fits the square stage.
  const width = `${Math.min(1, spec.width / spec.height) * 100}%`;

  const changing =
    mode?.kind === 'change' ? document.slides.find((slide) => slide.id === mode.slideId) : null;
  const position =
    mode?.kind === 'add'
      ? document.slides.findIndex((slide) => slide.id === mode.after) + 2
      : document.slides.findIndex((slide) => slide.id === changing?.id) + 1;

  const groups = useMemo(() => {
    if (!mode) return [];

    return SLIDE_ROLES.map((role) => ({
      role,
      choices: layoutsForRole(role, document.format).map((layout): Choice => {
        const key = layoutKey(layout);
        return { layout, key, preview: previewOf(document, mode, key) };
      }),
    })).filter((group) => group.choices.length > 0);
  }, [document, mode]);

  function choose(key: string) {
    if (!mode) return;

    if (mode.kind === 'add') {
      const id = newSlideId();
      onChange(
        (latest) => addSlide(latest, { layoutId: key, after: mode.after, newId: () => id }),
        { showSlide: id },
      );
    } else if (changing?.layoutId !== key) {
      const target = mode.slideId;
      onChange((latest) => setSlideLayout(latest, target, key));
    }
    onClose();
  }

  return (
    <Dialog open={mode !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 pe-14">
          <DialogTitle>{mode?.kind === 'change' ? 'Change Layout' : 'Add A Slide'}</DialogTitle>
          <DialogDescription>
            {mode?.kind === 'change'
              ? 'Your words and pictures move to the new layout wherever it has room for them.'
              : `It goes in as slide ${Math.max(position, 1)}, in this design's theme and brand.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pt-2 pb-6 pg-scrollbar pg-scrollbar-secondary">
          {groups.map(({ role, choices }) => (
            <section
              key={role}
              aria-labelledby={`${groupId}-${role}`}
              className="flex flex-col gap-3"
            >
              <h3 id={`${groupId}-${role}`} className="m-0 type-heading text-base text-ink">
                {SLIDE_ROLE_LABELS[role]}
              </h3>
              <ul className="m-0 grid list-none grid-cols-2 gap-4 p-0 sm:grid-cols-3 lg:grid-cols-4">
                {choices.map(({ layout, key, preview }) => {
                  const current = changing?.layoutId === key;

                  return (
                    <li key={key} className="min-w-0">
                      <button
                        type="button"
                        data-testid="layout-choice"
                        aria-label={current ? `${layout.name}, the current layout` : layout.name}
                        aria-current={current ? 'true' : undefined}
                        onClick={() => choose(key)}
                        className={cn(
                          'flex h-full w-full flex-col gap-2 rounded-card border-2 border-outline bg-secondary p-3 text-left',
                          pressSm,
                          FOCUS,
                          current && cn(CHOSEN, 'ring-offset-secondary'),
                        )}
                      >
                        <span
                          className={cn(
                            INSET,
                            'flex aspect-square items-center justify-center bg-halftone p-3',
                          )}
                        >
                          <span
                            className="block border-2 border-outline shadow-brutalSm"
                            style={{ width }}
                          >
                            {preview ? (
                              <SlideFrame
                                design={preview.design}
                                index={preview.index}
                                resolveMedia={resolveMedia}
                              />
                            ) : null}
                          </span>
                        </span>
                        <span className="truncate type-ui text-sm text-ink" title={layout.name}>
                          {layout.name}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The design with the layout applied the way choosing it would, for its picture. */
function previewOf(
  document: DesignDocument,
  mode: LayoutPickerMode,
  key: string,
): Choice['preview'] {
  if (mode.kind === 'add') {
    const design = addSlide(document, {
      layoutId: key,
      after: mode.after,
      newId: () => PREVIEW_ID,
    });
    const index = design.slides.findIndex((slide) => slide.id === PREVIEW_ID);
    return index === -1 ? null : { design, index };
  }

  const index = document.slides.findIndex((slide) => slide.id === mode.slideId);
  return index === -1 ? null : { design: setSlideLayout(document, mode.slideId, key), index };
}
