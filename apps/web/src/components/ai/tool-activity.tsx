'use client';

/**
 * One tool the copilot used, as a row under its reply: what it did, whether
 * it worked, and the thing it made, such as a link to the drafted post or the image
 * it generated.
 *
 * The rows are the proof that the assistant acted rather than only talked.
 * They are deliberately plainer than the bubbles (a bordered line, body
 * face) so the conversation reads as the conversation and the rows as its
 * footnotes.
 */
import { cn, Spinner } from '@postgear/ui';
import { FileText, Image as ImageIcon, type LucideIcon, PenSquare, Radio, X } from 'lucide-react';
import Link from 'next/link';
import type { CopilotToolName } from '@/types/ai';
import {
  describeTool,
  draftOutput,
  imageOutput,
  type ToolActivity,
  toolFailureReason,
} from './chat-state';

const ICONS: Record<CopilotToolName, LucideIcon> = {
  list_channels: Radio,
  generate_post: PenSquare,
  draft_post: FileText,
  generate_image: ImageIcon,
};

export function ToolActivityRow({ tool, orgId }: { tool: ToolActivity; orgId: string }) {
  const Icon = ICONS[tool.name];
  const draft = draftOutput(tool);
  const image = imageOutput(tool);
  const reason = toolFailureReason(tool);

  return (
    <li
      data-testid="copilot-tool"
      data-tool={tool.name}
      data-status={tool.status}
      className="flex items-start gap-2 rounded-md border-2 border-outline bg-secondary px-3 py-2 font-sans text-xs font-medium text-ink"
    >
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        {tool.status === 'running' ? (
          <Spinner size="sm" aria-label={describeTool(tool)} />
        ) : tool.status === 'failed' ? (
          <X className="h-4 w-4 text-actionDanger" strokeWidth={3} aria-hidden="true" />
        ) : (
          <Icon className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
        )}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className={cn(tool.status === 'failed' && 'text-dangerInk')}>
          {describeTool(tool)}
          {draft ? (
            <>
              {' → '}
              <Link
                href={`/${orgId}/composer?group=${encodeURIComponent(draft.group)}`}
                className="font-bold underline outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
              >
                Open in composer
              </Link>
            </>
          ) : null}
        </span>
        {reason ? <span className="text-dangerInk opacity-90">{reason}</span> : null}
        {image ? (
          // biome-ignore lint/performance/noImgElement: a thumbnail served from media storage, as the media tile shows it
          <img
            src={image.thumbnailUrl ?? image.url}
            alt={image.prompt || 'Generated image'}
            className="h-24 w-24 rounded-md border-2 border-outline object-cover"
          />
        ) : null}
      </span>
    </li>
  );
}
