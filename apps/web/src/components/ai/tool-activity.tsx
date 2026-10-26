'use client';

/**
 * One tool the copilot used, as a row under its reply: what it did, whether
 * it worked, and the thing it made, such as a link to the drafted post or the
 * image it generated.
 *
 * The rows are the proof that the assistant acted rather than only talked,
 * so they read like receipts (revamp, 2026-10-26): the tool's sticker, violet
 * while it runs, green once it worked and red when it failed, so the outcome
 * is never colour alone (the spinner, the tick and the cross say it too). They
 * stay plainer than the bubbles (small body face) so the conversation reads
 * as the conversation and the rows as its footnotes.
 */
import { ArrowRightIcon } from '@animateicons/react/lucide/arrow-right-icon';
import { cn, MotionIcon, Spinner } from '@postgear/ui';
import { Check, X } from 'lucide-react';
import Link from 'next/link';
import { AiSticker, FOCUS, INSET, TOOL_ICONS } from './ai-ui';
import {
  describeTool,
  draftOutput,
  imageOutput,
  type ToolActivity,
  toolFailureReason,
} from './chat-state';

export function ToolActivityRow({ tool, orgId }: { tool: ToolActivity; orgId: string }) {
  const Icon = TOOL_ICONS[tool.name];
  const draft = draftOutput(tool);
  const image = imageOutput(tool);
  const reason = toolFailureReason(tool);

  return (
    <li
      data-testid="copilot-tool"
      data-tool={tool.name}
      data-status={tool.status}
      className={cn(INSET, 'flex items-start gap-3 px-3 py-2.5 font-sans text-xs text-ink')}
    >
      {tool.status === 'running' ? (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-actionAi bg-clip-padding">
          <Spinner
            size="sm"
            className="border-onActionAi border-t-transparent"
            aria-label={describeTool(tool)}
          />
        </span>
      ) : (
        <span className="relative shrink-0" aria-hidden="true">
          <AiSticker size="sm" icon={Icon} tone={tool.status === 'failed' ? 'danger' : 'success'} />
          <span className="absolute -end-1.5 -bottom-1.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-outline bg-secondary bg-clip-padding text-ink">
            {tool.status === 'failed' ? (
              <X className="h-2.5 w-2.5" strokeWidth={4} />
            ) : (
              <Check className="h-2.5 w-2.5" strokeWidth={4} />
            )}
          </span>
        </span>
      )}

      <span className="flex min-w-0 flex-1 flex-col gap-1.5 pt-1">
        <span
          className={cn('font-bold leading-snug', tool.status === 'failed' && 'text-dangerInk')}
        >
          {describeTool(tool)}
        </span>
        {reason ? <span className="text-dangerInk">{reason}</span> : null}
        {draft ? (
          <Link
            href={`/${orgId}/composer?group=${encodeURIComponent(draft.group)}`}
            className={cn(
              'inline-flex w-fit items-center gap-1 font-bold underline underline-offset-2',
              FOCUS,
            )}
          >
            Open In Composer
            <MotionIcon icon={ArrowRightIcon} size={14} className="h-3.5 w-3.5" />
          </Link>
        ) : null}
        {image ? (
          // biome-ignore lint/performance/noImgElement: a thumbnail served from media storage, as the media tile shows it
          <img
            src={image.thumbnailUrl ?? image.url}
            alt={image.prompt || 'Generated image'}
            className="h-40 w-40 rounded-md border-2 border-outline object-cover"
          />
        ) : null}
      </span>
    </li>
  );
}
