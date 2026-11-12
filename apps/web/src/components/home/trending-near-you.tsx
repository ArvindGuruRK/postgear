'use client';

/**
 * Trending Near You (Sprint 11, Module 10, backlog #4): up to five rising
 * searches for the viewer's place, each with Create Post, and a way on to
 * Discover for the rest.
 *
 * The place is the one Discover would open on, chosen in the same order as
 * `use-place.ts` and by the same rule (`placeStart`): a place this browser
 * remembers the person choosing, else the workspace's saved place, else the
 * guess from the browser's time zone. Home only reads what Discover
 * remembered and never writes it, so a guess is made again next time, as it
 * is on Discover.
 *
 * Polite on purpose. Nothing is asked until the card has mounted and the
 * active-workspace cookie names this workspace (the feed and the settings are
 * scoped by it). The workspace's settings and the guess are asked for only
 * when the step before did not decide the place. The feed is one request,
 * cancelled if the card goes away first, and nothing polls. A failure costs
 * this card only: a quiet sentence and Try Again, never a page error.
 *
 * Worldwide has no rising searches of its own, so the card says where to pick
 * a place instead of asking. Rows come from the `trends` group; when the
 * workspace switched it off or it is empty, from the first other local group
 * with something in it (Wikipedia, in the place's language), under that
 * group's own line. The Bluesky and Mastodon topics are left out: they are
 * worldwide, and Discover gives them no Create Post either.
 *
 * Create Post opens Discover's own sheet with the row's item, the place and
 * the language it was read in, exactly as a card on Discover does.
 */
import { ArrowRightIcon } from '@animateicons/react/lucide/arrow-right-icon';
import { RotateCwIcon } from '@animateicons/react/lucide/rotate-cw-icon';
import { Button, MotionIcon, Skeleton } from '@postgear/ui';
import { useCallback, useEffect, useState } from 'react';
import { useWorkspaceScope } from '@/components/navigation/workspace-provider';
import { getDiscoverSettings, getFeed, localityFromTimeZone } from '@/lib/discover-api';
import type { DiscoverGroup, DiscoverItem, Locality } from '@/types/discover';
import { CreatePostSheet, type CreatePostTarget } from '../discover/create-post-sheet';
import {
  firstLanguage,
  isWorldwide,
  type PlaceSource,
  placeInSentence,
  placeStart,
  placeStorageKey,
  readRememberedPlace,
} from '../discover/discover-model';
import { ROW, ROW_LIST } from '../discover/discover-ui';
import { ActionLink } from './home-actions';
import { viewerTimeZone } from './home-model';
import { HomePanel, HomeSection } from './home-ui';

/** How many rows the card shows. */
export const TRENDING_COUNT = 5;

export const TRENDING_FAILED = "Trends near you didn't load.";
export const TRENDING_WORLDWIDE = 'Pick a place on Discover to see what is rising near you.';

export function risingLine(place: Locality): string {
  return `Rising searches in ${placeInSentence(place)} right now.`;
}

export function nothingRisingLine(place: Locality): string {
  return `Nothing is rising in ${placeInSentence(place)} right now.`;
}

/**
 * Places the person picked themselves. The same set `placeStart` treats as a
 * choice: one of these wins whatever the workspace saved, so the workspace's
 * settings need not be asked for.
 */
const OWN_CHOICES: ReadonlySet<PlaceSource> = new Set(['browser', 'search', 'worldwide']);

type TrendingState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'worldwide' }
  | {
      status: 'ready';
      place: Locality;
      language: string;
      /** The sentence over the rows: the place for trends, the group's own line otherwise. */
      line: string;
      /** Empty when nothing local is rising. */
      items: DiscoverItem[];
    };

