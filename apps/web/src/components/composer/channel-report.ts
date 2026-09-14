/**
 * What each selected channel will publish, and what is wrong with it.
 *
 * Computed from the same three functions the API uses before queueing — render,
 * measure, validate, all from `@postgear/social-core/composer` — against the
 * rules the API sent with the provider list. The counters, the previews and the
 * queue button all read this one report, so none of them can disagree with
 * another, or with the server.
 */
import {
  measureLength,
  normalizeDocument,
  renderPlainText,
  type ValidationIssue,
  validatePost,
} from '@postgear/social-core/composer';
import type { Channel, ProviderSummary } from '@/types/channel';
import type { MediaItem } from '@/types/media';
import type { DraftPart } from './composer-state';

export interface RenderedPart {
  key: string;
  /** Exactly what the platform will receive. */
  text: string;
  media: MediaItem[];
  /** `text` measured the platform's way. */
  length: number;
}

export interface ChannelReport {
  channel: Channel;
  provider: ProviderSummary | null;
  parts: RenderedPart[];
  /** Platform rule violations. Drafts may have them; the queue may not. */
  issues: ValidationIssue[];
  /** A problem with the channel itself rather than the content. */
  channelProblem: string | null;
}

export function buildReport(
  channel: Channel,
  provider: ProviderSummary | undefined,
  parts: DraftPart[],
): ChannelReport {
  const rendered = parts.map((part) => {
    const text = renderPlainText(normalizeDocument(part.content));

    return {
      key: part.key,
      text,
      media: part.media,
      length: provider ? measureLength(text, provider.rules.lengthMethod) : text.length,
    };
  });

  if (!provider) {
    return {
      channel,
      provider: null,
      parts: rendered,
      issues: [],
      channelProblem: `PostGear can't publish to ${channel.providerName} on this instance.`,
    };
  }

  const issues = validatePost(
    provider.rules,
    rendered.map((part) => ({
      text: part.text,
      media: part.media.map((item) => ({
        type: item.type,
        mimeType: item.mimeType ?? undefined,
        bytes: item.fileSize,
        width: item.width ?? undefined,
        height: item.height ?? undefined,
      })),
    })),
    { providerName: provider.name },
  );

  return { channel, provider, parts: rendered, issues, channelProblem: channelProblemOf(channel) };
}

/**
 * The same channel states the API refuses to queue to.
 *
 * `needs_reconnect` is deliberately absent: it can be fixed before the post is
 * due, and the Channels page already says so loudly. The composer warns about
 * it instead of blocking.
 */
function channelProblemOf(channel: Channel): string | null {
  if (channel.inBetweenSteps) {
    return `Finish setting up ${channel.name} before adding posts to its queue.`;
  }

  if (channel.disabled) {
    return `${channel.name} is disabled. Turn it back on to queue posts to it.`;
  }

  return null;
}

/** Every reason the post cannot enter the queue, labelled by channel. */
export function queueBlockers(reports: ChannelReport[]): string[] {
  return reports.flatMap((report) => [
    ...(report.channelProblem ? [report.channelProblem] : []),
    ...report.issues.map((issue) => `${report.channel.name}: ${issue.message}`),
  ]);
}
