'use client';

/**
 * The top bar's search (2026-10-21): one box for the whole workspace.
 *
 * The bar holds a field-shaped button; pressing it (or Ctrl/Cmd+K, or "/")
 * opens a palette over the page, as Linear, Notion and Stripe do. The palette
 * owns the typing, the focus trap, the arrow keys and Escape (`cmdk` and
 * Radix), so none of that is hand-rolled here.
 *
 * - **Before anything is typed**: the person's recent searches in this
 *   workspace, and the two things most often started from here.
 * - **While typing**: pages and quick actions are matched in the browser at
 *   once; posts, channels and media come from `GET /search` after typing
 *   pauses. The last answer stays up (dimmed) while the next loads, so the
 *   list never flashes empty between keystrokes.
 * - **Filtering is the API's**, so `cmdk`'s own is off (`shouldFilter`). The
 *   selected row is therefore controlled: whenever the list changes, the top
 *   row is selected, so Enter always opens what is at the top.
 * - A search too short to run (`MIN_SEARCH_LENGTH`) sends nothing.
 * - **What a result opens**: a post in the composer, a channel's posts in the
 *   queue (or the Channels page when the channel needs attention), a media
 *   item in the library filtered to its name, a page itself.
 */
import { SearchIcon } from '@animateicons/react/lucide/search-icon';
import {
  Badge,
  cn,
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Kbd,
  KbdGroup,
  MotionIcon,
  pressSm,
  Skeleton,
} from '@postgear/ui';
import { CornerDownLeft, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChannelMark } from '@/components/channels/channel-mark';
import { PlatformIcon, platformLabel } from '@/components/platforms/platform-icon';
import { ChannelStack } from '@/components/posts/channel-stack';
import { describePost, formatWhen } from '@/components/posts/post-status';
import type {
  ChannelSearchResult,
  MediaSearchResult,
  PostSearchResult,
  SearchKind,
} from '@/types/search';
import { Highlight, termsOf } from './highlight';
import { PageIcon } from './page-icon';
import { clearRecent, readRecent, rememberSearch } from './recent-searches';
import { findPages, quickActions, type SearchPage } from './search-pages';
import { cleanQuery, MAX_SEARCH_LENGTH, MIN_SEARCH_LENGTH, useWorkspaceSearch } from './use-search';

const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

const KIND_LABELS: Record<SearchKind, string> = {
  posts: 'posts',
  channels: 'channels',
  media: 'media',
};

/** One selectable row: what cmdk calls it, and what choosing it does. */
interface Entry {
  value: string;
  run: () => void;
}

/** True when keys typed here belong to the field, not to a page shortcut. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Another dialog (the composer, a confirmation) is open and is not this one. */
function otherDialogOpen(own: HTMLElement | null): boolean {
  return [...document.querySelectorAll('[role="dialog"]')].some((dialog) => dialog !== own);
}

