'use client';

/**
 * The post composer.
 *
 * ## A page, not a modal
 *
 * The reference composes in a modal over the calendar. PostGear's route was
 * already scaffolded at `/[orgId]/composer`, and a page earns its keep here: a
 * draft has a URL (`?group=`), so it can be bookmarked, reopened after a
 * reload, and linked from the media library's "Use in a post". Sprint 5's
 * calendar can link into the same page with a time prefilled.
 *
 * ## Layout
 *
 * Channels, then the writing — one shared thread with a tab per selected
 * channel for overrides — then the schedule and the save actions. The live
 * preview sits beside it on wide screens and below it on narrow ones.
 *
 * ## Saving
 *
 * "Save draft" accepts anything well-formed. "Add to queue" first runs the
 * same checks the API will, and shows every blocker at once rather than
 * sending a request to learn about them one at a time; the API still has the
 * final say, and its message is shown if it disagrees.
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
  Badge,
  Button,
  buttonVariants,
  FormField,
  FormHelperText,
  FormLabel,
  Heading,
  Input,
  PageHeader,
  Stack,
  Tabs,
  TabsList,
  TabsTrigger,
  Text,
  useToast,
} from '@postgear/ui';
import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Channel, ProviderSummary } from '@/types/channel';
import type { MediaItem } from '@/types/media';
import type { PostDetail } from '@/types/post';
import { buildReport, queueBlockers } from './channel-report';
import { ChannelPicker } from './channel-picker';
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
  toSavePayload,
} from './composer-state';
import { DraftsButton, DraftsSheet } from './drafts-sheet';
import { MediaPickerDialog } from './media-picker-dialog';
import { PreviewPanel } from './preview-panel';
import { ThreadEditor } from './thread-editor';

interface ComposerProps {
  orgId: string;
  channels: Channel[];
  providers: ProviderSummary[];
  initialPost: PostDetail | null;
  initialMedia: MediaItem | null;
  /** Set when `?group=` named a post that could not be loaded. */
  loadError: string | null;
}

type Notice =
  | { kind: 'error'; message: string }
  | { kind: 'conflict'; message: string }
  | { kind: 'blockers'; items: string[] };

