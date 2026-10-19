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
import {
  Alert,
  Button,
  EmptyState,
  FormField,
  FormHelperText,
  FormLabel,
  MotionIcon,
  Text,
  Textarea,
} from '@postgear/ui';
import { MessageSquare } from 'lucide-react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { streamEvents } from '@/lib/sse';
import type { AiCredits, CopilotChatBody, CopilotStreamEvent } from '@/types/ai';
import { useWorkspace } from '../navigation/workspace-provider';
import { useMounted } from '../posts/use-mounted';
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

function initials(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const words = source.split(/\s+/).filter(Boolean);
  const letters = words.length >= 2 ? `${words[0][0]}${words[1][0]}` : source.slice(0, 2);
  return letters.toUpperCase();
}

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
  const listRef = useRef<HTMLDivElement>(null);
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

  // Keep the latest turn in view as it streams.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `state.entries` is the trigger, not a value read
  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Text size="sm" muted>
          Ask for a post, an image, or what is connected. The copilot can check your channels,
          write, draft and illustrate.
        </Text>
        <Button variant="secondary" size="sm" onClick={clear} disabled={empty || state.streaming}>
          <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
          Clear conversation
        </Button>
      </div>

      <div
        ref={listRef}
        className="flex max-h-[60vh] min-h-[16rem] flex-col overflow-y-auto rounded-lg border-2 border-outline p-4 pg-scrollbar pg-scrollbar-primary"
        aria-live="polite"
        aria-busy={state.streaming}
      >
        {!mounted ? null : empty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <EmptyState
              icon={MessageSquare}
              title="Ask the copilot"
              description="It sees your channels and can act on them. Try one of these, or ask in your own words."
              className="p-4"
            />
            <ul
              className="m-0 flex list-none flex-wrap justify-center gap-2 p-0"
              aria-label="Suggestions"
            >
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    onClick={() => send(suggestion)}
                    disabled={!canSend}
                    className="rounded-full border-2 border-outline bg-secondary px-3 py-1.5 font-sans text-sm font-bold text-ink shadow-brutalSm transition-[transform,box-shadow] duration-100 hover:bg-actionPrimary/10 active:translate-x-[1px] active:translate-y-[1px] active:shadow-brutalPressed outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none"
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-4 p-0">
            {state.entries.map((entry) => (
              <ChatMessage
                key={entry.id}
                entry={entry}
                orgId={orgId}
                userInitials={initials(user.name, user.email)}
              />
            ))}
          </ol>
        )}
      </div>

      {state.stopped ? (
        <Text size="sm" muted>
          Stopped.
        </Text>
      ) : null}

      {state.error ? (
        <Alert variant="danger">
          <div className="flex flex-wrap items-center gap-3">
            <span>{state.error.message}</span>
            {state.error.retryable && state.entries.at(-1)?.role === 'user' ? (
              <Button variant="secondary" size="sm" onClick={retry}>
                Try again
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

      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
      >
        <FormField>
          <FormLabel htmlFor="copilot-input" className="sr-only">
            Message
          </FormLabel>
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
            placeholder="Message the copilot…"
            rows={2}
            maxLength={MESSAGE_MAX}
            disabled={cannotAfford}
            className="min-h-[4.5rem]"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <FormHelperText>
              {cost} {cost === 1 ? 'credit' : 'credits'} per message · Enter to send, Shift+Enter
              for a new line
            </FormHelperText>
            <div className="flex items-center gap-2">
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
                variant="ai"
                size="sm"
                disabled={!canSend || draft.trim().length === 0}
              >
                <MotionIcon icon={SendIcon} className="h-4 w-4" />
                Send
              </Button>
            </div>
          </div>
        </FormField>
      </form>
    </div>
  );
}
