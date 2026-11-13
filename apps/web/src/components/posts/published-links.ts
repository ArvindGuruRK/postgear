/**
 * "Where did my post go?": each published channel's own page for a post
 * (2026-11-14). Pure, so the composer's state can keep the links and tests can
 * run without a browser; the control that shows them is
 * `view-published-post.tsx`.
 *
 * Only channels that have gone out carry a `releaseURL`, so a channel still
 * queued or failed is simply not listed.
 */

export interface PublishedLink {
  channelId: string;
  /** The channel's own name (the Page or account), shown in the menu. */
  name: string;
  providerIdentifier: string;
  url: string;
}

interface ChannelWithRelease {
  channelId: string;
  name: string;
  providerIdentifier: string;
  releaseURL: string | null;
}

/**
 * Every published channel's permalink, in the post's channel order. The URL
 * comes back from the platform, so only http(s) addresses are kept: a link
 * the app renders must never be able to run script.
 */
export function publishedLinks(channels: readonly ChannelWithRelease[]): PublishedLink[] {
  return channels.flatMap((channel) =>
    channel.releaseURL && isWebAddress(channel.releaseURL)
      ? [
          {
            channelId: channel.channelId,
            name: channel.name,
            providerIdentifier: channel.providerIdentifier,
            url: channel.releaseURL,
          },
        ]
      : [],
  );
}

function isWebAddress(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
