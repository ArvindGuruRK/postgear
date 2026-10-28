'use client';

/**
 * Send To Composer (Sprint 9, DS-8.2): the design as a draft post, its
 * slides attached in order and the caption from Preview, opened in the
 * composer.
 *
 * The person picks the channels the draft starts with, sees the caption
 * they wrote in Preview, and presses Send To Composer. Channels, scheduling
 * and every platform rule stay the composer's, as for any other post (rule
 * 6: one way out), so this dialog asks for nothing more.
 *
 * What is on screen is saved first; the API exports again only if the
 * design changed since its last export, so the progress is the Export
 * dialog's own (`export-dialog.tsx`), then one more step while the draft is
 * made. `onSent` hands the draft's group to the editor, which opens it in
 * the composer. Closing the dialog stops the run, and no draft is made.
 */
import { RotateCcwIcon } from '@animateicons/react/lucide/rotate-ccw-icon';
import { SendIcon } from '@animateicons/react/lucide/send-icon';
import {
  Alert,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormErrorMessage,
  FormHelperText,
  MotionIcon,
  Skeleton,
} from '@postgear/ui';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChannelPicker } from '@/components/composer/channel-picker';
import { ActionLink } from '@/components/home/home-actions';
import { ApiError, api } from '@/lib/api';
import type { Channel, ChannelsResponse } from '@/types/channel';
import type { DesignStatusView } from '@/types/studio';
import { RunFailureAlert, RunPanel, useRunFocus, useStudioRun, WarningList } from './export-dialog';
import { isRunning, SENT_MESSAGE, warningLead, warningLines } from './export-model';
import { INSET } from './studio-ui';

export interface SendDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  designId: string;
  title: string;
  /** The design's caption, written in Preview. */
  caption: string;
  /** Saves what is on screen; false when it could not be saved. */
  flush: () => Promise<boolean>;
  /** What still needs fixing, by slide id, in the engine's sentences. Shown, never blocking. */
  issues: ReadonlyMap<string, readonly string[]>;
  /**
   * The draft exists. `status` is the design's after it (Sent); `revision`
   * is the one its images show, null only if the stream never said.
   */
  onSent: (result: {
    group: string;
    status: DesignStatusView | null;
    revision: number | null;
  }) => void;
  /**
   * The images the draft uses are in Media, exported now or reused. Called
   * before `onSent`, and also when making the draft then fails, so the
   * editor's status never lags the server's.
   */
  onExported?: (result: { status: DesignStatusView; revision: number; mediaIds: string[] }) => void;
}

const CHANNELS_FAILED = 'We could not load your channels. Check your connection and try again.';

export function SendDialog(props: SendDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* Mounted only while open: closing unmounts the run, which stops its stream. */}
      {props.open ? <SendDialogContent {...props} /> : null}
    </Dialog>
  );
}

