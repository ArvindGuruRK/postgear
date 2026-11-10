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
 * Again where trying again could help (blueprint section 7, story DC-2.4).
 *
 * Four tabs are the feed's (Module 05 added Videos and Festivals). Two of
 * them can know their answer without asking: Videos when this PostGear has no
 * YouTube key (the status says so), and Videos or Festivals for Worldwide,
 * since both are a country's. Neither makes a request then.
 *
 * The fifth tab, Competitors (Module 07), is not the feed's: it has routes of
 * its own and no place in it, so `competitors-tab.tsx` loads it. This view
 * hands it Create Post, and counts the presses of Refresh for it, since the
 * page has one Refresh button and it must work on every tab.
 *
 * What a card opens (the Create Post sheet, the overflow menu) is handed in
 * by `discover-page.tsx`; without it a card shows Open only. A festival's
 * Plan A Post opens the same sheet with a date for the draft.
 *
 * Module 06 brings in what the workspace saved (`settings`, read by the
 * server page): the place a first visit starts from, the News tab's default
 * topic, and the groups an admin switched off. Videos and Festivals say so
 * without asking when the settings already do. Save For This Workspace in the
 * place popover is the one thing here that writes them, and only for an
 * admin.
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
  toast,
} from '@postgear/ui';
import { CalendarDays, Clapperboard, Compass, MapPin } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { saveDiscoverSettings } from '@/lib/discover-api';
import type {
  DiscoverItem,
  DiscoverSettings,
  DiscoverStatus,
  DiscoverTab,
  FeedKind,
} from '@/types/discover';
import { DISCOVER_TABS } from '@/types/discover';
import { useMounted } from '../posts/use-mounted';
import { CompetitorsTab } from './competitors-tab';
import type { CreatePostTarget } from './create-post-sheet';
import { DiscoverGroup, DiscoverSkeleton } from './discover-group';
import {
  festivalPublishAt,
  isWorldwide,
  locationSourceFor,
  placeChipText,
  placeInSentence,
  placePatch,
  switchedOff,
  TAB_NAMES,
  updatedText,
  workspaceLanguages,
} from './discover-model';
import { PlacesCredit } from './discover-ui';
import { LanguageChip } from './language-chip';
import { PlaceChip } from './place-chip';
import { TopicSelect } from './topic-select';
import { useFeed } from './use-feed';
import { usePlace } from './use-place';

export const VIDEOS_TURNED_OFF = 'Videos are turned off for this workspace.';
export const FESTIVALS_TURNED_OFF = 'Festivals are turned off for this workspace.';
export const TURN_BACK_ON = 'Turn them back on in Settings, Discover.';
export const WORKSPACE_SAVE_FAILED =
  'We could not save the workspace place. Try again in a moment.';
export const LOAD_FAILED_TITLE = 'Discover could not load';
export const VIDEOS_NOT_SET_UP = 'Trending videos are not set up for this PostGear.';
export const VIDEOS_ASK_ADMIN = 'Ask your PostGear admin to add a YouTube key.';
export const VIDEOS_RESTING = 'YouTube is resting until tomorrow.';
export const VIDEOS_NEED_PLACE = 'Trending videos need a place.';
export const VIDEOS_NEED_PLACE_HINT = 'Choose a country or a city to see what is popular there.';
export const FESTIVALS_NEED_PLACE = 'Festivals need a place.';
export const FESTIVALS_NEED_PLACE_HINT = 'Choose a country or a city to see what is coming up.';

/** The tabs the feed answers, in the page's order. */
const FEED_TABS = DISCOVER_TABS.filter((tab): tab is FeedKind => tab !== 'competitors');

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

/**
 * What the open tab asks the feed for, or null when there is nothing to ask:
 * Competitors has routes of its own, videos need a key and a country,
 * festivals need a country, and neither is asked for once the workspace has
 * turned it off.
 */
function feedKindFor(
  tab: DiscoverTab,
  videosOff: boolean,
  worldwide: boolean,
  turnedOff: boolean,
): FeedKind | null {
  if (tab === 'competitors' || turnedOff) return null;
  if (tab === 'videos' && (videosOff || worldwide)) return null;
  if (tab === 'festivals' && worldwide) return null;
  return tab;
}

/**
 * A tab the workspace switched off in Settings. An admin is told where to
 * turn it back on; a member cannot, so they get the one sentence. No button:
 * the top bar's Settings is one click away and this is not an error.
 */
