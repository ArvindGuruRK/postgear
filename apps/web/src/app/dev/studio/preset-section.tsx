'use client';

/**
 * One template in the playground: its name and what it is made of, then
 * every format it is shown in, each slide numbered and drawn by the real
 * renderer (`SlideFrame`) once it scrolls near.
 *
 * Every slide reports its fit to the page's store and reads its own entry
 * back, so a slide that overflows is marked on the slide itself as well as in
 * the list at the top, and a report re-renders only that slide.
 */
import {
  CATEGORY_LABELS,
  type DesignDocument,
  FORMATS,
  type FormatId,
  type Preset,
  presetFormats,
  type SlotId,
  themeById,
} from '@postgear/design-engine';
import { cn } from '@postgear/ui';
import { TriangleAlert } from 'lucide-react';
import { memo, type ReactNode, useCallback, useSyncExternalStore } from 'react';
import { SlideFrame } from '@/components/studio/slide-frame';
import { PanelHeader, StudioPanel } from '@/components/studio/studio-ui';
import { formatName, STYLE_LABELS } from '@/components/studio/studio-view-model';
import { documentKey, type FitStore, slideDomId, slideKey, slotNames } from './playground-model';

/**
 * A slide's width per format: two to a row on a phone (three stories, one
 * landscape), a fixed thumbnail from `sm`, sized so the four shapes carry
 * about the same weight.
 */
const CELL: Record<FormatId, string> = {
  square: 'w-[calc(50%-0.375rem)] sm:w-44',
  portrait: 'w-[calc(50%-0.375rem)] sm:w-40',
  story: 'w-[calc((100%-1.5rem)/3)] sm:w-32',
  landscape: 'w-full sm:w-72',
};

/** The slide Go To Slide brought into view. */
const TARGET = 'outline-solid outline-[3px] outline-offset-4 outline-focusRing';

export const PresetSection = memo(function PresetSection({
  preset,
  formats,
  documents,
  store,
  target,
}: {
  preset: Preset;
  /** The formats the filters show, in order. */
  formats: readonly FormatId[];
  documents: ReadonlyMap<string, DesignDocument>;
  store: FitStore;
  /** The key of the slide Go To Slide last brought into view. */
  target: string | null;
}) {
  const theme = themeById(preset.themeId);
  const headingId = `preset-${preset.id}`;

  return (
    <StudioPanel className="flex flex-col gap-5 p-4 sm:p-5" data-testid="preset">
      <PanelHeader
        id={headingId}
        title={preset.name}
        sub={
          <dl className="m-0 flex flex-wrap gap-x-5 gap-y-1 font-sans text-xs text-ink">
            <Fact term="Category">{CATEGORY_LABELS[preset.category]}</Fact>
            <Fact term="Theme">{theme.name}</Fact>
            <Fact term="Style">{STYLE_LABELS[theme.style]}</Fact>
            <Fact term="Formats">
              {presetFormats(preset)
                .map((format) => FORMATS[format].label)
                .join(', ')}
            </Fact>
            <Fact term="Id">
              <code className="break-all">{preset.id}</code>
            </Fact>
          </dl>
        }
      />

      {formats.map((format) => {
        const design = documents.get(documentKey(preset.id, format));
        if (!design) return null;

        return (
          <div key={format} className="flex flex-col gap-2">
            <h3 className="m-0 type-heading text-base text-ink">{formatName(format)}</h3>
            <ol className="m-0 flex list-none flex-wrap items-start gap-3 p-0">
              {design.slides.map((slide, index) => {
                const key = slideKey(preset.id, format, index);

                return (
                  <SlideCell
                    key={slide.id}
                    design={design}
                    index={index}
                    cellKey={key}
                    domId={slideDomId(preset.id, format, index)}
                    label={`${preset.name}, ${FORMATS[format].label}, slide ${index + 1}`}
                    store={store}
                    targeted={target === key}
                  />
                );
              })}
            </ol>
          </div>
        );
      })}
    </StudioPanel>
  );
});

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-1.5">
      <dt className="text-ink type-muted">{term}</dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </div>
  );
}

const SlideCell = memo(function SlideCell({
  design,
  index,
  cellKey,
  domId,
  label,
  store,
  targeted,
}: {
  design: DesignDocument;
  index: number;
  cellKey: string;
  domId: string;
  label: string;
  store: FitStore;
  targeted: boolean;
}) {
  const slots = useSyncExternalStore(
    store.subscribe,
    () => store.snapshot().get(cellKey),
    () => undefined,
  );
  const onFit = useCallback(
    (overflowing: SlotId[]) => store.report(cellKey, overflowing),
    [store, cellKey],
  );
  const overflowing = slots && slots.length > 0 ? slotNames(design, index, slots) : [];

  return (
    // Focusable from script only: Go To Slide moves the focus here.
    <li
      id={domId}
      tabIndex={-1}
      data-testid="playground-slide"
      data-overflow={overflowing.length > 0 ? 'true' : undefined}
      className={cn(
        'flex shrink-0 flex-col gap-1.5 outline-none',
        CELL[design.format],
        targeted && TARGET,
      )}
    >
      <div
        className={cn(
          'border-2 bg-inset',
          overflowing.length > 0 ? 'border-actionAccent' : 'border-outline',
        )}
      >
        <SlideFrame design={design} index={index} lazy label={label} onFit={onFit} />
      </div>
      <p className="m-0 flex flex-wrap items-center gap-x-1.5 font-sans text-xs text-ink">
        {overflowing.length > 0 ? (
          <TriangleAlert
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 text-accentInk"
            strokeWidth={2.5}
          />
        ) : null}
        <span className="font-bold">Slide {index + 1}</span>
        {overflowing.length > 0 ? (
          <span className="min-w-0 break-words text-accentInk">
            overflows: {overflowing.map((slot) => slot.label).join(', ')}
          </span>
        ) : null}
      </p>
    </li>
  );
});