export function GlobalSearch({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  // Mac shows the Command key. Decided after mount so the server's HTML and
  // the first client render agree.
  const [mac, setMac] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const navigating = useRef(false);

  const cleaned = cleanQuery(query);
  const search = useWorkspaceSearch(query, open);
  const terms = useMemo(() => termsOf(cleaned), [cleaned]);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);

  const changeOpen = useCallback(
    (next: boolean) => {
      setOpen(next);

      if (next) {
        navigating.current = false;
        setRecent(readRecent(orgId));
      } else {
        setQuery('');
      }
    },
    [orgId],
  );

  // Ctrl/Cmd+K toggles it from anywhere, "/" opens it when no field has focus.
  // Neither opens over another dialog (the composer is one): that dialog
  // would be left behind a second one.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const toggle = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      const slash =
        event.key === '/' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !isTypingTarget(event.target);

      if (!toggle && !slash) {
        return;
      }

      if (!open && otherDialogOpen(content.current)) {
        return;
      }

      event.preventDefault();
      changeOpen(slash ? true : !open);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, changeOpen]);

  const base = `/${orgId}`;

  /** Closes the box and goes to `href`, remembering the search that found it. */
  function go(href: string) {
    if (cleaned.length >= MIN_SEARCH_LENGTH) {
      rememberSearch(orgId, cleaned);
    }

    navigating.current = true;
    changeOpen(false);
    router.push(href);
  }

  function forgetRecent() {
    clearRecent(orgId);
    setRecent([]);
  }

  const pages = findPages(cleaned);
  const data = search.data;
  const posts = data?.posts ?? [];
  const channels = data?.channels ?? [];
  const media = data?.media ?? [];
  const unavailable = data?.unavailable ?? [];
  const now = new Date();
  const total = pages.length + posts.length + channels.length + media.length;

  // A page whose name starts with the search ("queue", "bill") is almost
  // certainly what was meant, so it leads; otherwise content leads and pages
  // follow.
  const pagesFirst = pages.length > 0 && pages[0].label.toLowerCase().startsWith(terms[0] ?? '');

  const showStart = cleaned === '';
  const answered = search.active && data !== null && search.error === null;
  const nothingFound =
    answered &&
    !search.pending &&
    search.answeredFor === cleaned &&
    total === 0 &&
    unavailable.length === 0;
  const failed = search.error !== null || (answered && unavailable.length > 0);

  // The rows in the order they are drawn, for the controlled selection.
  const entries: Entry[] = [];
  const pageEntry = (page: SearchPage): Entry => ({
    value: `page:${page.id}`,
    run: () => go(`${base}${page.path}`),
  });

  if (showStart) {
    for (const text of recent) {
      entries.push({ value: `recent:${text}`, run: () => setQuery(text) });
    }
    if (recent.length > 0) {
      entries.push({ value: 'recent-clear', run: forgetRecent });
    }
    entries.push(...quickActions().map(pageEntry));
  } else {
    const pageEntries = pages.map(pageEntry);

    entries.push(
      ...(pagesFirst ? pageEntries : []),
      ...posts.map((post) => ({
        value: `post:${post.group}`,
        run: () => go(`${base}/composer?group=${encodeURIComponent(post.group)}`),
      })),
      ...channels.map((channel) => ({
        value: `channel:${channel.id}`,
        run: () => go(channelHref(base, channel)),
      })),
      ...media.map((item) => ({
        value: `media:${item.id}`,
        run: () => go(mediaHref(base, item.name)),
      })),
      ...(data?.more.media
        ? [{ value: 'media-all', run: () => go(mediaHref(base, cleaned)) }]
        : []),
      ...(pagesFirst ? [] : pageEntries),
      ...(failed ? [{ value: 'retry', run: search.retry }] : []),
    );
  }

  const firstValue = entries[0]?.value ?? '';
  // The top row is selected whenever the list changes under the person (a
  // new answer, a cleared box), so Enter opens what is at the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `cleaned` and the answered search are what say the list was replaced
  useEffect(() => {
    setSelected(firstValue);
  }, [firstValue, cleaned, search.answeredFor]);

  const runEntry = (value: string) => entries.find((entry) => entry.value === value)?.run();

  return (
    <>
      <button
        type="button"
        onClick={() => changeOpen(true)}
        aria-label="Search"
        aria-keyshortcuts="Control+K Meta+K"
        aria-haspopup="dialog"
        className={cn(
          'flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border-2 border-outline bg-field text-xs text-ink shadow-surfaceSm',
          'w-9 sm:w-64 sm:justify-start sm:px-3',
          'hover:bg-secondary',
          pressSm,
          FOCUS,
        )}
      >
        <MotionIcon icon={SearchIcon} className="h-4 w-4 shrink-0 text-ink" />
        <span className="hidden flex-1 truncate text-start font-sans opacity-50 sm:block">
          Enter your search
        </span>
        <KbdGroup className="hidden sm:inline-flex" aria-hidden>
          <Kbd>{mac ? '⌘' : 'Ctrl'}</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </button>

      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent
          ref={content}
          // The same frame as the design system's palette (`CommandDialog`):
          // centred, its own close button, the large hard shadow.
          className="overflow-hidden p-0 shadow-surfaceLg"
          // After choosing a result, focus belongs to wherever it led (the
          // composer takes it); only a plain dismissal returns it to the bar.
          onCloseAutoFocus={(event) => {
            if (navigating.current) {
              event.preventDefault();
            }
          }}
        >
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">
            Search your posts, channels, media and pages. Use the arrow keys to move and Enter to
            open.
          </DialogDescription>

          <Command
            shouldFilter={false}
            loop
            label="Search your workspace"
            value={selected}
            onValueChange={setSelected}
            className="border-none shadow-none"
          >
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Enter your search"
              aria-label="Search"
              // Keeps the text clear of the close button.
              className="pr-10"
              maxLength={MAX_SEARCH_LENGTH}
              autoComplete="off"
              spellCheck={false}
            />

            <CommandList aria-busy={search.pending} className="max-h-[min(24rem,60dvh)]">
              {showStart ? (
                <>
                  {recent.length > 0 ? (
                    <CommandGroup heading="Recent Searches">
                      {recent.map((text) => (
                        <CommandItem key={text} value={`recent:${text}`} onSelect={runEntry}>
                          <MotionIcon icon={SearchIcon} className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{text}</span>
                        </CommandItem>
                      ))}
                      <CommandItem value="recent-clear" onSelect={runEntry}>
                        <span className="h-4 w-4 shrink-0" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">Clear recent searches</span>
                      </CommandItem>
                    </CommandGroup>
                  ) : null}

                  <CommandGroup heading="Quick Actions">
                    {quickActions().map((page) => (
                      <CommandItem key={page.id} value={`page:${page.id}`} onSelect={runEntry}>
                        <PageIcon icon={page.icon} />
                        <span className="min-w-0 flex-1 truncate">{page.label}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              ) : (
                <div className={cn('transition-opacity', search.pending && data && 'opacity-60')}>
                  {pagesFirst ? (
                    <PagesGroup pages={pages} terms={terms} onSelect={runEntry} />
                  ) : null}

                  {search.active && !data && !search.error ? <ResultsSkeleton /> : null}

                  {posts.length > 0 ? (
                    <CommandGroup heading="Posts">
                      {posts.map((post) => (
                        <CommandItem
                          key={post.group}
                          value={`post:${post.group}`}
                          onSelect={runEntry}
                          className="items-start gap-3 py-2.5"
                        >
                          <PostRow post={post} terms={terms} now={now} />
                        </CommandItem>
                      ))}
                      {data?.more.posts ? <MoreNote kind="posts" /> : null}
                    </CommandGroup>
                  ) : null}

                  {channels.length > 0 ? (
                    <CommandGroup heading="Channels">
                      {channels.map((channel) => (
                        <CommandItem
                          key={channel.id}
                          value={`channel:${channel.id}`}
                          onSelect={runEntry}
                          className="gap-3"
                        >
                          <ChannelRow channel={channel} terms={terms} />
                        </CommandItem>
                      ))}
                      {data?.more.channels ? <MoreNote kind="channels" /> : null}
                    </CommandGroup>
                  ) : null}

                  {media.length > 0 ? (
                    <CommandGroup heading="Media">
                      {media.map((item) => (
                        <CommandItem
                          key={item.id}
                          value={`media:${item.id}`}
                          onSelect={runEntry}
                          className="gap-3"
                        >
                          <MediaRow item={item} terms={terms} />
                        </CommandItem>
                      ))}
                      {data?.more.media ? (
                        <CommandItem value="media-all" onSelect={runEntry}>
                          <CornerDownLeft
                            className="h-4 w-4 shrink-0"
                            strokeWidth={2.5}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1 truncate">See all matches in Media</span>
                        </CommandItem>
                      ) : null}
                    </CommandGroup>
                  ) : null}

                  {pagesFirst ? null : (
                    <PagesGroup pages={pages} terms={terms} onSelect={runEntry} />
                  )}

                  {failed ? (
                    <CommandGroup heading="Search">
                      <CommandItem value="retry" onSelect={runEntry}>
                        <TriangleAlert className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden />
                        <span className="min-w-0 flex-1">
                          {search.error ?? unavailableText(unavailable)}
                        </span>
                        <span className="shrink-0 text-xs">Try again</span>
                      </CommandItem>
                    </CommandGroup>
                  ) : null}

                  {nothingFound ? <NothingFound query={cleaned} /> : null}

                  {search.active || pages.length > 0 ? null : (
                    <p className="px-3 py-6 text-center font-sans text-sm text-ink">
                      Type at least {MIN_SEARCH_LENGTH} letters to search posts, channels and media.
                    </p>
                  )}
                </div>
              )}
            </CommandList>
          </Command>

          {/* Screen readers hear the outcome, since the list itself is not announced as it changes. */}
          <div role="status" aria-live="polite" className="sr-only">
            {search.pending
              ? 'Searching'
              : nothingFound
                ? `No results for ${cleaned}`
                : answered
                  ? `${total} ${total === 1 ? 'result' : 'results'}`
                  : ''}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function channelHref(base: string, channel: ChannelSearchResult): string {
  // A channel that needs attention is fixed on the Channels page; a healthy
  // one is looked at through its posts.
  return needsAttention(channel)
    ? `${base}/channels`
    : `${base}/queue?channel=${encodeURIComponent(channel.id)}`;
}

function needsAttention(channel: ChannelSearchResult): boolean {
  return channel.health !== 'connected' && channel.health !== 'expiring';
}

function mediaHref(base: string, search: string): string {
  return `${base}/media?search=${encodeURIComponent(search)}`;
}

function unavailableText(kinds: SearchKind[]): string {
  return `Could not search ${kinds.map((kind) => KIND_LABELS[kind]).join(' and ')}.`;
}

function PagesGroup({
  pages,
  terms,
  onSelect,
}: {
  pages: SearchPage[];
  terms: string[];
  onSelect: (value: string) => void;
}) {
  if (pages.length === 0) {
    return null;
  }

  return (
    <CommandGroup heading="Pages">
      {pages.map((page) => (
        <CommandItem key={page.id} value={`page:${page.id}`} onSelect={onSelect}>
          <PageIcon icon={page.icon} />
          <span className="min-w-0 flex-1 truncate">
            <Highlight text={page.label} terms={terms} />
          </span>
          {page.hint ? <span className="shrink-0 text-xs">{page.hint}</span> : null}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

function PostRow({ post, terms, now }: { post: PostSearchResult; terms: string[]; now: Date }) {
  const shown = describePost(post, now);

  return (
    <>
      <span className="flex h-9 w-12 shrink-0 items-center" aria-hidden>
        <ChannelStack channels={post.channels} publishDate={post.publishDate} now={now} max={3} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="line-clamp-2 break-words">
          {post.snippet ? <Highlight text={post.snippet} terms={terms} /> : 'Empty post'}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <Badge variant={shown.variant}>{shown.label}</Badge>
          <span>{formatWhen(new Date(post.publishDate))}</span>
          <span className="flex min-w-0 items-center gap-1">
            {post.channels.slice(0, 3).map((channel) => (
              <PlatformIcon
                key={channel.channelId}
                platform={channel.providerIdentifier}
                title={platformLabel(channel.providerIdentifier)}
                className="h-3.5 w-3.5"
              />
            ))}
          </span>
        </span>
      </span>
    </>
  );
}

function ChannelRow({ channel, terms }: { channel: ChannelSearchResult; terms: string[] }) {
  return (
    <>
      <ChannelMark
        color={channel.color}
        id={channel.id}
        name={channel.name}
        picture={channel.picture}
        platform={channel.providerIdentifier}
        size="sm"
        className="mx-1"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">
          <Highlight text={channel.name} terms={terms} />
        </span>
        <span className="truncate text-xs">
          <Highlight
            text={
              channel.profile ? `${channel.providerName} ${channel.profile}` : channel.providerName
            }
            terms={terms}
          />
        </span>
      </span>
      <span className="shrink-0 text-xs">
        {needsAttention(channel) ? 'Needs attention' : 'View posts'}
      </span>
    </>
  );
}

function MediaRow({ item, terms }: { item: MediaSearchResult; terms: string[] }) {
  const preview = item.thumbnailUrl ?? (item.type === 'image' ? item.url : null);

  return (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border-2 border-outline bg-primary">
        {preview ? (
          // biome-ignore lint/performance/noImgElement: a library thumbnail from the API's own storage
          <img src={preview} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="text-[10px] capitalize text-ink">{item.type}</span>
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <Highlight text={item.name} terms={terms} />
      </span>
      <span className="shrink-0 text-xs capitalize">{item.type}</span>
    </>
  );
}

function MoreNote({ kind }: { kind: SearchKind }) {
  return (
    <p className="px-3 pb-1 pt-1 font-sans text-xs text-ink">
      More {KIND_LABELS[kind]} match. Add a word to narrow it down.
    </p>
  );
}

function NothingFound({ query }: { query: string }) {
  return (
    <div className="px-3 py-8 text-center font-sans text-sm text-ink">
      <p className="break-words">No results for &ldquo;{query}&rdquo;</p>
      <p className="mt-1 text-xs">
        Try fewer words, or part of a word. Every word you type has to match.
      </p>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-2" aria-hidden>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 shrink-0" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