function TurnedOff({ tab, isAdmin }: { tab: 'videos' | 'festivals'; isAdmin: boolean }) {
  const videos = tab === 'videos';
  return (
    <EmptyState
      icon={videos ? Clapperboard : CalendarDays}
      title={videos ? VIDEOS_TURNED_OFF : FESTIVALS_TURNED_OFF}
      description={isAdmin ? TURN_BACK_ON : undefined}
    />
  );
}

/**
 * Videos without a YouTube key. A member can do nothing about it, so they get
 * the one sentence; an admin is told who to ask. No button either way: the
 * key is set where PostGear is installed, not in the app.
 */
function VideosNotSetUp({ isAdmin }: { isAdmin: boolean }) {
  return (
    <EmptyState
      icon={Clapperboard}
      title={VIDEOS_NOT_SET_UP}
      description={isAdmin ? VIDEOS_ASK_ADMIN : undefined}
    />
  );
}

export interface DiscoverViewProps {
  orgId: string;
  /** Null when the server could not ask; the page still works without it. */
  status: DiscoverStatus | null;
  initialTab: DiscoverTab;
  /**
   * What the workspace saved for Discover (Module 06): its place, languages,
   * topics and switched-off groups. Null when the server could not ask; the
   * page then starts from the time zone guess and hides nothing itself.
   */
  settings: DiscoverSettings | null;
  /**
   * Whether the viewer is an admin of this workspace. Presentation only: it
   * decides who is told how a missing piece gets set up, and who may press
   * Save For This Workspace. The API's guard is the real check.
   */
  isAdmin: boolean;
  /** Opens the Create Post sheet for an item, read in this place and language (Module 04). */
  onCreatePost?: (target: CreatePostTarget) => void;
  /** Per-card controls after Open (Module 04's overflow menu). */
  renderCardExtra?: (item: DiscoverItem) => ReactNode;
}

