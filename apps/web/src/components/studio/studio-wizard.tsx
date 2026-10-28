'use client';

/**
 * Create Design (DS-2.4, DS-3.1 to DS-3.5): Brand, Format and Template.
 *
 * Every answer lives in the URL, so the browser's Back, a refresh and a link
 * shared mid-way all land on the same step with the same choices. Each step
 * before the editor can be skipped or comes with a default (rule 1): Skip
 * For Now keeps the templates' own colours, the format last used is chosen
 * already, and a template picked on the Studio page leads the gallery.
 */
import { OnboardingStepper, PageActions } from '@postgear/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { ActionLink } from '@/components/home/home-actions';
import type { BrandKitView } from '@/types/studio';
import { StudioPanel } from './studio-ui';
import { parseWizard, WIZARD_STEPS, type WizardState, wizardQuery } from './studio-view-model';
import { TemplateGallery } from './template-gallery';
import { useBrandKits, useFavourites } from './use-studio-data';
import { BrandStep, FormatStep } from './wizard-steps';

const STEPS = [{ label: 'Brand' }, { label: 'Format' }, { label: 'Template' }];

export function StudioWizard({
  orgId,
  initialKits,
  initialFavourites,
}: {
  orgId: string;
  initialKits: BrandKitView[] | null;
  initialFavourites: string[] | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const state = parseWizard(Object.fromEntries(params.entries()));
  const kits = useBrandKits(initialKits);
  const favourites = useFavourites(initialFavourites);
  const heading = useRef<HTMLHeadingElement>(null);
  const opened = useRef(false);

  // A step that opens takes focus to its name, so keyboard and screen reader
  // users start there; the first one leaves focus where the page put it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the step is what this runs on, not something it reads
  useEffect(() => {
    if (!opened.current) {
      opened.current = true;
      return;
    }
    heading.current?.focus();
  }, [state.step]);

  const kit = state.kitId ? (kits.kits?.find((entry) => entry.id === state.kitId) ?? null) : null;
  // A kit the list no longer has (deleted since the link was made) is
  // dropped. While the list is unknown, the API decides.
  const brandKitId = state.kitId && (kits.kits === null || kit) ? state.kitId : null;

  function go(next: Partial<WizardState>) {
    router.push(`${pathname}?${wizardQuery({ ...state, ...next })}`, { scroll: false });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageActions>
        <ActionLink href={`/${orgId}/studio`}>Cancel</ActionLink>
      </PageActions>

      <StudioPanel className="flex flex-col gap-6 p-4 sm:p-6">
        <OnboardingStepper
          steps={STEPS}
          currentStep={WIZARD_STEPS.indexOf(state.step) + 1}
          aria-label="Create design steps"
          className="mx-auto max-w-lg"
        />

        {state.step === 'brand' ? (
          <BrandStep
            headingRef={heading}
            kits={kits.kits}
            error={kits.error}
            onRetry={kits.reload}
            chosenId={state.kitId}
            presetId={state.presetId}
            onChoose={(chosen) => go({ step: 'format', kitId: chosen.id })}
            onSkip={() => go({ step: 'format', kitId: null })}
            onKitSaved={(saved) => {
              kits.upsert(saved);
              go({ step: 'format', kitId: saved.id });
            }}
          />
        ) : state.step === 'format' ? (
          <FormatStep
            headingRef={heading}
            kit={kit}
            presetId={state.presetId}
            chosen={state.format}
            onChoose={(format) => go({ step: 'template', format })}
            onBack={() => go({ step: 'brand' })}
          />
        ) : state.format ? (
          <TemplateGallery
            headingRef={heading}
            orgId={orgId}
            format={state.format}
            kit={kit}
            brandKitId={brandKitId}
            presetId={state.presetId}
            favourites={favourites.ids}
            starProblem={favourites.problem}
            onStar={(presetId, starred) => void favourites.toggle(presetId, starred)}
            onBack={() => go({ step: 'format' })}
          />
        ) : null}
      </StudioPanel>
    </div>
  );
}
