'use client';

/**
 * Copilot mode: a conversation with an assistant that can act (list the
 * channels, write a post, draft it, make an image).
 *
 * The API is stateless, so this component owns the conversation (see
 * `chat-state.ts`) and sends the recent history with each message. The
 * stream is the same `streamEvents` the generate mode uses; an
 * `AbortController` is the Stop button.
 *
 * The conversation is kept in `sessionStorage` per workspace so a reload, or
 * following a "Drafted a post" row into the composer and coming back, does
 * not start it over. Storage is read once after mount (never during render,
 * where the server has no storage and the markup would differ) and every
 * access is wrapped, because private windows and full quotas both throw.
 */
import { CircleStopIcon } from '@animateicons/react/lucide/circle-stop-icon';
import { SendIcon } from '@animateicons/react/lucide/send-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import { Alert, Button, cn, MotionIcon, Text, Textarea } from '@postgear/ui';
import { Sparkles } from 'lucide-react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { streamEvents } from '@/lib/sse';
import type { AiCredits, CopilotChatBody, CopilotStreamEvent } from '@/types/ai';
import { useWorkspace } from '../navigation/workspace-provider';
import { useMounted } from '../posts/use-mounted';
import { AiSticker, FOCUS, TOOL_ICONS } from './ai-ui';
import { ChatMessage } from './chat-message';
import {
  type ChatAction,
  type ChatEntry,
  chatReducer,
  copilotStorageKey,
  historyFor,
  initialChatState,
  newChatId,
  parseHistory,
  SUGGESTIONS,
  serializeHistory,
} from './chat-state';
import { formatResetDate } from './credits-meter';

const MESSAGE_MAX = 4000;

