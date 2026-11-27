'use client';

/**
 * Recipes And Brand Kit (Sprint 13, Module 10), reached from the Clips page:
 * a framed page (the rail and the top bar stay), desktop only like every
 * Clips screen. The actions row carries Back To Clips, then two tabs:
 * **Recipes** (`recipes-tab.tsx`) and **Brand Kit** (`brand-kits-tab.tsx`).
 *
 * The open tab lives in `?tab=` without a navigation, so a reload lands on
 * it. Both tabs stay mounted while the other is open, so an intro still
 * uploading carries on when the person looks at their recipes.
 */
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { MotionIcon, PageActions, Tabs, TabsContent, TabsList, TabsTrigger } from '@postgear/ui';
import { useEffect, useState } from 'react';
import { ActionLink } from '@/components/home/home-actions';
import type { ClipBrandKitView, RecipesView } from '@/types/clips-recipes';
import { BrandKitsTab } from './brand-kits-tab';
import { DEFAULT_KIT_TAB, KIT_TAB_NAMES, KIT_TABS, type KitTab } from './kit-model';
import { RecipesTab } from './recipes-tab';
import type { BrandUploadDeps } from './use-brand-video-upload';

export function KitView({
  orgId,
  initialTab,
  initialRecipes,
  initialKits,
  uploadDeps,
}: {
  orgId: string;
  initialTab: KitTab;
  initialRecipes: RecipesView | null;
  initialKits: ClipBrandKitView[] | null;
  /** Tests hand in their own upload transport. */
  uploadDeps?: BrandUploadDeps;
}) {
  const [tab, setTab] = useState<KitTab>(initialTab);

  useEffect(() => {
    const url = new URL(window.location.href);
    const wanted = tab === DEFAULT_KIT_TAB ? null : tab;
    if (url.searchParams.get('tab') === wanted) return;
    if (wanted) url.searchParams.set('tab', wanted);
    else url.searchParams.delete('tab');
    window.history.replaceState(window.history.state, '', url);
  }, [tab]);

  return (
    <div className="flex flex-col gap-5" data-testid="clip-kit-page">
      <PageActions className="justify-start">
        <ActionLink href={`/${encodeURIComponent(orgId)}/clips`} data-testid="clip-kit-back">
          <MotionIcon icon={ArrowLeftIcon} className="h-4 w-4" />
          Back To Clips
        </ActionLink>
      </PageActions>

      <Tabs value={tab} onValueChange={(value) => setTab(value as KitTab)}>
        <TabsList aria-label="Recipes and brand kit">
          {KIT_TABS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {KIT_TAB_NAMES[value]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="recipes" forceMount className="data-[state=inactive]:hidden">
          <RecipesTab initial={initialRecipes} />
        </TabsContent>
        <TabsContent value="brand-kit" forceMount className="data-[state=inactive]:hidden">
          <BrandKitsTab orgId={orgId} initial={initialKits} uploadDeps={uploadDeps} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
