'use client';

/**
 * Discover (Sprint 11): what is rising and what is being reported where the
 * audience is, one click from a draft.
 *
 * The page opens on a `PageActions` row and no title (the top bar names it):
 * the place and language chips on the left with the OpenStreetMap credit
 * under them, and on the right how old the copy is, Refresh, and the
 * Simulated sticker when the API reads recorded feeds. Then the five tabs; the
 * open one lives in `?tab=`.
 *
 * The place lives in the browser (`use-place.ts`), so the feed is fetched
 * here and not by the server page. A tab never shows an error page for one
 * source: a resting group keeps its last copy with a note, a group with
 * nothing is hidden, and only a tab with nothing at all says so, with Try
 * Again (blueprint section 7, story DC-2.4).
 *
 * What a card opens (the Create Post sheet, the overflow menu) is handed in
 * by `discover-page.tsx`; without it a card shows Open only.
 */
import { RefreshCwIcon } from '@animateicons/react/lucide/refresh-cw-icon';
import {
  Alert,
  Badge,
  Button,
  cn,
  EmptyState,
  ErrorState,
  MotionIcon,
  PageActions,
  Skeleton,
  Stack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@postgear/ui';
import { Compass } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { DiscoverItem, DiscoverStatus, DiscoverTab, FeedKind } from '@/types/discover';
import { DISCOVER_TABS } from '@/types/discover';
import { useMounted } from '../posts/use-mounted';
import type { CreatePostTarget } from './create-post-sheet';
import { DiscoverGroup, DiscoverSkeleton } from './discover-group';
import { placeInSentence, TAB_NAMES, updatedText } from './discover-model';
import { PlacesCredit } from './discover-ui';
import { LanguageChip } from './language-chip';
import { PlaceChip } from './place-chip';
import { useFeed } from './use-feed';
import { usePlace } from './use-place';

export const LATER_STEP = 'Arrives in a later step of this sprint.';
export const LOAD_FAILED_TITLE = 'Discover could not load';

/** How often "Updated 5 min ago" and the cards' times move on. */
const CLOCK_MS = 30_000;

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export interface DiscoverViewProps {
  orgId: string;
  /** Null when the server could not ask; the page still works without it. */
  status: DiscoverStatus | null;
  initialTab: DiscoverTab;
  /** Opens the Create Post sheet for an item, read in this place and language (Module 04). */
  onCreatePost?: (target: CreatePostTarget) => void;
  /** Per-card controls after Open (Module 04's overflow menu). */
  renderCardExtra?: (item: DiscoverItem) => ReactNode;
}

export function DiscoverView({
  orgId,
  status,
  initialTab,
  onCreatePost,
  renderCardExtra,
}: DiscoverViewProps) {
  const mounted = useMounted();
  const now = useNow();
  const place = usePlace(orgId);
  const [tab, setTab] = useState<DiscoverTab>(initialTab);
  const tabsRef = useRef<HTMLDivElement>(null);
  const kind: FeedKind | null = tab === 'trending' || tab === 'news' ? tab : null;
  const feed = useFeed(kind, place.place, place.language);

  // The open tab lives in the URL without a navigation, which would re-run
  // the server page for nothing.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('tab') === tab) return;
    if (tab === 'trending') url.searchParams.delete('tab');
    else url.searchParams.set('tab', tab);
    window.history.replaceState(window.history.state, '', url);
  }, [tab]);

  // On a phone the tabs scroll sideways; keep the open one in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tab` is the trigger, the open tab is read from the DOM after it changes
  useEffect(() => {
    const active = tabsRef.current?.querySelector<HTMLElement>('[data-state="active"]');
    active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [tab]);

  const groups = feed.data?.groups.filter((group) => group.items.length > 0) ?? [];
  const updated = kind && feed.data && mounted ? updatedText(groups, now) : null;
  const ready = mounted && place.place !== null && place.language !== null;

  // A card's Create Post carries the place and language it was read in.
  const current = place.place;
  const language = place.language;
  const createPost =
    onCreatePost && current && language
      ? (item: DiscoverItem) => onCreatePost({ item, place: current, language })
      : undefined;

  function tryAgain() {
    if (place.failed) place.retry();
    feed.refresh();
  }

  function feedTab(): ReactNode {
    if (place.failed && !place.place) {
      return (
        <ErrorState
          title={LOAD_FAILED_TITLE}
          description="Try again in a moment."
          action={{ label: 'Try Again', onClick: tryAgain, variant: 'secondary' }}
        />
      );
    }
    if (!ready || (!feed.data && !feed.error)) {
      return <DiscoverSkeleton />;
    }
    if (!feed.data) {
      return (
        <ErrorState
          title={LOAD_FAILED_TITLE}
          description={feed.error ?? 'Try again in a moment.'}
          action={{ label: 'Try Again', onClick: tryAgain, variant: 'secondary' }}
        />
      );
    }

    return (
      <div
        aria-busy={feed.loading}
        className={cn('flex flex-col gap-6 transition-opacity', feed.loading && 'opacity-70')}
      >
        {feed.error ? (
          <Alert variant="warning" className="items-center py-3">
            <span className="flex-1">{feed.error} Showing what loaded last.</span>
            <Button variant="secondary" size="sm" onClick={feed.refresh}>
              Try Again
            </Button>
          </Alert>
        ) : null}
        {groups.length === 0 ? (
          <EmptyState
            icon={Compass}
            title={`Nothing to show for ${place.place ? placeInSentence(place.place) : 'this place'} right now.`}
            description="Try again in a few minutes."
            action={{ label: 'Try Again', onClick: feed.refresh, variant: 'secondary' }}
          />
        ) : (
          groups.map((group) => (
            <DiscoverGroup
              key={group.id}
              group={group}
              now={now}
              onCreatePost={createPost}
              renderExtra={renderCardExtra}
            />
          ))
        )}
      </div>
    );
  }

  return (
    <Stack gap="lg">
      <PageActions className="items-start justify-between">
        <div className="flex min-w-0 max-w-full flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {ready && place.place && place.language ? (
              <>
                <PlaceChip
                  place={place.place}
                  source={place.source}
                  status={place.status}
                  message={place.message}
                  geocoder={status?.geocoder ?? 'nominatim'}
                  onLocate={place.locate}
                  onPick={place.pickPlace}
                  onWorldwide={place.pickWorldwide}
                />
                <LanguageChip
                  languages={place.place.newsLanguages}
                  value={place.language}
                  onChange={place.setLanguage}
                  disabled={place.status === 'resolving'}
                />
              </>
            ) : (
              <>
                <Skeleton className="h-10 w-56 rounded-lg" />
                <Skeleton className="h-10 w-28 rounded-lg" />
              </>
            )}
          </div>
          <PlacesCredit />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {updated ? (
            <span className="font-sans text-sm text-ink type-muted" data-testid="discover-updated">
              {updated}
            </span>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            className="h-10"
            onClick={feed.refresh}
            disabled={!kind || !ready || feed.loading}
          >
            <MotionIcon
              icon={RefreshCwIcon}
              className={cn(
                'h-4 w-4',
                feed.loading && kind && 'animate-spin motion-reduce:animate-none',
              )}
            />
            Refresh
          </Button>
          {status?.simulation ? <Badge variant="secondary">Simulated</Badge> : null}
        </div>
      </PageActions>

      <Tabs value={tab} onValueChange={(value) => setTab(value as DiscoverTab)}>
        <TabsList
          ref={tabsRef}
          aria-label="Discover"
          className="flex w-full justify-start overflow-x-auto sm:inline-flex sm:w-auto"
        >
          {DISCOVER_TABS.map((value) => (
            <TabsTrigger key={value} value={value} className="shrink-0">
              {TAB_NAMES[value]}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="trending">{tab === 'trending' ? feedTab() : null}</TabsContent>
        <TabsContent value="news">{tab === 'news' ? feedTab() : null}</TabsContent>
        {(['videos', 'festivals', 'competitors'] as const).map((later) => (
          <TabsContent key={later} value={later}>
            <EmptyState icon={Compass} title={LATER_STEP} />
          </TabsContent>
        ))}
      </Tabs>
    </Stack>
  );
}