function SendDialogContent({
  onOpenChange,
  orgId,
  designId,
  title,
  caption,
  flush,
  issues,
  onSent,
  onExported,
}: SendDialogProps) {
  const id = useId();
  const { state, run } = useStudioRun('send');
  const { channels, error: channelsError, reload } = useChannelList();
  const [selected, setSelected] = useState<string[]>([]);
  const [attempted, setAttempted] = useState(false);
  const progressRef = useRef<HTMLElement>(null);
  const outcomeRef = useRef<HTMLDivElement>(null);
  // The latest callbacks, for a stream that outlives the render that started it.
  const handlers = useRef({ flush, onSent, onExported });

  useLayoutEffect(() => {
    handlers.current = { flush, onSent, onExported };
  });

  useRunFocus(state.phase, progressRef, outcomeRef);

  // One connected channel is the obvious choice, so it is picked (as AI
  // Generate does); a choice whose channel has since gone is dropped.
  useEffect(() => {
    if (!channels) return;

    const known = new Set(channels.map((channel) => channel.id));
    const connected = channels.filter((channel) => channel.health === 'connected');

    setSelected((current) => {
      const kept = current.filter((channelId) => known.has(channelId));
      if (kept.length === 0 && connected.length === 1 && connected[0]) return [connected[0].id];
      return kept.length === current.length ? current : kept;
    });
  }, [channels]);

  // A refusal may be a channel that went away meanwhile: show the list as it is now.
  useEffect(() => {
    if (state.failure?.kind === 'refused') reload();
  }, [state.failure, reload]);

  const running = isRunning(state);
  const sent = state.phase === 'sent';
  const failed = state.phase === 'failed';
  const lines = warningLines(issues, state.warnings);
  const noChannels = channels !== null && channels.length === 0;
  const channelError =
    attempted && selected.length === 0 && !noChannels
      ? 'Choose at least one channel for the draft.'
      : null;

  function toggle(channelId: string) {
    setSelected((current) =>
      current.includes(channelId)
        ? current.filter((item) => item !== channelId)
        : [...current, channelId],
    );
  }

  function send() {
    setAttempted(true);
    if (!channels || selected.length === 0) return;

    // The export the draft uses, as `done` reported it; `sent` does not repeat it.
    let exported: { revision: number } | null = null;

    void run({
      path: `/studio/designs/${encodeURIComponent(designId)}/send`,
      body: { channelIds: selected, caption, imageFormat: 'jpeg' },
      flush: () => handlers.current.flush(),
      onEvent: (event) => {
        if (event.type === 'done') {
          exported = { revision: event.revision };
          handlers.current.onExported?.({
            status: event.status,
            revision: event.revision,
            mediaIds: event.mediaIds,
          });
        }
        if (event.type === 'sent') {
          handlers.current.onSent({
            group: event.group,
            // The API marks the design Sent before it reports the draft.
            status: 'SENT',
            revision: exported?.revision ?? null,
          });
        }
      },
    });
  }

  return (
    <DialogContent
      className="max-h-[90vh] max-w-xl overflow-y-auto pg-scrollbar pg-scrollbar-secondary"
      onInteractOutside={(event) => {
        if (running) event.preventDefault();
      }}
      // The channels are still loading as it opens, so its first control is
      // Cancel. The dialog itself takes focus instead (its title and
      // description are read out), and Tab starts from the top.
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        (event.currentTarget as HTMLElement | null)?.focus();
      }}
    >
      <DialogHeader>
        <DialogTitle>Send To Composer</DialogTitle>
        <DialogDescription className="break-words">
          {`${title} becomes a draft post, its slides in order, with your caption. You schedule it in the composer.`}
        </DialogDescription>
      </DialogHeader>

      <div className="mt-5 flex flex-col gap-5">
        {sent ? null : <WarningList lead={warningLead(state)} lines={lines} />}

        {failed ? <RunFailureAlert state={state} alertRef={outcomeRef} /> : null}

        {sent ? (
          <Alert
            ref={outcomeRef}
            tabIndex={-1}
            role="status"
            variant="success"
            className="outline-none"
          >
            <CircleCheck aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={2.5} />
            <span>{SENT_MESSAGE}</span>
          </Alert>
        ) : null}

        {running ? <RunPanel state={state} panelRef={progressRef} /> : null}

        {running || sent ? null : (
          <>
            <section aria-labelledby={`${id}-channels`} className="flex flex-col gap-3">
              <h3 id={`${id}-channels`} className="m-0 type-heading text-base text-ink">
                Channels
              </h3>

              {channelsError ? (
                <Alert variant="danger">
                  <TriangleAlert
                    aria-hidden="true"
                    className="h-5 w-5 shrink-0"
                    strokeWidth={2.5}
                  />
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                    <span className="min-w-0 break-words">{channelsError}</span>
                    <Button variant="secondary" size="sm" onClick={reload}>
                      Try Again
                    </Button>
                  </div>
                </Alert>
              ) : null}

              {channels ? (
                <ChannelPicker
                  orgId={orgId}
                  channels={channels}
                  selected={selected}
                  onToggle={toggle}
                />
              ) : channelsError ? null : (
                <div className="flex flex-wrap gap-2">
                  <p role="status" className="sr-only">
                    Loading your channels…
                  </p>
                  {[0, 1, 2].map((index) => (
                    <Skeleton key={index} className="h-10 w-36 rounded-full" />
                  ))}
                </div>
              )}

              {channelError ? (
                <FormErrorMessage>{channelError}</FormErrorMessage>
              ) : channels && !noChannels ? (
                <FormHelperText>
                  The draft starts with these. You can change them in the composer.
                </FormHelperText>
              ) : null}
            </section>

            <section aria-labelledby={`${id}-caption`} className="flex flex-col gap-2">
              <h3 id={`${id}-caption`} className="m-0 type-heading text-base text-ink">
                Caption
              </h3>
              <div
                className={cn(
                  INSET,
                  'whitespace-pre-wrap break-words p-3 font-sans text-sm text-ink',
                )}
              >
                {caption.trim() ? caption : <span className="type-muted">No caption yet.</span>}
              </div>
              <FormHelperText>To change it, close this and open Preview.</FormHelperText>
            </section>
          </>
        )}
      </div>

      <DialogFooter className="flex-wrap">
        {sent && state.group ? (
          // The editor opens the draft itself; this is the way there if it has not yet.
          <ActionLink
            href={`/${orgId}/composer?group=${encodeURIComponent(state.group)}`}
            className="h-11 px-6 text-sm"
          >
            Open The Draft
          </ActionLink>
        ) : (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {failed ? 'Close' : 'Cancel'}
            </Button>
            {state.failure?.retryable === false ? null : (
              // Stays where it is, disabled, while the run goes: removed, it
              // would leave Cancel under the pointer for a double click's
              // second click, which would stop the send it just started.
              <Button onClick={send} disabled={running || channels === null || noChannels}>
                {failed ? (
                  <MotionIcon key="again" icon={RotateCcwIcon} className="h-4 w-4" />
                ) : (
                  <MotionIcon key="send" icon={SendIcon} className="h-4 w-4" />
                )}
                {running ? 'Sending…' : failed ? 'Try Again' : 'Send To Composer'}
              </Button>
            )}
          </>
        )}
      </DialogFooter>
    </DialogContent>
  );
}

/**
 * The workspace's channels, loaded when the dialog opens (it is mounted
 * only while open), with Try Again after a failure.
 */
function useChannelList() {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the explicit reload trigger
  useEffect(() => {
    let live = true;
    setError(null);

    api<ChannelsResponse>('/channels')
      .then((result) => {
        if (live) setChannels(result.channels);
      })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof ApiError ? cause.message : CHANNELS_FAILED);
      });

    return () => {
      live = false;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);

  return { channels, error, reload };
}
