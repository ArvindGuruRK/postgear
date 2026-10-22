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
 * The URL still names what is open (`/composer?group=`, `?at=`, `?media=`,
 * `?template=`), so a post can be reloaded, bookmarked and linked. It opens two ways:
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
 * The footer follows the reference's (2026-10-19): Tags and Repeat on the
 * left; Delete, the time, "Save as draft" and the main button on the right.
 * The main button says what it will do: "Add to calendar" for a new post,
 * "Schedule" for a draft, "Update" for a queued post; its chevron offers
 * "Post now", which queues the post for this moment and publishes it at once.
 *
 * "Save as draft" accepts anything well-formed. The main button and Post now
 * first run the same checks the API will. A platform setting that is
 * missing or wrong is named in a toast ("YouTube (Acme): ..."), and the
 * composer opens that channel's tab and its Settings bar with the message
 * under the field, as the reference does; content problems are listed all
 * at once rather than learned from the API one request at a time. The API
 * still has the final say, and its message is shown if it disagrees. A save
 * or delete is announced (`announcePostsChanged`), so the calendar or queue
 * under the modal shows it at once.
 */
import { ChevronDownIcon } from '@animateicons/react/lucide/chevron-down-icon';
import { ExpandIcon } from '@animateicons/react/lucide/expand-icon';
import { GlobeIcon } from '@animateicons/react/lucide/globe-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { SendIcon } from '@animateicons/react/lucide/send-icon';
import { ShrinkIcon } from '@animateicons/react/lucide/shrink-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
import {
  documentFromText,
  settingsFieldsFor,
  validateProviderSettings,
} from '@postgear/social-core/composer';
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
  ANIMATED_ICON_CLASS,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MotionIcon,
  Tabs,
  TabsList,
  TabsTrigger,
  TooltipHint,
  useIconAnimation,
  useToast,
} from '@postgear/ui';
import type { Editor } from '@tiptap/react';
import { useRouter } from 'next/navigation';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { PlatformIcon } from '@/components/platforms/platform-icon';
import { ApiError, api } from '@/lib/api';
import { announcePostsChanged } from '@/lib/post-events';
import type { Channel, ProviderSummary } from '@/types/channel';
import type { MediaItem } from '@/types/media';
import type { PostDetail, PostPart } from '@/types/post';
import { buildReport, queueBlockers, renderDraftParts } from './channel-report';
import { ComposerChannels } from './composer-channels';
import { RepeatControl } from './composer-repeat';
import { SettingsBar, type SettingsBlock } from './composer-settings';
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
  settingsOf,
  toLocalInputValue,
  toSavePayload,
} from './composer-state';
import { TagsControl } from './composer-tags';
import { TemplatesButton } from './composer-templates';
import { DraftsButton, DraftsSheet } from './drafts-sheet';
import { insertParagraphs } from './editor-inserts';
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
  /** Text to start a new post with: a starter template picked on Home. */
  initialText?: string | null;
  /** Parts to start a new post with: a duplicated post's (`?duplicate=`). */
  initialParts?: PostPart[] | null;
  /** A channel to start a new post with (`?channel=`). */
  initialChannelId?: string | null;
  /** The default signature for a new blank post. */
  initialSignature?: string | null;
  /** Set when `?group=` or `?duplicate=` named a post that could not be loaded. */
  loadError: string | null;
  /** A new post's first save: it is now the saved post `group`. */
  onCreated?: (group: string) => void;
}

type Notice =
  | { kind: 'error'; message: string }
  | { kind: 'conflict'; message: string }
  | { kind: 'blockers'; items: string[] };

const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

const FULLSCREEN_KEY = 'postgear:composer-fullscreen';