export function CopilotChat({
  orgId,
  credits,
  onCredits,
}: {
  orgId: string;
  credits: AiCredits | null;
  onCredits: (credits: AiCredits) => void;
}) {
  const { user } = useWorkspace();
  const mounted = useMounted();
  const [state, dispatch] = useReducer(chatReducer, credits, initialChatState);
  const [draft, setDraft] = useState('');
  const controller = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Bring back the conversation from this tab's session, once. The dispatch
  // happens even when nothing is stored: it is what marks the state hydrated.
  useEffect(() => {
    let entries: ChatEntry[] | null = null;
    try {
      entries = parseHistory(window.sessionStorage.getItem(copilotStorageKey(orgId)));
    } catch {
      // No storage (private window, blocked): the conversation starts empty.
    }
    dispatch({ type: 'restore', entries });
  }, [orgId]);

  // Persist after every change, but never before the restore has rendered:
  // `hydrated` is set by the restore dispatch itself, so the mount commit
  // (which StrictMode runs twice) cannot write the empty initial state over
  // what the session held. See `ChatState.hydrated`.
  useEffect(() => {
    if (!state.hydrated) {
      return;
    }
    try {
      window.sessionStorage.setItem(copilotStorageKey(orgId), serializeHistory(state.entries));
    } catch {
      // Full or blocked storage loses the history on reload, nothing worse.
    }
  }, [state.entries, state.hydrated, orgId]);

  // Keep the latest turn in view as it streams. The page itself scrolls (one
  // scrollbar, the shell's), so this brings the end of the column into view:
  // the message box, pinned to the bottom, then sits right under the last turn.
  useEffect(() => {
    if (state.entries.length > 0) {
      endRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [state.entries]);

  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(
    async (entries: ChatEntry[], start: ChatAction) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      let settled = false;
      const body: CopilotChatBody = { messages: historyFor(entries) };

      dispatch(start);

      try {
        await streamEvents<CopilotStreamEvent>('/ai/copilot/chat', body, {
          signal: current.signal,
          onEvent: (event) => {
            dispatch({ type: 'event', event });
            if (event.type === 'done' || event.type === 'error') {
              settled = true;
              onCredits(event.credits);
            }
          },
        });

        if (!settled) {
          dispatch({
            type: 'fail',
            message: 'The connection closed before the reply finished. Please try again.',
          });
        }
      } catch (cause) {
        if (current.signal.aborted) {
          dispatch({ type: 'abort' });
        } else {
          dispatch({
            type: 'fail',
            message:
              cause instanceof ApiError
                ? cause.message
                : 'The AI service could not be reached. Check your connection and try again.',
            status: cause instanceof ApiError ? cause.status : undefined,
          });
        }
      } finally {
        if (controller.current === current) {
          controller.current = null;
        }
      }
    },
    [onCredits],
  );

  const cost = credits?.costs.copilot_message ?? 1;
  const cannotAfford = credits !== null && credits.remaining < cost;
  const canSend = !state.streaming && !cannotAfford;

  function send(text: string) {
    const content = text.trim();
    if (!canSend || content.length === 0 || content.length > MESSAGE_MAX) {
      return;
    }

    const id = newChatId();
    const entries: ChatEntry[] = [...state.entries, { id, role: 'user', content }];
    setDraft('');
    void run(entries, { type: 'send', id, content, replyId: newChatId() });
  }

  function retry() {
    if (state.entries.at(-1)?.role === 'user') {
      void run(state.entries, { type: 'retry', replyId: newChatId() });
    }
  }

  function clear() {
    dispatch({ type: 'clear' });
    inputRef.current?.focus();
  }

  const empty = state.entries.length === 0;
  const me = { name: user.name ?? user.email, avatar: user.avatar };

  const alerts = (
    <>
      {state.error ? (
        <Alert variant="danger">
          <div className="flex flex-wrap items-center gap-3">
            <span>{state.error.message}</span>
            {state.error.retryable && state.entries.at(-1)?.role === 'user' ? (
              <Button variant="secondary" size="sm" onClick={retry}>
                Try Again
              </Button>
            ) : null}
          </div>
        </Alert>
      ) : null}

      {cannotAfford && credits ? (
        <Alert variant="warning">
          You have used this cycle's AI credits. They reset{' '}
          {mounted ? formatResetDate(credits.resetsAt) : 'next cycle'}.
        </Alert>
      ) : null}
    </>
  );

  const composer = (
    <form
      // The design system's field (field colour, outline) at the size of the
      // thing the page is for, with the hard shadow that marks what you act on.
      // The focus ring moves from the borderless textarea to the whole box.
      className={cn(
        'flex flex-col gap-1 rounded-xl border-2 border-outline bg-field p-2 shadow-brutalSm',
        'transition-[border-color,box-shadow] duration-150',
        'focus-within:border-actionPrimary focus-within:ring-3 focus-within:ring-actionPrimary/20',
      )}
      onSubmit={(event) => {
        event.preventDefault();
        send(draft);
      }}
    >
      <label htmlFor="copilot-input" className="sr-only">
        Message
      </label>
      <Textarea
        id="copilot-input"
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            send(draft);
          }
        }}
        placeholder="Enter your message"
        rows={2}
        maxLength={MESSAGE_MAX}
        disabled={cannotAfford}
        aria-describedby="copilot-help"
        // Grows with what is typed, up to a few lines, then scrolls inside.
        className="field-sizing-content max-h-48 min-h-[3.5rem] resize-none border-0 bg-transparent p-2 text-base shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-2">
          {empty ? null : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={clear}
              disabled={state.streaming}
              aria-label="Clear Conversation"
              className="shrink-0 px-2.5"
            >
              <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
              <span className="hidden sm:inline">Clear</span>
            </Button>
          )}
          <span id="copilot-help" className="min-w-0 font-sans text-xs text-ink type-muted">
            {cost} {cost === 1 ? 'credit' : 'credits'} per message.
            {/* Keyboard hints mean nothing on a touch keyboard. */}
            <span className="hidden md:inline"> Enter to send, Shift+Enter for a new line.</span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {state.streaming ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => controller.current?.abort()}
            >
              <MotionIcon icon={CircleStopIcon} className="h-4 w-4" />
              Stop
            </Button>
          ) : null}
          <Button
            type="submit"
            variant="highlight"
            size="sm"
            disabled={!canSend || draft.trim().length === 0}
          >
            <MotionIcon icon={SendIcon} className="h-4 w-4" />
            Send
          </Button>
        </div>
      </div>
    </form>
  );

  return (
    <section
      aria-labelledby="copilot-title"
      // One column on the page ground, no card and no scroll box of its own
      // (the owner's calls, 2026-10-26): the page is the one thing that
      // scrolls, as in ChatGPT and Claude. Empty, it fills the screen below the
      // mode row and centres the greeting and the message box in it.
      className={cn(
        'mx-auto flex w-full max-w-5xl flex-col',
        mounted &&
          empty &&
          'min-h-[calc(100dvh-20rem)] justify-center md:min-h-[calc(100dvh-16rem)]',
      )}
    >
      <h2 id="copilot-title" className="sr-only">
        PostGear Copilot
      </h2>

      {!mounted ? null : empty ? (
        <div className="flex flex-col items-center gap-7 py-4">
          <div className="flex flex-col items-center gap-4 text-center">
            <AiSticker icon={Sparkles} tone="ai" size="lg" className="-rotate-6" />
            <div className="flex flex-col gap-2">
              <h3 className="m-0 type-heading text-2xl text-ink sm:text-3xl">
                What should we make today?
              </h3>
              <p className="m-0 font-sans text-sm text-ink type-muted">
                The copilot sees your channels, writes, drafts and makes images.
              </p>
            </div>
          </div>

          <div className="flex w-full flex-col gap-4">
            {alerts}
            {composer}
            <ul
              className="m-0 grid w-full list-none gap-1 p-0 sm:grid-cols-2 sm:gap-2"
              aria-label="Suggestions"
            >
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion.prompt} className="flex">
                  <button
                    type="button"
                    onClick={() => send(suggestion.prompt)}
                    disabled={!canSend}
                    // A row, as in ChatGPT's start screen: no frame until the
                    // pointer is on it, then the design system's bordered box.
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg border-2 border-transparent p-2.5 text-start text-ink',
                      'transition-[background-color,border-color,box-shadow] duration-100',
                      'hover:border-outline hover:bg-secondary hover:shadow-brutalSm',
                      'active:translate-x-[1px] active:translate-y-[1px] active:shadow-brutalPressed',
                      FOCUS,
                      'disabled:pointer-events-none disabled:opacity-50',
                    )}
                  >
                    <AiSticker icon={TOOL_ICONS[suggestion.tool]} />
                    <span className="flex min-w-0 flex-col">
                      <span className="type-ui text-sm">{suggestion.title}</span>
                      <span className="truncate font-sans text-xs type-muted">
                        {suggestion.prompt}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <>
          <ol
            className="m-0 flex w-full list-none flex-col gap-5 p-0 pb-6"
            aria-live="polite"
            aria-busy={state.streaming}
          >
            {state.entries.map((entry) => (
              <ChatMessage key={entry.id} entry={entry} orgId={orgId} user={me} />
            ))}
          </ol>

          {state.stopped ? (
            <Text size="sm" muted className="pb-4">
              Stopped.
            </Text>
          ) : null}

          <div
            // Pinned to the bottom of the screen while the conversation scrolls
            // under it, on the page colour with a short fade above, so the
            // turns run out of sight instead of being cut by a line. It reaches
            // down over the page's own bottom padding (-bottom-6, -mb-6 with
            // pb-6 inside), or the turns would show through under the box.
            className={cn(
              'sticky -bottom-6 z-10 -mb-6 flex flex-col gap-3 bg-primary pt-2 pb-6',
              'before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6',
              'before:bg-linear-to-t before:from-primary before:to-transparent',
            )}
          >
            {alerts}
            {composer}
          </div>
          <div ref={endRef} aria-hidden="true" />
        </>
      )}
    </section>
  );
}