export function DiscoverView({
  orgId,
  status,
  initialTab,
  settings: initialSettings,
  isAdmin,
  onCreatePost,
  renderCardExtra,
}: DiscoverViewProps) {
  const mounted = useMounted();
  const now = useNow();
  // Saving from the popover answers the new settings, so they live here.
  const [settings, setSettings] = useState(initialSettings);
  const [savingDefault, setSavingDefault] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const place = usePlace(orgId, settings);
  // The place as it is now, for the moment a save comes back.
  const reading = useRef(place);
  reading.current = place;
  const [tab, setTab] = useState<DiscoverTab>(initialTab);
  const tabsRef = useRef<HTMLDivElement>(null);
  const worldwide = place.place !== null && isWorldwide(place.place);
  const videosOff = status?.sources.videos === false;
  const turnedOff = (tab === 'videos' || tab === 'festivals') && switchedOff(settings, tab);
  const kind = feedKindFor(tab, videosOff, worldwide, turnedOff);
  const feed = useFeed(kind, place.place, place.language, place.topic);
  // Competitors loads itself; each press of Refresh on that tab moves this on.
  const [competitorsRefresh, setCompetitorsRefresh] = useState(0);
  const onCompetitors = tab === 'competitors';

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
  // Plan A Post is Create Post with a date: the evening before a public
  // holiday, the morning of an observance, on the place's own clock.
  const planPost =
    onCreatePost && current && language
      ? (item: DiscoverItem) => {
          const publishAt = festivalPublishAt(item, current.timeZone);
          onCreatePost({ item, place: current, language, ...(publishAt ? { publishAt } : {}) });
        }
      : undefined;

  function tryAgain() {
    if (place.failed) place.retry();
    feed.refresh();
  }

  // A failed save was about the place it tried to save; a new place starts clean.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `current` is the trigger
  useEffect(() => {
    setSaveError(null);
  }, [current]);

  /**
   * Save For This Workspace: the place being read, whole, with the chip's
   * language first. One request. The person stays where they are, and the
   * place now reads as the workspace's.
   */
  async function saveForWorkspace() {
    if (!isAdmin || !current || !language || savingDefault) return;
    setSavingDefault(true);
    setSaveError(null);

    try {
      const saved = await saveDiscoverSettings({
        ...placePatch(current, locationSourceFor(place.source)),
        languages: workspaceLanguages(current, language),
      });
      setSettings(saved);
      // Only if they are still reading the place that was saved: someone who
      // moved on while the save was out keeps the place they moved to.
      if (reading.current.place === current) reading.current.followWorkspace();
      toast({
        title: 'Saved',
        description: `${placeChipText(current, 'workspace')} is now the workspace default.`,
      });
    } catch (cause) {
      setSaveError(
        cause instanceof ApiError && cause.status !== 0 ? cause.message : WORKSPACE_SAVE_FAILED,
      );
    } finally {
      setSavingDefault(false);
    }
  }

  /** A tab whose every group is empty: the sentence that fits why. */
  function nothingToShow(): ReactNode {
    const where = current ? placeInSentence(current) : 'this place';

    if (tab === 'videos' && feed.data?.reason === 'resting') {
      // The day's YouTube budget is spent and no copy was kept: tomorrow, not Try Again.
      return <EmptyState icon={Clapperboard} title={VIDEOS_RESTING} />;
    }
    if (tab === 'festivals') {
      // A quiet month and calendars that had nothing to give read the same.
      // Only the second can change on another try, so only it gets the button.
      const mayChange = feed.data?.unavailable.includes('holidays') ?? false;
      return (
        <EmptyState
          icon={CalendarDays}
          title={`No festivals found for ${where} in the next 30 days.`}
          action={
            mayChange
              ? { label: 'Try Again', onClick: feed.refresh, variant: 'secondary' }
              : undefined
          }
        />
      );
    }
    return (
      <EmptyState
        icon={Compass}
        title={`Nothing to show for ${where} right now.`}
        description="Try again in a few minutes."
        action={{ label: 'Try Again', onClick: feed.refresh, variant: 'secondary' }}
      />
    );
  }

  function feedTab(): ReactNode {
    if (tab === 'videos' || tab === 'festivals') {
      // The settings said so before asking, or (when they could not be read)
      // the answer did. Either beats "not set up": off is the workspace's own call.
      if (turnedOff || feed.data?.hidden?.includes(tab)) {
        return <TurnedOff tab={tab} isAdmin={isAdmin} />;
      }
    }
    if (tab === 'videos' && videosOff) {
      return <VideosNotSetUp isAdmin={isAdmin} />;
    }
    if (place.failed && !place.place) {
      return (
        <ErrorState
          title={LOAD_FAILED_TITLE}
          description="Try again in a moment."
          action={{ label: 'Try Again', onClick: tryAgain, variant: 'secondary' }}
        />
      );
    }
    if (!ready) {
      return <DiscoverSkeleton />;
    }
    if (worldwide && (tab === 'videos' || tab === 'festivals')) {
      const videos = tab === 'videos';
      return (
        <EmptyState
          icon={MapPin}
          title={videos ? VIDEOS_NEED_PLACE : FESTIVALS_NEED_PLACE}
          description={videos ? VIDEOS_NEED_PLACE_HINT : FESTIVALS_NEED_PLACE_HINT}
        />
      );
    }
    if (!feed.data && !feed.error) {
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
    if (feed.data.reason === 'not_set_up') {
      // The status could not say (the server did not reach it); the answer did.
      return <VideosNotSetUp isAdmin={isAdmin} />;
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
        {groups.length === 0
          ? nothingToShow()
          : groups.map((group) => (
              <DiscoverGroup
                key={group.id}
                group={group}
                now={now}
                today={feed.data?.today}
                onCreatePost={createPost}
                onPlanPost={planPost}
                renderExtra={renderCardExtra}
              />
            ))}
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
                  workspace={{
                    settings,
                    isAdmin,
                    saving: savingDefault,
                    error: saveError,
                    onSave: () => void saveForWorkspace(),
                  }}
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
            onClick={
              onCompetitors ? () => setCompetitorsRefresh((count) => count + 1) : feed.refresh
            }
            disabled={onCompetitors ? !mounted : !kind || !ready || feed.loading}
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

        {FEED_TABS.map((value) => (
          <TabsContent key={value} value={value}>
            {tab === value && value === 'news' && ready ? (
              // Above the groups, and still there when a topic has nothing,
              // so the way back to All is never lost.
              <div className="mb-4">
                <TopicSelect value={place.topic} onChange={place.setTopic} />
              </div>
            ) : null}
            {tab === value ? feedTab() : null}
          </TabsContent>
        ))}
        <TabsContent value="competitors">
          {onCompetitors && mounted ? (
            <CompetitorsTab
              orgId={orgId}
              isAdmin={isAdmin}
              now={now}
              refreshKey={competitorsRefresh}
              onCreatePost={createPost}
            />
          ) : null}
        </TabsContent>
      </Tabs>
    </Stack>
  );
}
