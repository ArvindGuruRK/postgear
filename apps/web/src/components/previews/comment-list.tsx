'use client';

import { cn } from '@postgear/ui';
import { ChannelAvatar, type PreviewChannel, type PreviewPart, PreviewText } from './preview-parts';

/**
 * The later parts of a post, as the comments they become.
 *
 * LinkedIn, Facebook and Instagram have no thread structure, so their
 * providers publish part one as the post and each later part as a comment
 * from the same account. The preview says so rather than pretending they are
 * one long post. Comments carry no media on any of the three — the composer
 * flags an attachment on a later part as an issue — so none is drawn here.
 */
export function CommentList({
  channel,
  parts,
  maxLength,
  lengthMethod,
  bubbleClassName,
}: {
  channel: PreviewChannel;
  parts: PreviewPart[];
  maxLength: number;
  lengthMethod: Parameters<typeof PreviewText>[0]['lengthMethod'];
  bubbleClassName?: string;
}) {
  if (parts.length === 0) {
    return null;
  }

  return (
    <ul
      aria-label="Posted as comments"
      className="flex flex-col gap-3 border-t border-outline/15 px-4 py-3"
    >
      {parts.map((part, index) => (
        <li key={part.key} className="flex gap-2">
          <ChannelAvatar channel={channel} size="sm" />
          <div className={cn('min-w-0 flex-1 rounded-xl px-3 py-2', bubbleClassName)}>
            <div className="text-xs font-bold">
              {channel.name} <span className="font-medium opacity-60">· part {index + 2}</span>
            </div>
            <PreviewText
              text={part.text}
              maxLength={maxLength}
              lengthMethod={lengthMethod}
              className="text-sm"
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
