'use client';

/**
 * My Channels (Module 06, section 6; stories CL-1.7 and CL-1.8): the one
 * component behind both the Streams tab and the Browse Channels dialog, so
 * the two never drift.
 *
 * - **No channel yet**: the sentence, the platforms switched on, and
 *   **Add A Channel**.
 * - **Channels**: one chip per saved channel (avatar, name, platform), each
 *   with a menu holding **Remove Channel** behind a red confirm. In the
 *   dialog, platform tabs above the chips narrow them to one platform.
 * - **The chosen channel**: `Tabs` for its lists (Twitch and Kick Streams and
 *   Clips; YouTube Videos, Streams and Shorts), then the toolbar (Sort,
 *   Period for Twitch clips, Show Hidden, Refresh, "Updated 4 minutes ago",
 *   the count), then the rows, 50 a page, with Show More and scroll loading.
 *
 * Browsing talks to the channel routes and **never to the probe**. Only a
 * row's **Import** sends the row's canonical link to the probe, and every
 * refusal of the link box applies there too, so a channel list never offers
 * a way around a check. A probe that answers hands the link card to the page
 * (`onProbed`), which shows it with the rights tick.
 */
import { EllipsisVerticalIcon } from '@animateicons/react/lucide/ellipsis-vertical-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { RefreshCwIcon } from '@animateicons/react/lucide/refresh-cw-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MotionIcon,
  Segmented,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  Toggle,
  ToastAction,
  TooltipHint,
  toast,
} from '@postgear/ui';
import {
  type ClipPlatformId,
  type ListKind,
  type ListPeriod,
  type ListSort,
  PLATFORM_NAMES,
  platformPausedMessage,
} from '@postgear/video-engine';
import { Info } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  addChannel,
  checkChannel,
  hideStream,
  listStreams,
  probeLink,
  refreshChannel,
  removeChannel,
  unhideStream,
} from '@/lib/clips-api';
import type { ClipChannelView, ClipProbe, ClipStreamItem } from '@/types/clips';
import { orderedPlatforms } from '../home/home-model';
import { RefusalAlert } from '../home/refusal-alert';
import { AddChannelDialog } from './add-channel-dialog';
import {
  CAPPED_SENTENCE,
  CONNECT_SENTENCE,
  canonicalLinkOf,
  countLine,
  EMPTY_CHANNEL,
  listName,
  listsOf,
  PERIOD_NAMES,
  SORT_NAMES,
  updatedLine,
  YOUTUBE_SORT_HINT,
} from './channels-model';
import { StreamRow, StreamRowsSkeleton } from './stream-row';
import type { ChannelsState } from './use-channels';
import { useChannelStreams } from './use-channel-streams';

const UNREACHABLE = 'We could not reach Clips. Check your connection and try again.';
const LINK_UNREADABLE = 'We could not read this video. Try again in a moment.';

interface Refusal {
  message: string;
  code: string | undefined;
}