export function Composer({
  orgId,
  channels,
  providers,
  initialPost,
  initialMedia,
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
    }),
  );

  const [saving, setSaving] = useState<'DRAFT' | 'QUEUE' | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmUseShared, setConfirmUseShared] = useState<string | null>(null);

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
      router.push(`/${orgId}/composer`);
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

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_28rem]">
      <Stack gap="lg" className="min-w-0">
        <PageHeader
          title={state.group ? 'Edit post' : 'New post'}
          description="Write once, adjust per channel, and see it the way each platform will show it."
          actions={
            <>
              <DraftsButton onClick={() => setDraftsOpen(true)} />
              {state.group ? (
                <Link
                  href={`/${orgId}/composer`}
                  className={buttonVariants({ variant: 'primary' })}
                >
                  <Plus className="h-4 w-4" strokeWidth={2.5} />
                  New post
                </Link>
              ) : null}
            </>
          }
        />

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

        <section aria-labelledby="composer-channels-heading" className="flex flex-col gap-3">
          <Heading level="h4" as="h2" id="composer-channels-heading">
            Post to
          </Heading>
          <ChannelPicker
            orgId={orgId}
            channels={channels}
            selected={state.selected}
            onToggle={(channelId) => dispatch({ type: 'toggleChannel', channelId })}
          />
        </section>

        <section aria-label="Content" className="flex flex-col gap-4">
          {selectedChannels.length > 0 ? (
            <Tabs
              value={state.scope}
              onValueChange={(scope) => dispatch({ type: 'setScope', scope })}
            >
              <TabsList className="flex-wrap">
                <TabsTrigger value={SHARED}>All channels</TabsTrigger>
                {selectedChannels.map((channel) => (
                  <TabsTrigger key={channel.id} value={channel.id} className="gap-1.5">
                    {channel.name}
                    {isCustomized(state, channel.id) ? (
                      <span className="rounded-full bg-actionSecondary px-1.5 font-sans text-[10px] font-bold normal-case text-onActionLight">
                        custom
                      </span>
                    ) : null}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : null}

          {scopeChannel && !isCustomized(state, scopeChannel.id) ? (
            <div className="flex flex-col items-start gap-3 rounded-lg border-4 border-dashed border-outline p-5">
              <Text>
                <strong>{scopeChannel.name}</strong> uses the post written under “All channels”.
              </Text>
              <Text size="sm" muted>
                Customize it to give {scopeChannel.providerName} its own wording, media or thread.
                Changes to the shared post will then stop applying here.
              </Text>
              <Button
                onClick={() => dispatch({ type: 'customize', channelId: scopeChannel.id })}
                disabled={locked}
              >
                Customize for {scopeChannel.name}
              </Button>
            </div>
          ) : (
            <>
              {scopeChannel ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant="secondary">Custom for {scopeChannel.name}</Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setConfirmUseShared(scopeChannel.id)}
                  >
                    Use the shared post instead
                  </Button>
                </div>
              ) : state.selected.some((id) => isCustomized(state, id)) ? (
                <Text size="sm" muted>
                  Channels with their own version ignore changes made here.
                </Text>
              ) : null}

              <ThreadEditor
                key={state.scope}
                scope={state.scope}
                scopeLabel={scopeChannel ? scopeChannel.name : 'the shared post'}
                parts={partsFor(state, state.scope)}
                reports={scopeReports}
                dispatch={dispatch}
                onAttachMedia={setPickerFor}
              />
            </>
          )}
        </section>

        <section
          aria-label="Schedule and save"
          className="flex flex-col gap-4 rounded-lg border-4 border-outline bg-secondary p-5 shadow-brutalMd"
        >
          <FormField className="max-w-xs">
            <FormLabel htmlFor="composer-publish-at">Publish at</FormLabel>
            <Input
              id="composer-publish-at"
              type="datetime-local"
              value={state.publishAt}
              onChange={(event) => dispatch({ type: 'setPublishAt', value: event.target.value })}
              disabled={locked}
            />
            <FormHelperText>
              Your local time ({Intl.DateTimeFormat().resolvedOptions().timeZone}).
            </FormHelperText>
          </FormField>

          {notice?.kind === 'blockers' ? (
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
          ) : notice?.kind === 'conflict' ? (
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
          ) : notice?.kind === 'error' ? (
            <Alert variant="danger">{notice.message}</Alert>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => void save('DRAFT')}
              disabled={saving !== null || locked}
            >
              {saving === 'DRAFT' ? 'Saving…' : queued ? 'Move to drafts' : 'Save draft'}
            </Button>
            <Button onClick={() => void save('QUEUE')} disabled={saving !== null || locked}>
              {saving === 'QUEUE' ? 'Saving…' : queued ? 'Update queue' : 'Add to queue'}
            </Button>

            <Text size="sm" muted aria-live="polite" className="me-auto">
              {saving
                ? 'Saving…'
                : dirty
                  ? 'Unsaved changes'
                  : state.group
                    ? queued
                      ? 'Queued · all changes saved'
                      : 'Draft · all changes saved'
                    : ''}
              {blockers.length > 0 && selectedChannels.length > 0
                ? ` · ${blockers.length} ${blockers.length === 1 ? 'issue' : 'issues'} to fix before queueing`
                : ''}
            </Text>

            {state.group && !locked ? (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                aria-label="Delete post"
              >
                <Trash2 className="h-4 w-4" strokeWidth={2.5} />
              </Button>
            ) : null}
          </div>
        </section>
      </Stack>

      <aside className="min-w-0 xl:sticky xl:top-0 xl:self-start">
        <PreviewPanel
          reports={reports}
          publishAt={publishDate}
          focusChannelId={state.scope === SHARED ? null : state.scope}
        />
      </aside>

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
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this post?</AlertDialogTitle>
            <AlertDialogDescription>
              It is removed for every channel{queued ? ' and taken out of the queue' : ''}. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="danger" onClick={() => void deletePost()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmUseShared !== null}
        onOpenChange={(open) => !open && setConfirmUseShared(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Discard the custom version for{' '}
              {confirmUseShared ? channelsById.get(confirmUseShared)?.name : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The channel goes back to the post written under “All channels”, and its own wording
              and media are removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep custom version</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              onClick={() => {
                if (confirmUseShared) {
                  dispatch({ type: 'useShared', channelId: confirmUseShared });
                }
                setConfirmUseShared(null);
              }}
            >
              Use shared post
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
