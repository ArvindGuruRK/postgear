'use client';

/**
 * Library (module 19 section 9): Runs, Sounds, Stickers, Deny List, Gaps and
 * Credits. Review Items on a run opens Sounds or Stickers filtered to that
 * run's staged items. Each item list keeps its own filters while the
 * operator moves between views.
 */
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@postgear/ui';
import { useCallback, useState } from 'react';
import type { LibraryRun } from '@/types/operator';
import { LibraryCredits } from './library-credits';
import { emptyItemFilters, type ItemFilters, LibraryItems } from './library-items';
import { LibraryDenyList, LibraryGaps } from './library-lists';
import { LibraryRuns } from './library-runs';
import { LIBRARY_VIEW_NAMES, LIBRARY_VIEWS, type LibraryView } from './operator-model';

export function LibraryTab() {
  const [view, setView] = useState<LibraryView>('runs');
  const [soundFilters, setSoundFilters] = useState<ItemFilters>(() => emptyItemFilters());
  const [stickerFilters, setStickerFilters] = useState<ItemFilters>(() => emptyItemFilters());

  const reviewItems = useCallback((run: LibraryRun) => {
    if (run.type === 'sound') {
      setSoundFilters(emptyItemFilters(run.id));
      setView('sounds');
    } else {
      setStickerFilters(emptyItemFilters(run.id));
      setView('stickers');
    }
  }, []);

  return (
    <Tabs
      value={view}
      onValueChange={(value) => setView(value as LibraryView)}
      className="flex flex-col gap-4"
    >
      <TabsList aria-label="Library views" className="self-start">
        {LIBRARY_VIEWS.map((value) => (
          <TabsTrigger key={value} value={value}>
            {LIBRARY_VIEW_NAMES[value]}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="runs" className="mt-0">
        <LibraryRuns onReviewItems={reviewItems} />
      </TabsContent>
      <TabsContent value="sounds" className="mt-0">
        <LibraryItems
          key={`sound-${soundFilters.runId ?? 'all'}`}
          type="sound"
          filters={soundFilters}
          onFilters={setSoundFilters}
        />
      </TabsContent>
      <TabsContent value="stickers" className="mt-0">
        <LibraryItems
          key={`sticker-${stickerFilters.runId ?? 'all'}`}
          type="sticker"
          filters={stickerFilters}
          onFilters={setStickerFilters}
        />
      </TabsContent>
      <TabsContent value="deny" className="mt-0">
        <LibraryDenyList />
      </TabsContent>
      <TabsContent value="gaps" className="mt-0">
        <LibraryGaps />
      </TabsContent>
      <TabsContent value="credits" className="mt-0">
        <LibraryCredits />
      </TabsContent>
    </Tabs>
  );
}