/** The rows to show: the trends group, else the first other local group with something in it. */
export function pickTrending(
  groups: readonly DiscoverGroup[],
): { group: DiscoverGroup; items: DiscoverItem[] } | null {
  const local = groups.filter((group) => group.id !== 'social' && group.items.length > 0);
  const group = local.find((candidate) => candidate.id === 'trends') ?? local[0];
  return group ? { group, items: group.items.slice(0, TRENDING_COUNT) } : null;
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function preferredLanguages(): readonly string[] {
  try {
    return navigator.languages?.length ? navigator.languages : [navigator.language];
  } catch {
    return [];
  }
}

/** The place and language Discover would open on, in `use-place.ts`'s order. */
async function startingPlace(orgId: string): Promise<{ place: Locality; language: string }> {
  const remembered = readRememberedPlace(readStorage(placeStorageKey(orgId)));
  // A settings read that fails is null, which is how the Discover page starts too.
  const settings =
    remembered && OWN_CHOICES.has(remembered.source)
      ? null
      : await getDiscoverSettings().catch(() => null);

  const start = placeStart(remembered, settings);
  if (start.from !== 'guess') return { place: start.place, language: start.language };

  const guess = await localityFromTimeZone(viewerTimeZone());
  return { place: guess, language: firstLanguage(guess, preferredLanguages()) };
}

async function loadTrending(orgId: string, signal: AbortSignal): Promise<TrendingState> {
  const { place, language } = await startingPlace(orgId);
  if (isWorldwide(place)) return { status: 'worldwide' };
  // Gone while the place was found: the feed is never asked for.
  if (signal.aborted) return { status: 'loading' };

  const feed = await getFeed('trending', place, language, undefined, signal);
  const picked = pickTrending(feed.groups);
  if (!picked) {
    return { status: 'ready', place, language, line: nothingRisingLine(place), items: [] };
  }

  return {
    status: 'ready',
    place,
    language,
    line: picked.group.id === 'trends' ? risingLine(place) : picked.group.subtitle,
    items: picked.items,
  };
}

function useTrendingNearYou(orgId: string) {
  const { scope, status } = useWorkspaceScope();
  const [state, setState] = useState<TrendingState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the explicit retry trigger
  useEffect(() => {
    if (status === 'failed') {
      setState({ status: 'failed' });
      return;
    }
    // Scoped by the cookie: wait until it names this workspace (see `useWorkspaceScope`).
    if (status !== 'ready' || scope.status(orgId) !== 'ready') return;

    const controller = new AbortController();
    // Kept as it is when already loading, so a re-run never renders for nothing.
    setState((current) => (current.status === 'loading' ? current : { status: 'loading' }));

    loadTrending(orgId, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setState(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'failed' });
      });

    return () => controller.abort();
  }, [orgId, scope, status, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { state, retry };
}

export function TrendingNearYou({ orgId }: { orgId: string }) {
  const { state, retry } = useTrendingNearYou(orgId);
  const [target, setTarget] = useState<CreatePostTarget | null>(null);

  let line: string | null = null;
  if (state.status === 'failed') line = TRENDING_FAILED;
  else if (state.status === 'worldwide') line = TRENDING_WORLDWIDE;
  else if (state.status === 'ready') line = state.line;

  return (
    <HomeSection title="Trending Near You" data-testid="home-trending">
      <HomePanel className="flex min-w-0 flex-col gap-3 p-3 sm:p-4" data-state={state.status}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {line === null ? (
            <Skeleton className="h-4 w-56 max-w-full" />
          ) : (
            <p className="m-0 min-w-0 font-sans text-sm text-ink type-muted">{line}</p>
          )}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {state.status === 'failed' ? (
              <Button type="button" variant="secondary" size="sm" onClick={retry}>
                <MotionIcon icon={RotateCwIcon} className="h-4 w-4" />
                Try Again
              </Button>
            ) : null}
            <ActionLink href={`/${orgId}/discover`}>
              See More
              <MotionIcon icon={ArrowRightIcon} className="h-4 w-4" />
            </ActionLink>
          </div>
        </div>

        {state.status === 'loading' ? <TrendingSkeleton /> : null}

        {state.status === 'ready' && state.items.length > 0 ? (
          <ol className={ROW_LIST} data-count={state.items.length}>
            {state.items.map((item, index) => (
              <li key={item.id} className={ROW} data-testid="home-trending-row">
                {/* The list is ordered, so a screen reader already says the place. */}
                <span
                  aria-hidden="true"
                  className="w-6 shrink-0 text-center type-heading text-base text-ink tabular-nums"
                >
                  {index + 1}
                </span>
                <span
                  dir="auto"
                  className="min-w-0 flex-1 basis-40 break-words font-sans text-sm text-ink"
                >
                  {item.title}
                </span>
                {item.signal?.label ? (
                  <span className="shrink-0 font-sans text-xs text-ink type-muted">
                    {item.signal.label}
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  aria-label={`Create Post for ${item.title}`}
                  onClick={() => setTarget({ item, place: state.place, language: state.language })}
                >
                  Create Post
                </Button>
              </li>
            ))}
          </ol>
        ) : null}
      </HomePanel>

      <CreatePostSheet orgId={orgId} target={target} onClose={() => setTarget(null)} />
    </HomeSection>
  );
}

/** The loaded card's footprint: five rows of the same height in the same inset box. */
function TrendingSkeleton() {
  return (
    <ul className={ROW_LIST} aria-label="Loading trends near you">
      {Array.from({ length: TRENDING_COUNT }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders with nothing else to key on
        <li key={index} className={ROW}>
          <Skeleton className="h-5 w-6 shrink-0" />
          <Skeleton className="h-4 min-w-0 flex-1 basis-40" />
          <Skeleton className="h-3 w-20 shrink-0" />
          <Skeleton className="h-9 w-24 shrink-0" />
        </li>
      ))}
    </ul>
  );
}
