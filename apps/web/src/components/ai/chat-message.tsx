'use client';

/**
 * One turn of the copilot conversation.
 *
 * The user's message is a primary bubble with its tail on the right, beside
 * their own avatar (photo, preset or initials, as the top bar shows it); the
 * assistant's is a plain bubble with its tail on the left and a violet
 * Sparkles sticker: violet on the sticker, not the bubble, because the reply
 * is conversation and the system reserves the violet fill for the artefacts
 * the model produces (design-system-rules.md section 16b). Tool rows sit
 * above the reply's text, in the order they happened: the assistant checks,
 * then says.
 */
import { SpeechBubble, TypingIndicator } from '@postgear/ui';
import { Sparkles } from 'lucide-react';
import type { SessionAvatar } from '@/lib/session';
import { UserAvatar } from '../profile/user-avatar';
import { AiSticker } from './ai-ui';
import type { ChatEntry } from './chat-state';
import { ToolActivityRow } from './tool-activity';

export function AiAvatar() {
  return <AiSticker icon={Sparkles} tone="ai" className="rounded-full" />;
}

export function ChatMessage({
  entry,
  orgId,
  user,
}: {
  entry: ChatEntry;
  orgId: string;
  user: { name: string; avatar: SessionAvatar | undefined };
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
          className="mb-2 max-w-[85%] whitespace-pre-wrap sm:max-w-[75%]"
        >
          {entry.content}
        </SpeechBubble>
        <span aria-hidden="true" className="shrink-0">
          <UserAvatar name={user.name} avatar={user.avatar} size="sm" />
        </span>
      </li>
    );
  }

  const waiting = entry.streaming && entry.content.length === 0;

  return (
    <li data-testid="copilot-message" data-role="assistant" className="flex items-start gap-3">
      <AiAvatar />
      <div className="flex min-w-0 max-w-[85%] flex-col gap-2 sm:max-w-[75%]">
        {entry.tools.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="What the copilot did">
            {entry.tools.map((tool) => (
              <ToolActivityRow key={tool.id} tool={tool} orgId={orgId} />
            ))}
          </ul>
        ) : null}
        <SpeechBubble
          tail="left"
          className="mb-2 whitespace-pre-wrap leading-relaxed"
          aria-busy={entry.streaming}
        >
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
