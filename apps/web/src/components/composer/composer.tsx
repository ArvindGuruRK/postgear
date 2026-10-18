'use client';

/**
 * The post composer.
 *
 * ## Always a modal
 *
 * Laid out after the reference's "Create Post" (UI revamp, 2026-10-19): a
 * wide card with the writing on the left (channels, the per-channel tabs,
 * the editor) and the live "Post Preview" on the right, over one footer that
 * holds the time and the save actions. It is a modal, never a page of its
 * own, and can be switched to fullscreen (after Buffer's composer).
 *
 * The URL still names what is open (`/composer?group=`, `?at=`, `?media=`),
 * so a post can be reloaded, bookmarked and linked. It opens two ways:
 *
 * - `opened="in-app"`: navigated to from inside the app, the route is
 *   intercepted (`[orgId]/@modal/(.)composer`) and the modal opens over the
 *   page the person was on. Closing goes back in history, so the browser's
 *   back button closes it too and that page is exactly as it was.
 * - `opened="direct"`: a reload, a bookmark or a shared link
 *   (`[orgId]/@modal/composer`) opens the same modal over the calendar.
 *   There is no in-app page to go back to, so closing goes to the calendar.
 *
 * Links that stay inside the composer (a saved post, "New post") move with
 * `navigateTo`: opened in-app they replace the modal's contents, keeping
 * "back" as "close"; opened directly they load in full, since an in-app
 * navigation from there would be intercepted as an in-app opening and lose
 * the way back to the calendar.
 *
 * ## Saving
 *
 * "Save draft" accepts anything well-formed. "Add to queue" first runs the
 * same checks the API will, and shows every blocker at once rather than
 * sending a request to learn about them one at a time; the API still has the
 * final say, and its message is shown if it disagrees. A save or delete is
 * announced (`announcePostsChanged`), so the calendar or queue under the
 * modal shows it at once.
 */
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
  AlertTitle,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  buttonVariants,
  cn,
  DateTimePicker,
  Dialog,
  DialogContent,
  DialogTitle,
  Tabs,
  TabsList,
  TabsTrigger,
  TooltipHint,
  useToast,
} from '@postgear/ui';
import { Globe, Maximize2, Minimize2, Plus, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { PlatformIcon } from '@/components/platforms/platform-icon';
import { ApiError, api } from '@/lib/api';
import { announcePostsChanged } from '@/lib/post-events';
import type { Channel, ProviderSummary } from '@/types/channel';
import type { MediaItem } from '@/types/media';
import type { PostDetail } from '@/types/post';
import { buildReport, queueBlockers } from './channel-report';
import { ComposerChannels } from './composer-channels';
import {
  composerReducer,
  effectiveParts,
  initialComposerState,
  isCustomized,
  isDirty,
  isValidPublishAt,
  MAX_MEDIA_PER_PART,
  partsFor,
  SHARED,
  toLocalInputValue,
  toSavePayload,
} from './composer-state';
import { DraftsButton, DraftsSheet } from './drafts-sheet';
import { MediaPickerDialog } from './media-picker-dialog';
import { PreviewPanel } from './preview-panel';
import { ThreadEditor } from './thread-editor';

interface ComposerProps {
  /** How the modal was reached, which decides what closing does: see the header. */
  opened: 'in-app' | 'direct';
  orgId: string;
  channels: Channel[];
  providers: ProviderSummary[];
  initialPost: PostDetail | null;
  initialMedia: MediaItem | null;
  /** An ISO time to start a new post at: the calendar's "click a slot". */
  initialPublishAt?: string | null;
  /** Set when `?group=` named a post that could not be loaded. */
  loadError: string | null;
}

type Notice =
  | { kind: 'error'; message: string }
  | { kind: 'conflict'; message: string }
  | { kind: 'blockers'; items: string[] };

const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

const FULLSCREEN_KEY = 'postgear:composer-fullscreen';

/**
 * One scope tile; the active one is the primary fill, as a pressed choice.
 * Styled on `aria-selected`, not `data-state`: the tooltip around each tile
 * sets its own `data-state` (open or closed) on the same element, which
 * replaces the tab's "active" / "inactive".
 */
const SCOPE_TILE = cn(
  'h-11 w-11 rounded-lg border-2 border-ink/15 bg-chrome p-0 text-ink hover:border-outline',
  'aria-selected:border-outline aria-selected:bg-actionPrimary aria-selected:text-onActionPrimary',
);

export function Composer({
  opened,
  orgId,
  channels,
  providers,
  initialPost,
  initialMedia,
  initialPublishAt = null,
  loadError,
}: ComposerProps) {
  const router = useRouter();
  const { toast } = useToast();

  const channelsById = useMemo(
    () => new Map(channels.map((channel) => [channel.id, channel])),
    [channels],
  );
  const providersById = useMemo(
    () => new Map(providers.map((provider) => [provider.identifier, provider])),
    [providers],
  );

  const [state, dispatch] = useReducer(composerReducer, undefined, () =>
    initialComposerState({
      post: initialPost,
      media: initialMedia,
      availableChannelIds: new Set(channels.map((channel) => channel.id)),
      now: new Date(),
      publishAt: initialPublishAt ? new Date(initialPublishAt) : null,
    }),
  );

  const [saving, setSaving] = useState<'DRAFT' | 'QUEUE' | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmUseShared, setConfirmUseShared] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  // Fullscreen is a preference, kept per browser: whoever writes with the
  // whole screen keeps getting it. Read after mount so the server render and
  // the first client render agree.
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    try {
      setFullscreen(window.localStorage.getItem(FULLSCREEN_KEY) === 'true');
    } catch {
      // Storage unavailable (private mode, blocked site data): windowed.
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    setFullscreen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(FULLSCREEN_KEY, String(next));
      } catch {
        // The preference just won't persist.
      }
      return next;
    });
  }, []);

  const selectedChannels = state.selected.flatMap((id) => channelsById.get(id) ?? []);

  const reports = useMemo(
    () =>
      state.selected.flatMap((id) => {
        const channel = channelsById.get(id);
        return channel
          ? [
              buildReport(
                channel,
                providersById.get(channel.providerIdentifier),
                effectiveParts(state, id),
              ),
            ]
          : [];
      }),
    [state, channelsById, providersById],
  );

  const blockers = queueBlockers(reports);
  const dirty = isDirty(state);
  const publishDate = isValidPublishAt(state.publishAt) ? new Date(state.publishAt) : null;
  const locked = state.savedState === 'PUBLISHED';

  // The reports that decide what the current tab's counters and issues show:
  // the shared thread speaks for every channel that follows it.
  const scopeReports =
    state.scope === SHARED
      ? reports.filter((report) => !isCustomized(state, report.channel.id))
      : reports.filter((report) => report.channel.id === state.scope);

  /** Moves within the composer: see "Always a modal" in the header. */
  const navigateTo = useCallback(
    (href: string) => {
      if (opened === 'in-app') {
        router.replace(href);
      } else {
        window.location.assign(href);
      }
    },
    [opened, router],
  );

  const close = useCallback(() => {
    if (opened === 'in-app') {
      router.back();
    } else {
      router.replace(`/${orgId}/calendar`);
    }
  }, [opened, router, orgId]);

  /** Closing never silently drops unsaved writing. */
  const requestClose = useCallback(() => {
    if (dirty) {
      setConfirmClose(true);
    } else {
      close();
    }
  }, [dirty, close]);

  const save = useCallback(
    async (target: 'DRAFT' | 'QUEUE') => {
      setNotice(null);

      if (state.selected.length === 0) {
        setNotice({ kind: 'error', message: 'Choose at least one channel to save this post for.' });
        return;
      }

      if (!isValidPublishAt(state.publishAt)) {
        setNotice({ kind: 'error', message: 'Choose a date and time for this post.' });
        return;
      }

      if (target === 'QUEUE') {
        const problems = [
          ...(publishDate && publishDate.getTime() <= Date.now()
            ? ['Choose a time in the future to add this post to the queue.']
            : []),
          ...blockers,
        ];

        if (problems.length > 0) {
          setNotice({ kind: 'blockers', items: problems });
          return;
        }
      }

      setSaving(target);
      const revision = state.revision;

      try {
        const payload = toSavePayload(state, target);
        const { post } = state.group
          ? await api<{ post: PostDetail }>(`/posts/${state.group}`, {
              method: 'PUT',
              body: payload,
            })
          : await api<{ post: PostDetail }>('/posts', { method: 'POST', body: payload });

        dispatch({ type: 'saved', post, revision });
        announcePostsChanged();

        // The URL gains the group so a reload reopens this post. History is
        // replaced directly rather than navigated: a navigation would remount
        // the composer, and with it every editor, cursor and undo stack.
        if (!state.group) {
          window.history.replaceState(null, '', `/${orgId}/composer?group=${post.group}`);
        }

        toast({
          title: target === 'QUEUE' ? 'Added to the queue' : 'Draft saved',
          description:
            target === 'QUEUE' && publishDate
              ? `Scheduled for ${publishDate.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.`
              : undefined,
        });
      } catch (cause) {
        const message =
          cause instanceof ApiError
            ? cause.message
            : 'The post could not be saved. Please try again.';
        setNotice(
          cause instanceof ApiError && cause.status === 409 && !locked
            ? { kind: 'conflict', message }
            : { kind: 'error', message },
        );
      } finally {
        setSaving(null);
      }
    },
    [state, blockers, publishDate, orgId, toast, locked],
  );

  // Warn before losing unsaved work to a closed tab or a reload.
  useEffect(() => {
    if (!dirty) {
      return;
    }

    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Ctrl/⌘+S saves a draft, as it does in every other editor.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!saving && !locked) {
          void save(state.savedState === 'QUEUE' ? 'QUEUE' : 'DRAFT');
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, saving, locked, state.savedState]);

  async function deletePost() {
    if (!state.group) {
      return;
    }

    try {
      await api(`/posts/${state.group}`, { method: 'DELETE' });
      toast({ title: 'Post deleted' });
      announcePostsChanged();
      close();
    } catch (cause) {
      setNotice({
        kind: 'error',
        message: cause instanceof ApiError ? cause.message : 'The post could not be deleted.',
      });
    } finally {
      setConfirmDelete(false);
    }
  }

  const pickerPart = pickerFor
    ? partsFor(state, state.scope).find((part) => part.key === pickerFor)
    : undefined;
  const scopeChannel = state.scope === SHARED ? null : channelsById.get(state.scope);
  const queued = state.savedState === 'QUEUE';
  const noChannels = state.selected.length === 0;
  const title = locked ? 'Published Post' : state.group ? 'Edit Post' : 'Create Post';
  const newPostHref = `/${orgId}/composer`;

  const frame = (
    <>
      {/* Two columns on wide screens, each scrolling on its own; one
          scrolling column, preview last, on narrow ones. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pg-scrollbar pg-scrollbar-secondary lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)] lg:overflow-hidden">
        <section aria-label="Write" className="flex min-w-0 flex-col lg:min-h-0">
          <div className="flex h-16 shrink-0 items-center gap-3 border-b-2 border-outline px-5">
            <DialogTitle className="truncate text-xl">{title}</DialogTitle>
            {state.group ? (
              <Badge variant={locked ? 'success' : queued ? 'primary' : 'outline'}>
                {locked ? 'Published' : queued ? 'Queued' : 'Draft'}
              </Badge>
            ) : null}
            <div className="ms-auto flex shrink-0 items-center gap-2">
              <DraftsButton onClick={() => setDraftsOpen(true)} />
              {state.group ? (
                <a
                  href={newPostHref}
                  onClick={(event) => {
                    event.preventDefault();
                    navigateTo(newPostHref);
                  }}
                  className={buttonVariants({ variant: 'primary', size: 'sm' })}
                >
                  <Plus className="h-4 w-4" strokeWidth={2.5} />
                  New post
                </a>
              ) : null}
            </div>
          </div>

          <div
            className={cn(
              'flex flex-col gap-5 p-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto pg-scrollbar pg-scrollbar-secondary',
              // Fullscreen, the writing keeps a comfortable line length,
              // centred in the wider column, as in Buffer's fullscreen.
              fullscreen && '[&>*]:mx-auto [&>*]:w-full [&>*]:max-w-3xl',
            )}
          >
            {loadError ? <Alert variant="danger">{loadError}</Alert> : null}

            {locked ? (
              <Alert variant="warning">
                This post has been published. It can be read here but no longer changed.
              </Alert>
            ) : null}

            {state.disconnected.length > 0 ? (
              <Alert variant="warning">
                {state.disconnected.map((channel) => channel.name).join(', ')}{' '}
                {state.disconnected.length === 1 ? 'was' : 'were'} disconnected after this post was
                saved and will be removed from it when you save.
              </Alert>
            ) : null}

            <ComposerChannels
              orgId={orgId}
              channels={channels}
              selected={state.selected}
              onToggle={(channelId) => dispatch({ type: 'toggleChannel', channelId })}
              disabled={locked}
            />

            {selectedChannels.length > 0 ? (
              <Tabs
                value={state.scope}
                onValueChange={(scope) => dispatch({ type: 'setScope', scope })}
              >
                {/* The reference's scope tiles: the globe edits the post every
                    channel shares; each selected channel's tile edits that
                    channel's own version, marked with a dot once it has one. */}
                <TabsList className="max-w-full flex-wrap justify-start gap-2 border-0 bg-transparent p-0 shadow-none">
                  <TooltipHint label="All channels: one post for every channel" side="bottom">
                    <TabsTrigger value={SHARED} aria-label="All channels" className={SCOPE_TILE}>
                      <Globe className="h-5 w-5" strokeWidth={2.25} aria-hidden="true" />
                    </TabsTrigger>
                  </TooltipHint>
                  {selectedChannels.map((channel) => {
                    const custom = isCustomized(state, channel.id);
                    return (
                      <TooltipHint
                        key={channel.id}
                        label={
                          custom
                            ? `${channel.name}: its own version`
                            : `${channel.name}: edit its own version`
                        }
                        side="bottom"
                      >
                        <TabsTrigger
                          value={channel.id}
                          aria-label={custom ? `${channel.name}, customized` : channel.name}
                          className={cn(SCOPE_TILE, 'relative')}
                        >
                          <span className="relative" aria-hidden="true">
                            <Avatar className="h-7 w-7 border">
                              {channel.picture ? (
                                <AvatarImage src={channel.picture} alt="" />
                              ) : null}
                              <AvatarFallback className="text-[9px]">
                                {channel.name.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="absolute -end-1 -bottom-1 rounded-sm bg-secondary p-px">
                              <PlatformIcon
                                platform={channel.providerIdentifier}
                                className="h-3 w-3"
                              />
                            </span>
                          </span>
                          {custom ? (
                            <span
                              aria-hidden="true"
                              className="absolute -end-1 -top-1 h-3 w-3 rounded-full border-2 border-outline bg-actionSecondary"
                            />
                          ) : null}
                        </TabsTrigger>
                      </TooltipHint>
                    );
                  })}
                </TabsList>
              </Tabs>
            ) : null}

            {scopeChannel && !isCustomized(state, scopeChannel.id) ? (
              <div className="flex flex-col items-start gap-3 rounded-lg border-2 border-dashed border-ink/30 p-5">
                <p className="m-0 font-sans text-sm text-ink">
                  <strong className="type-ui">{scopeChannel.name}</strong> uses the post written
                  under “All channels”.
                </p>
                <p className="m-0 font-sans text-sm text-ink opacity-70">
                  Customize it to give {scopeChannel.providerName} its own wording, media or thread.
                  Changes to the shared post will then stop applying here.
                </p>
                <Button
                  size="sm"
                  onClick={() => dispatch({ type: 'customize', channelId: scopeChannel.id })}
                  disabled={locked}
                >
                  Customize for {scopeChannel.name}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {scopeChannel ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant="secondary">Custom for {scopeChannel.name}</Badge>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setConfirmUseShared(scopeChannel.id)}
                      disabled={locked}
                    >
                      Use the shared post instead
                    </Button>
                  </div>
                ) : state.selected.some((id) => isCustomized(state, id)) ? (
                  <p className="m-0 font-sans text-xs text-ink opacity-70">
                    Channels with their own version ignore changes made here.
                  </p>
                ) : null}

                <ThreadEditor
                  key={state.scope}
                  scope={state.scope}
                  scopeLabel={scopeChannel ? scopeChannel.name : 'the shared post'}
                  parts={partsFor(state, state.scope)}
                  reports={scopeReports}
                  dispatch={dispatch}
                  onAttachMedia={setPickerFor}
                  disabled={locked}
                />
              </div>
            )}
          </div>
        </section>

        <aside
          aria-label="Post preview"
          className="flex min-w-0 flex-col border-t-2 border-outline bg-primary lg:min-h-0 lg:border-t-0 lg:border-s-2"
        >
          <div className="flex h-16 shrink-0 items-center gap-3 border-b-2 border-outline px-5">
            <h3 className="m-0 min-w-0 flex-1 truncate type-heading text-xl text-ink">
              Post Preview
            </h3>
            <TooltipHint label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} side="bottom">
              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                aria-pressed={fullscreen}
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-secondary text-ink hover:bg-actionPrimary/10',
                  FOCUS,
                )}
              >
                {fullscreen ? (
                  <Minimize2 className="h-4 w-4" strokeWidth={2.5} />
                ) : (
                  <Maximize2 className="h-4 w-4" strokeWidth={2.5} />
                )}
              </button>
            </TooltipHint>
            <TooltipHint label="Close" side="bottom" align="end">
              <button
                type="button"
                onClick={requestClose}
                aria-label="Close composer"
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-secondary text-ink hover:bg-actionPrimary/10',
                  FOCUS,
                )}
              >
                <X className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </TooltipHint>
          </div>
          <div className="p-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto pg-scrollbar pg-scrollbar-primary">
            <PreviewPanel
              reports={reports}
              publishAt={publishDate}
              focusChannelId={state.scope === SHARED ? null : state.scope}
            />
          </div>
        </aside>
      </div>

      {notice ? (
        <div className="shrink-0 border-t-2 border-outline px-5 py-3">
          {notice.kind === 'blockers' ? (
            <Alert variant="danger">
              {/* Alert lays its children out in a row, for an icon beside content. */}
              <div className="flex flex-col gap-1">
                <AlertTitle>Not ready for the queue yet</AlertTitle>
                <ul className="m-0 list-disc ps-5">
                  {notice.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <span>It can still be saved as a draft.</span>
              </div>
            </Alert>
          ) : notice.kind === 'conflict' ? (
            <Alert variant="danger">
              {notice.message}{' '}
              <button
                type="button"
                className="font-bold underline"
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
            </Alert>
          ) : (
            <Alert variant="danger">{notice.message}</Alert>
          )}
        </div>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center gap-3 border-t-2 border-outline px-5 py-4">
        <p aria-live="polite" className="m-0 me-auto flex flex-col font-sans text-xs text-ink">
          <span className="opacity-70">
            {saving
              ? 'Saving…'
              : dirty
                ? 'Unsaved changes'
                : state.group
                  ? 'All changes saved'
                  : ''}
          </span>
          {blockers.length > 0 && selectedChannels.length > 0 ? (
            <span className="text-actionDanger">
              {blockers.length} {blockers.length === 1 ? 'issue' : 'issues'} to fix before queueing
            </span>
          ) : null}
        </p>

        {state.group && !locked ? (
          // A quiet text action, as in the reference: deleting is rarer than
          // saving, and a confirmation follows.
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className={cn(
              'flex h-11 items-center gap-2 rounded-md px-2 type-ui text-sm text-actionDanger hover:bg-actionDanger/10',
              FOCUS,
            )}
          >
            <Trash2 className="h-4 w-4" strokeWidth={2.5} />
            Delete Post
          </button>
        ) : null}

        <PublishAt
          value={state.publishAt}
          onChange={(value) => dispatch({ type: 'setPublishAt', value })}
          disabled={locked}
        />

        {/* Nothing to save until there is somewhere to post it: the main
            button says so, the reference's "check the circles above". */}
        <Button
          variant="secondary"
          onClick={() => void save('DRAFT')}
          disabled={saving !== null || locked || noChannels}
        >
          {saving === 'DRAFT' ? 'Saving…' : queued ? 'Move to drafts' : 'Save draft'}
        </Button>
        <Button
          onClick={() => void save('QUEUE')}
          disabled={saving !== null || locked || noChannels}
          className="min-w-44"
        >
          {saving === 'QUEUE'
            ? 'Saving…'
            : noChannels
              ? 'Pick a channel above'
              : queued
                ? 'Update queue'
                : 'Add to queue'}
        </Button>
      </div>

      <MediaPickerDialog
        open={pickerFor !== null}
        onOpenChange={(open) => !open && setPickerFor(null)}
        alreadyAttached={pickerPart?.media.map((item) => item.id) ?? []}
        remaining={MAX_MEDIA_PER_PART - (pickerPart?.media.length ?? 0)}
        onAttach={(media) => {
          if (pickerFor) {
            dispatch({ type: 'attachMedia', scope: state.scope, key: pickerFor, media });
          }
        }}
      />

      <DraftsSheet
        orgId={orgId}
        open={draftsOpen}
        onOpenChange={setDraftsOpen}
        currentGroup={state.group}
        onNavigate={navigateTo}
      />

      <Confirm
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this post?"
        description={`It is removed for every channel${queued ? ' and taken out of the queue' : ''}. This cannot be undone.`}
        cancel="Keep it"
        action="Delete"
        onAction={() => void deletePost()}
      />

      <Confirm
        open={confirmUseShared !== null}
        onOpenChange={(open) => !open && setConfirmUseShared(null)}
        title={`Discard the custom version for ${confirmUseShared ? (channelsById.get(confirmUseShared)?.name ?? '') : ''}?`}
        description="The channel goes back to the post written under “All channels”, and its own wording and media are removed."
        cancel="Keep custom version"
        action="Use shared post"
        onAction={() => {
          if (confirmUseShared) {
            dispatch({ type: 'useShared', channelId: confirmUseShared });
          }
          setConfirmUseShared(null);
        }}
      />

      <Confirm
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Close without saving?"
        description="What you have written since the last save will be lost."
        cancel="Keep writing"
        action="Discard changes"
        onAction={() => {
          setConfirmClose(false);
          close();
        }}
      />
    </>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent
        hideClose
        aria-describedby={undefined}
        // A stray click beside the card must not end the writing; closing is
        // the X, Escape, or the browser's back button.
        onInteractOutside={(event) => event.preventDefault()}
        // Focus the card itself rather than its first button: on a reload the
        // browser counts that as keyboard focus and rings "Saved posts", as if
        // it had been chosen. Tab still starts from the top of the card.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
        data-fullscreen={fullscreen || undefined}
        className={cn(
          'flex flex-col gap-0 overflow-hidden p-0',
          'transition-[width,height,max-width,max-height,border-radius] duration-200 ease-out motion-reduce:transition-none',
          fullscreen
            ? 'h-dvh max-h-none w-screen max-w-none rounded-none border-0 shadow-none'
            : 'h-[calc(100dvh-2rem)] max-h-[62rem] w-[calc(100%-2rem)] max-w-[88rem] rounded-2xl',
        )}
      >
        {frame}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The publish time, as the reference's date button: a calendar icon and the
 * local date and time; it opens the design system's calendar with time keys
 * beside it (DateTimePicker). The composer keeps the time as a local
 * `YYYY-MM-DDTHH:mm` string, converted at this edge.
 */
function PublishAt({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <DateTimePicker
      id="composer-publish-at"
      label="Publish at"
      value={isValidPublishAt(value) ? new Date(value) : null}
      onValueChange={(date) => onChange(toLocalInputValue(date))}
      disabled={disabled}
      side="top"
      align="end"
      footnote={`Your local time, ${Intl.DateTimeFormat().resolvedOptions().timeZone}`}
    />
  );
}

/** A yes-or-no question before something that cannot be undone. */
function Confirm({
  open,
  onOpenChange,
  title,
  description,
  cancel,
  action,
  onAction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  cancel: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancel}</AlertDialogCancel>
          <AlertDialogAction variant="danger" onClick={onAction}>
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
