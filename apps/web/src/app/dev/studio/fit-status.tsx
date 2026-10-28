'use client';

/**
 * The overflow check, at the top of the playground: how many slides still
 * overflow at their smallest text size, and which (template, format, slide
 * and slot), each with a button that brings it into view.
 *
 * Slides are drawn as they scroll near, so the check covers what has been
 * drawn so far and says how far it has got. It covers every page walked so
 * far, not only the one shown: a slide's report stays in the store after its
 * page is turned. The count and the list are a `role="status"` region; the
 * progress line sits outside it, so scrolling does not make a screen reader
 * read the region again for every slide.
 */
import { LocateFixedIcon } from '@animateicons/react/lucide/locate-fixed-icon';
import type { DesignDocument } from '@postgear/design-engine';
import { Alert, AlertDescription, Button, MotionIcon } from '@postgear/ui';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { formatName } from '@/components/studio/studio-view-model';
import { BROWSER_API_URL } from '@/lib/api';
import {
  type FitStore,
  fitHeadline,
  fitProgress,
  fitReport,
  type Overflow,
  type ShownPreset,
} from './playground-model';

export function FitStatus({
  store,
  shown,
  documents,
  pageCount,
  onGoTo,
}: {
  store: FitStore;
  /** Every preset the filters show, on every page. */
  shown: readonly ShownPreset[];
  documents: ReadonlyMap<string, DesignDocument>;
  /** How many pages they take, for saying where the undrawn rest is. */
  pageCount: number;
  onGoTo: (overflow: Overflow) => void;
}) {
  const fits = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const report = useMemo(() => fitReport(shown, documents, fits), [shown, documents, fits]);
  const fontTrouble = useFontTrouble();

  if (report.total === 0) return null;

  const count = report.overflowing.length;
  const done = report.checked >= report.total;

  return (
    <div className="flex flex-col gap-3">
      {fontTrouble ? (
        <Alert variant="danger">
          <AlertDescription>
            Some template fonts did not load, so text was measured in a fallback font. They come
            from the API at {BROWSER_API_URL}: check that it is running, then reload.
          </AlertDescription>
        </Alert>
      ) : null}

      <Alert
        role="group"
        aria-label="Overflow check"
        variant={count > 0 ? 'warning' : done ? 'success' : 'default'}
        className="flex-col"
        data-testid="overflow-check"
      >
        <div role="status" className="flex w-full min-w-0 flex-col gap-3">
          <AlertDescription data-testid="overflow-headline">{fitHeadline(report)}</AlertDescription>
          {count > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {report.overflowing.map((overflow) => (
                <li
                  key={overflow.key}
                  data-testid="overflow-entry"
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5"
                >
                  <span id={`${overflow.domId}-overflow`} className="min-w-0 break-words">
                    {overflow.presetName}, {formatName(overflow.format)}, slide {overflow.slide}:{' '}
                    {overflow.slots.map((slot) => `${slot.label} (${slot.id})`).join(', ')}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-describedby={`${overflow.domId}-overflow`}
                    onClick={() => onGoTo(overflow)}
                  >
                    <MotionIcon icon={LocateFixedIcon} className="h-4 w-4" />
                    Go To Slide
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <AlertDescription data-testid="overflow-progress">
          {fitProgress(report, pageCount)}
        </AlertDescription>
      </Alert>
    </div>
  );
}

/**
 * True once a font fails to load. The slides are measured in their template
 * fonts, served by the API; without them every size the check reports is a
 * fallback font's, so the page says so rather than reporting it as fact.
 */
function useFontTrouble(): boolean {
  const [trouble, setTrouble] = useState(false);

  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;

    const failed = () => setTrouble(true);
    fonts.addEventListener('loadingerror', failed);
    return () => fonts.removeEventListener('loadingerror', failed);
  }, []);

  return trouble;
}
