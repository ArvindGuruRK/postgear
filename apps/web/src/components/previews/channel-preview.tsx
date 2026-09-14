'use client';

/**
 * Picks the preview for a channel's platform — the registry the sprint plan
 * describes: one small component per platform, and a generic one for the rest.
 *
 * Keyed by provider identifier, the same value stored in
 * `Integration.providerIdentifier`. LinkedIn profiles and LinkedIn Pages are
 * two providers that look identical in the feed, so they share one preview.
 */
import type { ProviderRules } from '@postgear/social-core/composer';
import { Text } from '@postgear/ui';
import type { ComponentType } from 'react';
import { FacebookPreview } from './facebook.preview';
import { GenericPreview } from './generic.preview';
import { InstagramPreview } from './instagram.preview';
import { LinkedInPreview } from './linkedin.preview';
import { PinterestPreview } from './pinterest.preview';
import type { PlatformPreviewProps, PreviewChannel, PreviewPart } from './preview-parts';
import { TikTokPreview } from './tiktok.preview';
import { XPreview } from './x.preview';
import { YouTubePreview } from './youtube.preview';

const PREVIEWS: Record<string, ComponentType<PlatformPreviewProps>> = {
  x: XPreview,
  linkedin: LinkedInPreview,
  'linkedin-page': LinkedInPreview,
  facebook: FacebookPreview,
  instagram: InstagramPreview,
  youtube: YouTubePreview,
  tiktok: TikTokPreview,
  pinterest: PinterestPreview,
};

export function ChannelPreview({
  providerIdentifier,
  providerName,
  rules,
  channel,
  parts,
  publishAt,
}: {
  providerIdentifier: string;
  providerName: string;
  rules: ProviderRules;
  channel: PreviewChannel;
  parts: PreviewPart[];
  publishAt: Date | null;
}) {
  const Preview = PREVIEWS[providerIdentifier] ?? GenericPreview;

  // A platform with no thread structure publishes only the first part, so only
  // the first part is previewed; the issue list says the rest will not post.
  const shown = rules.thread === 'none' ? parts.slice(0, 1) : parts;

  return (
    <div className="flex flex-col gap-2">
      <div
        className="overflow-hidden rounded-lg border-2 border-outline"
        data-testid={`preview-${providerIdentifier}`}
      >
        <Preview
          channel={channel}
          parts={shown}
          maxLength={rules.maxLength}
          lengthMethod={rules.lengthMethod}
          publishAt={publishAt}
        />
      </div>
      {rules.thread === 'none' && parts.length > 1 ? (
        <Text size="xs" muted>
          {providerName} has no threads — only part 1 is shown, and only part 1 would be posted.
        </Text>
      ) : rules.thread === 'comments' && parts.length > 1 ? (
        <Text size="xs" muted>
          {providerName} has no threads, so parts 2–{parts.length} are posted as comments on part 1.
        </Text>
      ) : null}
    </div>
  );
}
