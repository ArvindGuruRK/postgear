'use client';

/**
 * The Clips page (Sprint 12): four tabs, the open one in `?tab=`.
 *
 * Module 01 lays the frame; each tab is filled by its own module (Create and
 * Videos in 06, Clips in 07, Downloads in 18) and says so until then. There
 * is no `PageActions` row yet because there is nothing to act on: the top
 * bar names the page and the tabs open it.
 */
import { EmptyState, Tabs, TabsContent, TabsList, TabsTrigger } from '@postgear/ui';
import { ClapperboardIcon, DownloadIcon, FilmIcon, LinkIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  CLIPS_TAB_NAMES,
  CLIPS_TABS,
  type ClipsTab,
  DEFAULT_CLIPS_TAB,
  LATER_STEP_SENTENCE,
} from './clips-model';

const TAB_ICONS = {
  create: LinkIcon,
  videos: FilmIcon,
  clips: ClapperboardIcon,
  downloads: DownloadIcon,
} as const;

export function ClipsView({ initialTab }: { orgId: string; initialTab: ClipsTab }) {
  const [tab, setTab] = useState<ClipsTab>(initialTab);

  // The open tab lives in the URL without a navigation, which would re-run
  // the server page for nothing.
  useEffect(() => {
    const url = new URL(window.location.href);
    const wanted = tab === DEFAULT_CLIPS_TAB ? null : tab;
    if (url.searchParams.get('tab') === wanted) return;
    if (wanted) url.searchParams.set('tab', wanted);
    else url.searchParams.delete('tab');
    window.history.replaceState(window.history.state, '', url);
  }, [tab]);

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as ClipsTab)}>
      <TabsList aria-label="Clips tabs">
        {CLIPS_TABS.map((value) => (
          <TabsTrigger key={value} value={value}>
            {CLIPS_TAB_NAMES[value]}
          </TabsTrigger>
        ))}
      </TabsList>
      {CLIPS_TABS.map((value) => (
        <TabsContent key={value} value={value}>
          <EmptyState icon={TAB_ICONS[value]} title={LATER_STEP_SENTENCE} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
