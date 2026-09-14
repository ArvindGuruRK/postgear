'use client';

import { Globe, MessageSquare, Repeat2, Send, ThumbsUp } from 'lucide-react';
import { CommentList } from './comment-list';
import {
  ChannelAvatar,
  type PlatformPreviewProps,
  PreviewMediaGrid,
  PreviewText,
  shortDate,
} from './preview-parts';

const ACTIONS = [
  { icon: ThumbsUp, label: 'Like' },
  { icon: MessageSquare, label: 'Comment' },
  { icon: Repeat2, label: 'Repost' },
  { icon: Send, label: 'Send' },
];

/**
 * LinkedIn — for both personal profiles and company pages, which look the same
 * in the feed.
 *
 * The fold matters more here than anywhere: LinkedIn shows roughly the first
 * three lines, about 210 characters, before "…see more", and most readers never
 * press it.
 */
export function LinkedInPreview({
  channel,
  parts,
  maxLength,
  lengthMethod,
  publishAt,
}: PlatformPreviewProps) {
  const [first, ...rest] = parts;

  if (!first) {
    return null;
  }

  return (
    <article className="border border-borderLinkedin bg-bgLinkedin font-sans text-sm leading-5 text-ink">
      <header className="flex gap-2 px-4 pt-3">
        <ChannelAvatar channel={channel} size="lg" />
        <div className="min-w-0">
          <div className="truncate font-bold">{channel.name}</div>
          <div className="flex items-center gap-1 text-xs text-textLinkedin">
            {shortDate(publishAt)} ·{' '}
            <Globe className="h-3 w-3" strokeWidth={2.5} aria-label="Public" />
          </div>
        </div>
      </header>

      <PreviewText
        text={first.text}
        maxLength={maxLength}
        lengthMethod={lengthMethod}
        foldAfter={210}
        className="px-4 pt-2"
      />

      <PreviewMediaGrid media={first.media} className="mt-2" rounded="rounded-none" />

      <div
        className="mx-4 mt-2 flex justify-around border-t border-borderLinkedin py-1 text-textLinkedin"
        aria-hidden="true"
      >
        {ACTIONS.map(({ icon: Icon, label }) => (
          <span key={label} className="flex items-center gap-1.5 px-2 py-2 text-xs font-bold">
            <Icon className="h-4 w-4" strokeWidth={2} />
            {label}
          </span>
        ))}
      </div>

      <CommentList
        channel={channel}
        parts={rest}
        maxLength={maxLength}
        lengthMethod={lengthMethod}
        bubbleClassName="bg-primary/60"
      />
    </article>
  );
}