/** Each screen edge's notch or home-indicator inset; 0 on screens without one. */
const SAFE_AREA_PADDING =
  'pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]';

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
  initialText = null,
  initialParts = null,
  initialChannelId = null,
  initialSignature = null,
  loadError,
  onCreated,
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
      text: initialText,
      parts: initialParts,
      channelId: initialChannelId,
      signature: initialSignature,
    }),
  );

  /** Which action is in flight: a draft, the main button, or Post now. */
  const [saving, setSaving] = useState<'DRAFT' | 'QUEUE' | 'NOW' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Settings problems found before a save, by channel id and field key. */
  const [settingsErrors, setSettingsErrors] = useState<Record<string, Record<string, string>>>({});
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
  // The resize animates only once the person has used the button: restoring
  // the saved preference on open should land in place, not grow in front of
  // them.
  const [resizeAnimated, setResizeAnimated] = useState(false);
  const fullscreenIcon = useIconAnimation();
  const deleteIcon = useIconAnimation();
  const shownFullscreen = useRef(fullscreen);

  useEffect(() => {
    try {
      setFullscreen(window.localStorage.getItem(FULLSCREEN_KEY) === 'true');
    } catch {
      // Storage unavailable (private mode, blocked site data): windowed.
    }
  }, []);

  // The icon that takes over on a toggle plays as the card resizes.
  useEffect(() => {
    if (shownFullscreen.current !== fullscreen) {
      shownFullscreen.current = fullscreen;
      if (resizeAnimated) {
        fullscreenIcon.play();
      }
    }
  }, [fullscreen, resizeAnimated, fullscreenIcon.play]);

  const toggleFullscreen = useCallback(() => {
    setResizeAnimated(true);
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

  const selectedChannels = useMemo(
    () => state.selected.flatMap((id) => channelsById.get(id) ?? []),
    [state.selected, channelsById],
  );

  // Every mounted part editor, by part key, and the one that last had focus:
  // where the header's Templates writes. Editors are uncontrolled (see
  // composer-state.ts), so writing into a mounted one goes through it.
  const editors = useRef(new Map<string, Editor>());
  const focusedPart = useRef<string | null>(null);
  const onEditor = useCallback((key: string, editor: Editor | null) => {
    if (editor) {
      editors.current.set(key, editor);
    } else {
      editors.current.delete(key);
    }
  }, []);
  const onEditorFocus = useCallback((key: string) => {
    focusedPart.current = key;
  }, []);

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
  // With no channel connected the post can still be written and previewed
  // (2026-10-21): only saving and scheduling wait, via `noChannels` below.
  // What the right-hand preview shows then is the general one.
  const draftParts = useMemo(
    () => (channels.length === 0 ? renderDraftParts(partsFor(state, SHARED)) : null),
    [channels.length, state],
  );

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

  /**
   * Shows a platform setting problem where it can be fixed, as the reference
   * does: that channel's tab, its Settings bar open.
   */
  const showSettingsOf = useCallback((channelId: string) => {
    dispatch({ type: 'setScope', scope: channelId });
    setSettingsOpen(true);
  }, []);

  const save = useCallback(
    async (target: 'DRAFT' | 'QUEUE', options: { publishNow?: boolean } = {}) => {
      const publishNow = target === 'QUEUE' && options.publishNow === true;
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
        // Every selected channel's settings, checked the way the API will;
        // the first problem is the one shown and navigated to.
        const errors: Record<string, Record<string, string>> = {};
        let first: { channel: Channel; message: string } | null = null;

        for (const channel of selectedChannels) {
          if (settingsFieldsFor(channel.providerIdentifier).length === 0) {
            continue;
          }
          const { issues } = validateProviderSettings(
            channel.providerIdentifier,
            settingsOf(state, channel.id),
            'queue',
          );
          if (issues.length > 0) {
            errors[channel.id] = Object.fromEntries(
              issues.map((issue) => [issue.key, issue.message]),
            );
            first ??= { channel, message: issues[0].message };
          }
        }

        setSettingsErrors(errors);

        if (first) {
          toast({
            variant: 'danger',
            title: `${first.channel.providerName} (${first.channel.name}): ${first.message}`,
          });
          showSettingsOf(first.channel.id);
          return;
        }

        const problems = [
          // Post now publishes at this moment, whatever time is picked.
          ...(!publishNow && publishDate && publishDate.getTime() <= Date.now()
            ? ['Choose a time in the future to add this post to the calendar.']
            : []),
          ...blockers,
        ];

        if (problems.length > 0) {
          setNotice({ kind: 'blockers', items: problems });
          return;
        }
      }

      setSaving(publishNow ? 'NOW' : target);
      const revision = state.revision;
      const wasQueued = state.savedState === 'QUEUE';

      try {
        const payload = toSavePayload(state, target, { publishNow });
        const { post } = state.group
          ? await api<{ post: PostDetail }>(`/posts/${state.group}`, {
              method: 'PUT',
              body: payload,
            })
          : await api<{ post: PostDetail }>('/posts', { method: 'POST', body: payload });

        dispatch({ type: 'saved', post, revision });
        announcePostsChanged();

        if (publishNow) {
          // Out of the writer's hands now, as in the reference: the
          // calendar shows how it goes.
          toast({
            title: 'Publishing now',
            description: 'It goes out to each channel in a moment.',
          });
          close();
          return;
        }

        // The URL gains the group so a reload reopens this post. History is
        // replaced directly rather than navigated: a navigation would remount
        // the composer, and with it every editor, cursor and undo stack.
        if (!state.group) {
          window.history.replaceState(null, '', `/${orgId}/composer?group=${post.group}`);
          onCreated?.(post.group);
        }

        toast({
          title:
            target === 'DRAFT'
              ? 'Draft saved'
              : !state.group
                ? 'Added to the calendar'
                : wasQueued
                  ? 'Post updated'
                  : 'Scheduled',
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

        // The API's settings check names the channel ("YouTube (Acme): ..."):
        // the same toast as the composer's own, and the same way to the field.
        if (cause instanceof ApiError && cause.status === 400) {
          toast({ variant: 'danger', title: message });
          const named = selectedChannels.find(
            (channel) =>
              message.includes(`(${channel.name}):`) &&
              settingsFieldsFor(channel.providerIdentifier).length > 0,
          );
          if (named) {
            showSettingsOf(named.id);
          }
          return;
        }

        setNotice(
          cause instanceof ApiError && cause.status === 409 && !locked
            ? { kind: 'conflict', message }
            : { kind: 'error', message },
        );
      } finally {
        setSaving(null);
      }
    },
    [
      state,
      selectedChannels,
      blockers,
      publishDate,
      orgId,
      toast,
      locked,
      onCreated,
      close,
      showSettingsOf,
    ],
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
  const busy = saving !== null;
  const primaryLabel =
    saving === 'QUEUE'
      ? 'Saving…'
      : saving === 'NOW'
        ? 'Publishing…'
        : noChannels
          ? channels.length === 0
            ? 'Connect a channel first'
            : 'Pick a channel above'
          : !state.group
            ? 'Add to calendar'
            : queued
              ? 'Update'
              : 'Schedule';

  /**
   * A starter template from the header: into the part being written (the
   * last one focused, or the first), filling it when empty and going in at
   * the cursor otherwise. A channel tab that follows the shared post has no
   * editor of its own, so the words go to the shared post, and the tab with
   * them.
   */
  function applyTemplate(text: string) {
    if (!scopeChannel || isCustomized(state, scopeChannel.id)) {
      const parts = partsFor(state, state.scope);
      const key = parts.find((part) => part.key === focusedPart.current)?.key ?? parts[0]?.key;
      const editor = key ? editors.current.get(key) : undefined;

      if (editor) {
        if (editor.isEmpty) {
          editor.chain().focus().setContent(documentFromText(text)).run();
        } else {
          insertParagraphs(editor, text);
        }
        return;
      }
    }

    dispatch({ type: 'insertText', scope: SHARED, key: state.shared[0].key, text });
    dispatch({ type: 'setScope', scope: SHARED });
  }

  // The Settings bar: the open channel's fields, or on All channels every
  // selected channel's that has any. No fields, no bar.
  const settingsBlocks: SettingsBlock[] = (scopeChannel ? [scopeChannel] : selectedChannels)
    .map((channel) => ({
      channel,
      fields: settingsFieldsFor(channel.providerIdentifier),
      values: settingsOf(state, channel.id),
      errors: settingsErrors[channel.id] ?? {},
    }))
    .filter((block) => block.fields.length > 0);

  function changeSetting(channelId: string, key: string, value: unknown) {
    dispatch({ type: 'setSetting', channelId, key, value });
    // Changing a field answers its problem; the next save checks again.
    setSettingsErrors((current) => {
      if (!current[channelId]?.[key]) {
        return current;
      }
      const { [key]: _answered, ...rest } = current[channelId];
      return { ...current, [channelId]: rest };
    });
  }

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
              <TemplatesButton onPick={applyTemplate} disabled={locked} />
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
                  <MotionIcon icon={PlusIcon} className="h-4 w-4" />
                  New post
                </a>
              ) : null}
              {/* Stacked (below lg), the preview's header is under the
                  editor, so its Close would be out of sight: it moves here. */}
              <TooltipHint label="Close" side="bottom" align="end">
                <button
                  type="button"
                  onClick={requestClose}
                  aria-label="Close composer"
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-secondary text-ink hover:bg-actionPrimary/10 lg:hidden',
                    FOCUS,
                  )}
                >
                  <MotionIcon icon={XIcon} className="h-4 w-4" />
                </button>
              </TooltipHint>
            </div>
          </div>

          <div
            className={cn(
              'flex flex-col gap-5 p-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto pg-scrollbar pg-scrollbar-secondary',
              // Fullscreen, the writing keeps a comfortable line length,
              // centred in the wider column, as in Buffer's fullscreen. The
              // width eases between 100% and 48rem with the card (a jump to or
              // from `none` could not), so the column narrows as it grows.
              '[&>*]:mx-auto [&>*]:w-full',
              fullscreen ? '[&>*]:max-w-3xl' : '[&>*]:max-w-full',
              resizeAnimated &&
                '[&>*]:transition-[max-width] [&>*]:duration-400 [&>*]:ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:[&>*]:transition-none',
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
              providers={providers}
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
                  <TooltipHint label="All Channels: One Post For Every Channel" side="bottom">
                    <TabsTrigger value={SHARED} aria-label="All channels" className={SCOPE_TILE}>
                      <MotionIcon
                        icon={GlobeIcon}
                        size={20}
                        strokeWidth={2.25}
                        className="h-5 w-5"
                      />
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
                              <AvatarFallback
                                colorSeed={channel.color ?? channel.id}
                                className="text-[9px]"
                              >
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
                  Customize For {scopeChannel.name}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {scopeChannel ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant="secondary">Custom For {scopeChannel.name}</Badge>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setConfirmUseShared(scopeChannel.id)}
                      disabled={locked}
                    >
                      Use The Shared Post Instead
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
                  signaturesHref={`/${orgId}/settings/signatures`}
                  onEditor={onEditor}
                  onEditorFocus={onEditorFocus}
                />
              </div>
            )}
          </div>

          {settingsBlocks.length > 0 ? (
            <div
              className={cn(
                'flex min-h-0 shrink-0 flex-col px-5 pb-5',
                // Centred with the writing in fullscreen: see above.
                '[&>*]:mx-auto [&>*]:w-full',
                fullscreen ? '[&>*]:max-w-3xl' : '[&>*]:max-w-full',
                resizeAnimated &&
                  '[&>*]:transition-[max-width] [&>*]:duration-400 [&>*]:ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:[&>*]:transition-none',
              )}
            >
              <SettingsBar
                title={scopeChannel ? `${scopeChannel.name} Settings` : 'Settings'}
                blocks={settingsBlocks}
                headed={!scopeChannel}
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                onChange={changeSetting}
                disabled={locked}
              />
            </div>
          ) : null}
        </section>

        <aside
          aria-label="Post preview"
          className="flex min-w-0 flex-col border-t-2 border-outline bg-primary lg:min-h-0 lg:border-t-0 lg:border-s-2"
        >
          <div className="flex h-16 shrink-0 items-center gap-3 border-b-2 border-outline px-5">
            <h3 className="m-0 min-w-0 flex-1 truncate type-heading text-xl text-ink">
              Post Preview
            </h3>
            <TooltipHint label={fullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'} side="bottom">
              <button
                type="button"
                onClick={toggleFullscreen}
                {...fullscreenIcon.triggers}
                aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                aria-pressed={fullscreen}
                className={cn(
                  // Phones are always full screen, so there is nothing to toggle.
                  'hidden h-9 w-9 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-secondary text-ink hover:bg-actionPrimary/10 md:flex',
                  FOCUS,
                )}
              >
                {fullscreen ? (
                  <ShrinkIcon
                    ref={fullscreenIcon.ref}
                    aria-hidden
                    size={16}
                    className={cn('h-4 w-4', ANIMATED_ICON_CLASS)}
                  />
                ) : (
                  <ExpandIcon
                    ref={fullscreenIcon.ref}
                    aria-hidden
                    size={16}
                    className={cn('h-4 w-4', ANIMATED_ICON_CLASS)}
                  />
                )}
              </button>
            </TooltipHint>
            <TooltipHint label="Close" side="bottom" align="end">
              <button
                type="button"
                onClick={requestClose}
                aria-label="Close composer"
                className={cn(
                  'hidden h-9 w-9 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-secondary text-ink hover:bg-actionPrimary/10 lg:flex',
                  FOCUS,
                )}
              >
                <MotionIcon icon={XIcon} className="h-4 w-4" />
              </button>
            </TooltipHint>
          </div>
          <div className="p-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto pg-scrollbar pg-scrollbar-primary">
            <PreviewPanel
              reports={reports}
              draft={draftParts}
              publishAt={publishDate}
              focusChannelId={state.scope === SHARED ? null : state.scope}
              settings={state.settings}
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

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t-2 border-outline px-5 py-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <TagsControl
            selected={state.tags}
            onChange={(tags) => dispatch({ type: 'setTags', tags })}
            onTagChanged={(tag) => dispatch({ type: 'tagChanged', tag })}
            onTagDeleted={(tagId) => dispatch({ type: 'tagDeleted', tagId })}
            disabled={locked}
          />
          <RepeatControl
            value={state.intervalInDays}
            onChange={(value) => dispatch({ type: 'setRepeat', value })}
            disabled={locked}
          />
        </div>

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
            <span className="text-dangerInk">
              {blockers.length} {blockers.length === 1 ? 'issue' : 'issues'} to fix before
              scheduling
            </span>
          ) : null}
        </p>

        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          {state.group && !locked ? (
            // A quiet text action, as in the reference: deleting is rarer than
            // saving, and a confirmation follows. Its icon alone on a phone.
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              {...deleteIcon.triggers}
              aria-label="Delete Post"
              className={cn(
                'flex h-11 items-center gap-2 rounded-md px-2 type-ui text-sm text-dangerInk hover:bg-actionDanger/10',
                FOCUS,
              )}
            >
              <Trash2Icon
                ref={deleteIcon.ref}
                aria-hidden
                size={16}
                className={cn('h-4 w-4', ANIMATED_ICON_CLASS)}
              />
              <span className="hidden sm:inline">Delete Post</span>
            </button>
          ) : null}

          <PublishAt
            value={state.publishAt}
            onChange={(value) => dispatch({ type: 'setPublishAt', value })}
            disabled={locked}
          />

          {/* Nothing to save until there is somewhere to post it: the main
              button says so, the reference's "check the circles above". */}
          <div className="flex items-center gap-2 sm:gap-3">
            <Button
              variant="secondary"
              onClick={() => void save('DRAFT')}
              disabled={busy || locked || noChannels}
              className="px-4 sm:px-6"
            >
              {saving === 'DRAFT' ? 'Saving…' : queued ? 'Move To Drafts' : 'Save As Draft'}
            </Button>

            {/* The reference's split button: the main action, and a chevron
                for publishing at once. */}
            <div className="flex">
              <Button
                onClick={() => void save('QUEUE')}
                disabled={busy || locked || noChannels}
                className="rounded-e-none px-4 sm:min-w-40 sm:px-6"
              >
                {primaryLabel}
              </Button>
              <DropdownMenu modal>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label="More ways to publish"
                    disabled={busy || locked || noChannels}
                    className="rounded-s-none border-s-0 px-2.5"
                  >
                    <MotionIcon icon={ChevronDownIcon} strokeWidth={3} className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="end" className="w-44">
                  <DropdownMenuItem onSelect={() => void save('QUEUE', { publishNow: true })}>
                    <MotionIcon icon={SendIcon} className="h-4 w-4" />
                    Post Now
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
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
          'flex max-h-none max-w-none flex-col gap-0 overflow-hidden p-0',
          // Both sizes are lengths CSS can blend (a `min()` of viewport units
          // and rems is one px value), so the card grows from and shrinks to
          // its centre; a `max-width: none` at either end would snap instead.
          // Ease-in-out over 400ms: it gathers pace and then settles, so the
          // change reads as one smooth movement rather than a lurch.
          resizeAnimated &&
            'transition-[width,height,border-radius,border-width,box-shadow] duration-400 ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:transition-none',
          // Below `md` the windowed card is full screen too: a 16px margin
          // round a phone's screen buys nothing but a smaller editor. Edge to
          // edge, it pads by the safe-area insets (`viewport-fit=cover`, root
          // layout), so the header clears a notch and the footer the home
          // indicator while the card's surface still fills behind them.
          fullscreen
            ? cn('h-dvh w-screen rounded-none border-0 shadow-none', SAFE_AREA_PADDING)
            : cn(
                'h-dvh w-screen rounded-none border-0 shadow-none',
                SAFE_AREA_PADDING,
                'md:h-[min(calc(100dvh-2rem),62rem)] md:w-[min(calc(100vw-2rem),88rem)] md:rounded-2xl md:border-2 md:p-0 md:shadow-surfaceLg',
              ),
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
