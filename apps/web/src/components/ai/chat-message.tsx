'use client';

/**
 * One turn of the copilot conversation.
 *
 * The user's message is a primary bubble with its tail on the right; the
 * assistant's is a plain bubble with its tail on the left and a violet
 * Sparkles avatar — violet on the avatar, not the bubble, because the reply
 * is conversation and the system reserves the violet fill for the artefacts
 * the model produces (design-system-rules.md §16b). Tool rows sit above the
 * reply's text, in the order they happened: the assistant checks, then says.
 */
import { Avatar, AvatarFallback, SpeechBubble, TypingIndicator } from '@postgear/ui';
import { Sparkles } from 'lucide-react';
import type { ChatEntry } from './chat-state';
import { ToolActivityRow } from './tool-activity';

export function AiAvatar() {
  return (
    <Avatar size="sm" aria-hidden="true">
      <AvatarFallback className="bg-actionAi text-onActionAi">
        <Sparkles className="h-4 w-4" strokeWidth={2.5} />
      </AvatarFallback>
    </Avatar>
  );
}

export function ChatMessage({
  entry,
  orgId,
  userInitials,
}: {
  entry: ChatEntry;
  orgId: string;
  userInitials: string;
}) {
  if (entry.role === 'user') {
    return (
      <li
        data-testid="copilot-message"
        data-role="user"
        className="flex items-end justify-end gap-3"
      >
        <SpeechBubble
          variant="primary"
          tail="right"
          className="mb-2 max-w-[85%] whitespace-pre-wrap"
        >
          {entry.content}
        </SpeechBubble>
        <Avatar size="sm" aria-hidden="true">
          <AvatarFallback className="text-xs">{userInitials}</AvatarFallback>
        </Avatar>
      </li>
    );
  }

  const waiting = entry.streaming && entry.content.length === 0;

  return (
    <li data-testid="copilot-message" data-role="assistant" className="flex items-start gap-3">
      <AiAvatar />
      <div className="flex min-w-0 max-w-[85%] flex-col gap-2">
        {entry.tools.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="What the copilot did">
            {entry.tools.map((tool) => (
              <ToolActivityRow key={tool.id} tool={tool} orgId={orgId} />
            ))}
          </ul>
        ) : null}
        <SpeechBubble tail="left" className="mb-2 whitespace-pre-wrap" aria-busy={entry.streaming}>
          {waiting ? (
            <TypingIndicator />
          ) : (
            <>
              {entry.content}
              {entry.streaming ? <TypingIndicator className="ms-2 align-middle" /> : null}
            </>
          )}
        </SpeechBubble>
      </div>
    </li>
  );
}