function refusalOf(cause: unknown, fallback = UNREACHABLE): Refusal {
  return cause instanceof ApiError && cause.status !== 0
    ? { message: cause.message, code: cause.code }
    : { message: fallback, code: undefined };
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0][0]}${words[1][0]}` : name.trim().slice(0, 2);
  return letters.toUpperCase();
}

/** The calls the browser makes; a test or the playground passes its own. */
export interface ChannelBrowserApi {
  list: typeof listStreams;
  refresh: typeof refreshChannel;
  probe: typeof probeLink;
  hide: typeof hideStream;
  unhide: typeof unhideStream;
  remove: typeof removeChannel;
  /** Add A Channel's Check and Add, so a fake browser never reaches the real routes. */
  check: typeof checkChannel;
  add: typeof addChannel;
}

const DEFAULT_API: ChannelBrowserApi = {
  list: listStreams,
  refresh: refreshChannel,
  probe: probeLink,
  hide: hideStream,
  unhide: unhideStream,
  remove: removeChannel,
  check: checkChannel,
  add: addChannel,
};

export function ChannelBrowser({
  orgId,
  platforms,
  disabled = false,
  platformTabs = false,
  channelsState,
  api = DEFAULT_API,
  onProbed,
}: {
  orgId: string;
  /** The platforms switched on, from `GET /clips/status`. */
  platforms: readonly ClipPlatformId[];
  /** The video tools are not running: browsing works, Import does not. */
  disabled?: boolean;
  /** The Browse dialog: platform tabs above the chips. */
  platformTabs?: boolean;
  /** The page's channels (`useChannels`), shared by the Streams tab and the dialog. */
  channelsState: ChannelsState;
  api?: ChannelBrowserApi;
  /** A row's link was read: show the link card for it. */
  onProbed: (url: string, probe: ClipProbe) => void;
}) {
  const channels = channelsState;
  const addApi = useMemo(() => ({ check: api.check, add: api.add }), [api.check, api.add]);
  const shownPlatforms = useMemo(() => orderedPlatforms(platforms), [platforms]);
  const [platform, setPlatform] = useState<ClipPlatformId | undefined>(shownPlatforms[0]);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ClipChannelView | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const visible = useMemo(
    () =>
      channels.channels.filter(
        (channel) => !platformTabs || platform === undefined || channel.platform === platform,
      ),
    [channels.channels, platform, platformTabs],
  );

  // The chosen channel stays chosen while it is listed; otherwise the first.
  const selected = visible.find((channel) => channel.id === selectedId) ?? visible[0] ?? null;

  const onAdded = (channel: ClipChannelView) => {
    channels.added(channel);
    if (platformTabs) setPlatform(channel.platform);
    setSelectedId(channel.id);
  };

  const confirmRemove = async () => {
    const channel = removing;
    if (!channel || removeBusy) return;
    setRemoveBusy(true);
    try {
      const { message } = await api.remove(channel.id);
      channels.removed(channel.id);
      toast({ title: message });
    } catch (cause) {
      toast({ title: refusalOf(cause).message, variant: 'danger' });
    } finally {
      setRemoveBusy(false);
      setRemoving(null);
    }
  };

  const addButton = (
    <Button
      variant="secondary"
      size="sm"
      disabled={shownPlatforms.length === 0}
      onClick={() => setAddOpen(true)}
    >
      <MotionIcon icon={PlusIcon} className="h-4 w-4" />
      Add A Channel
    </Button>
  );

  let body: React.ReactNode;
  if (channels.loading && channels.channels.length === 0) {
    body = (
      <div className="flex flex-col gap-4" aria-busy="true">
        <div className="flex gap-3">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-40" />
        </div>
        <StreamRowsSkeleton />
      </div>
    );
  } else if (channels.error && channels.channels.length === 0) {
    body = (
      <RefusalAlert
        message={channels.error.message}
        code={channels.error.code}
        orgId={orgId}
        onRetry={channels.reload}
      />
    );
  } else if (channels.channels.length === 0) {
    body = <NoChannels platforms={shownPlatforms} action={addButton} />;
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {visible.map((channel) => (
            <ChannelChip
              key={channel.id}
              channel={channel}
              selected={selected?.id === channel.id}
              onSelect={() => setSelectedId(channel.id)}
              onRemove={() => setRemoving(channel)}
            />
          ))}
          {addButton}
        </div>
        {selected ? (
          <ChannelLists
            // A new channel starts on its first list with its defaults.
            key={selected.id}
            channel={selected}
            orgId={orgId}
            disabled={disabled}
            api={api}
            onProbed={onProbed}
          />
        ) : (
          <p className="m-0 font-sans text-sm text-ink type-muted">
            {platform
              ? `No ${PLATFORM_NAMES[platform]} channels yet. Add one to see its videos.`
              : null}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {platformTabs && shownPlatforms.length > 1 && channels.channels.length > 0 ? (
        <Tabs value={platform} onValueChange={(value) => setPlatform(value as ClipPlatformId)}>
          <TabsList aria-label="Platform">
            {shownPlatforms.map((one) => (
              <TabsTrigger key={one} value={one}>
                {PLATFORM_NAMES[one]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}

      {body}

      <AddChannelDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        orgId={orgId}
        platforms={shownPlatforms}
        initialPlatform={platformTabs ? platform : undefined}
        onAdded={onAdded}
        api={addApi}
      />

      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => !open && !removeBusy && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Channel</AlertDialogTitle>
            <AlertDialogDescription>
              {removing
                ? `Remove ${removing.displayName} from your channels? Videos you imported from it stay.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              disabled={removeBusy}
              onClick={(event) => {
                event.preventDefault();
                void confirmRemove();
              }}
            >
              {removeBusy ? 'Removing' : 'Remove Channel'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NoChannels({
  platforms,
  action,
}: {
  platforms: readonly ClipPlatformId[];
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-md border-2 border-dashed border-outline bg-inset px-6 py-10 text-center">
      <div className="flex flex-wrap justify-center gap-2">
        {platforms.map((one) => (
          <Badge key={one} variant="outline">
            {PLATFORM_NAMES[one]}
          </Badge>
        ))}
      </div>
      <p className="m-0 max-w-md font-sans text-sm text-ink">{CONNECT_SENTENCE}</p>
      {action}
    </div>
  );
}

function ChannelChip({
  channel,
  selected,
  onSelect,
  onRemove,
}: {
  channel: ClipChannelView;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center rounded-full border-2 border-outline',
        selected ? 'bg-actionPrimary text-onActionPrimary' : 'bg-secondary text-ink',
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className="flex items-center gap-2 rounded-full py-1 ps-1 pe-2 outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
      >
        <Avatar size="sm">
          {channel.avatarUrl ? (
            <AvatarImage src={channel.avatarUrl} alt="" referrerPolicy="no-referrer" />
          ) : null}
          <AvatarFallback colorSeed={channel.id}>{initials(channel.displayName)}</AvatarFallback>
        </Avatar>
        <span className="max-w-48 truncate font-sans text-sm type-ui">{channel.displayName}</span>
        <span className="font-sans text-xs opacity-80">{PLATFORM_NAMES[channel.platform]}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`More for ${channel.displayName}`}
            className="me-1 flex h-7 w-7 items-center justify-center rounded-full outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
          >
            <MotionIcon icon={EllipsisVerticalIcon} className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onRemove}>
            <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
            Remove Channel
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** The chosen channel: its list tabs, the toolbar and the rows. */
function ChannelLists({
  channel,
  orgId,
  disabled,
  api,
  onProbed,
}: {
  channel: ClipChannelView;
  orgId: string;
  disabled: boolean;
  api: ChannelBrowserApi;
  onProbed: (url: string, probe: ClipProbe) => void;
}) {
  const kinds = listsOf(channel);
  const [kind, setKind] = useState<ListKind | undefined>(kinds[0]);
  const list = channel.lists.find((one) => one.kind === kind);
  const sorts: ListSort[] = list?.sorts.length ? list.sorts : ['newest'];
  const periods: ListPeriod[] = list?.periods ?? [];
  const [sort, setSort] = useState<ListSort>(sorts[0]);
  const [period, setPeriod] = useState<ListPeriod | null>(periods[0] ?? null);
  const [showHidden, setShowHidden] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [rowRefusal, setRowRefusal] = useState<(Refusal & { externalId: string }) | null>(null);
  const [now, setNow] = useState(() => new Date());
  const hiddenId = useId();
  const probeController = useRef<AbortController | null>(null);

  // A list change starts on that list's own defaults.
  const chooseKind = (next: ListKind) => {
    const nextList = channel.lists.find((one) => one.kind === next);
    setKind(next);
    setSort(nextList?.sorts[0] ?? 'newest');
    setPeriod(nextList?.periods[0] ?? null);
    setRowRefusal(null);
  };

  const query =
    channel.paused || kind === undefined
      ? null
      : { channelId: channel.id, kind, sort, period, showHidden };
  const streamsApi = useMemo(
    () => ({ list: api.list, refresh: api.refresh }),
    [api.list, api.refresh],
  );
  const streams = useChannelStreams(query, streamsApi);

  // A fresh list is read against the time it arrived, not the time the list opened.
  const updatedAt = streams.updatedAt;
  useEffect(() => {
    if (updatedAt) setNow(new Date());
  }, [updatedAt]);

  // "Updated 4 minutes ago" keeps time without asking the server.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => () => probeController.current?.abort(), []);

  // Scroll loading: the sentinel under the rows asks for the next page.
  const sentinel = useRef<HTMLDivElement | null>(null);
  const { hasMore, loadMore, loadingMore, moreError } = streams;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore || moreError || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore, moreError]);

  const importRow = useCallback(
    async (item: ClipStreamItem) => {
      const url = canonicalLinkOf(channel.platform, item);
      if (!url) {
        setRowRefusal({ externalId: item.externalId, message: LINK_UNREADABLE, code: undefined });
        return;
      }
      probeController.current?.abort();
      const abort = new AbortController();
      probeController.current = abort;
      setChecking(item.externalId);
      setRowRefusal(null);
      try {
        const probe = await api.probe(url, { signal: abort.signal });
        if (abort.signal.aborted) return;
        onProbed(url, probe);
      } catch (cause) {
        if (abort.signal.aborted) return;
        setRowRefusal({ externalId: item.externalId, ...refusalOf(cause) });
      } finally {
        if (!abort.signal.aborted) setChecking(null);
      }
    },
    [api, channel.platform, onProbed],
  );

  const { update } = streams;

  const showAgain = useCallback(
    async (item: ClipStreamItem, index?: number) => {
      // Back in the list at once; put back as it was if the server says no.
      update((items) => {
        if (items.some((one) => one.externalId === item.externalId)) {
          return items.map((one) =>
            one.externalId === item.externalId ? { ...one, hidden: false } : one,
          );
        }
        const at = Math.min(Math.max(index ?? 0, 0), items.length);
        return [...items.slice(0, at), { ...item, hidden: false }, ...items.slice(at)];
      });
      try {
        await api.unhide(channel.id, item.externalId);
      } catch (cause) {
        update((items) =>
          showHidden
            ? items.map((one) =>
                one.externalId === item.externalId ? { ...one, hidden: true } : one,
              )
            : items.filter((one) => one.externalId !== item.externalId),
        );
        toast({ title: refusalOf(cause).message, variant: 'danger' });
      }
    },
    [api, channel.id, showHidden, update],
  );

  const hide = useCallback(
    async (item: ClipStreamItem) => {
      const index = streams.items.findIndex((one) => one.externalId === item.externalId);
      update((items) =>
        showHidden
          ? items.map((one) =>
              one.externalId === item.externalId ? { ...one, hidden: true } : one,
            )
          : items.filter((one) => one.externalId !== item.externalId),
      );
      if (rowRefusal?.externalId === item.externalId) setRowRefusal(null);
      try {
        await api.hide(channel.id, item.externalId);
        toast({
          title: 'Hidden from the list.',
          action: (
            <ToastAction altText="Undo" onClick={() => void showAgain(item, index)}>
              Undo
            </ToastAction>
          ),
        });
      } catch (cause) {
        // Put the row back where it was.
        update((items) => {
          if (items.some((one) => one.externalId === item.externalId)) {
            return items.map((one) =>
              one.externalId === item.externalId ? { ...one, hidden: false } : one,
            );
          }
          const at = Math.min(Math.max(index, 0), items.length);
          return [...items.slice(0, at), item, ...items.slice(at)];
        });
        toast({ title: refusalOf(cause).message, variant: 'danger' });
      }
    },
    [api, channel.id, rowRefusal, showAgain, showHidden, streams.items, update],
  );

  const refresh = async () => {
    const refusal = await streams.refresh();
    if (refusal) toast({ title: refusal.message, variant: 'warning' });
  };

  if (channel.paused) {
    return (
      <RefusalAlert
        message={platformPausedMessage(channel.platform)}
        code="platform_paused"
        orgId={orgId}
      />
    );
  }

  const isYouTube = channel.platform === 'youtube';
  const sortLocked = isYouTube || sorts.length < 2;
  const updated = updatedLine(streams.updatedAt, now);

  const sortControl = (
    <Segmented
      label="Sort"
      tight
      disabled={sortLocked}
      value={sort}
      onValueChange={(value) => setSort(value as ListSort)}
      options={(sortLocked ? (['newest', 'views'] as ListSort[]) : sorts).map((one) => ({
        value: one,
        label: SORT_NAMES[one],
      }))}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      {kinds.length > 1 && kind ? (
        <Tabs value={kind} onValueChange={(value) => chooseKind(value as ListKind)}>
          <TabsList aria-label={`${channel.displayName} lists`}>
            {kinds.map((one) => (
              <TabsTrigger key={one} value={one}>
                {listName(channel.platform, one)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {isYouTube ? (
          <TooltipHint label={YOUTUBE_SORT_HINT} disabled>
            {sortControl}
          </TooltipHint>
        ) : (
          sortControl
        )}
        {periods.length > 0 && period ? (
          <Select value={period} onValueChange={(value) => setPeriod(value as ListPeriod)}>
            <SelectTrigger aria-label="Period" className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periods.map((one) => (
                <SelectItem key={one} value={one}>
                  {PERIOD_NAMES[one]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <div className="flex items-center gap-2">
          <Toggle id={hiddenId} checked={showHidden} onCheckedChange={setShowHidden} />
          <label htmlFor={hiddenId} className="font-sans text-sm text-ink type-ui">
            Show Hidden
          </label>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={streams.refreshing || streams.loading}
          onClick={() => void refresh()}
        >
          <MotionIcon icon={RefreshCwIcon} className="h-4 w-4" />
          {streams.refreshing ? 'Refreshing' : 'Refresh'}
        </Button>
        <p className="m-0 ms-auto font-sans text-sm text-ink type-muted" aria-live="polite">
          {[
            updated,
            !streams.loading && !streams.error && kind
              ? `${countLine(streams.items.length, channel.platform, kind)}${streams.hasMore ? ' so far' : ''}`
              : null,
          ]
            .filter(Boolean)
            .join(', ')}
        </p>
      </div>

      {streams.notice ? (
        <Alert variant="info" className="items-center">
          <Info className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0">{streams.notice}</p>
        </Alert>
      ) : null}

      {streams.loading ? (
        <StreamRowsSkeleton />
      ) : streams.error ? (
        <RefusalAlert
          message={streams.error.message}
          code={streams.error.code}
          orgId={orgId}
          onRetry={streams.reload}
        />
      ) : streams.items.length === 0 ? (
        <p className="m-0 rounded-md border-2 border-dashed border-outline bg-inset px-6 py-8 text-center font-sans text-sm text-ink">
          {EMPTY_CHANNEL}
        </p>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-busy={loadingMore}>
            {streams.items.map((item) => (
              <StreamRow
                key={item.externalId}
                item={item}
                platform={channel.platform}
                orgId={orgId}
                now={now}
                checking={checking === item.externalId}
                busy={checking !== null && checking !== item.externalId}
                disabled={disabled}
                refusal={rowRefusal?.externalId === item.externalId ? rowRefusal : null}
                onImport={(row) => void importRow(row)}
                onHide={(row) => void hide(row)}
                onShowAgain={(row) => void showAgain(row)}
              />
            ))}
          </ul>
          {loadingMore ? <StreamRowsSkeleton rows={2} /> : null}
          {moreError ? (
            <RefusalAlert
              message={moreError.message}
              code={moreError.code}
              orgId={orgId}
              onRetry={loadMore}
            />
          ) : null}
          <div ref={sentinel} aria-hidden="true" />
          {hasMore && !loadingMore && !moreError ? (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={loadMore}>
                Show More
              </Button>
            </div>
          ) : null}
          {!hasMore && streams.capped ? (
            <p className="m-0 text-center font-sans text-sm text-ink type-muted">
              {CAPPED_SENTENCE}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
