/**
 * The Send To Composer dialog's rules (Module 17 section 3), pure so they are
 * tested without a browser.
 *
 * - `channelChoices`: each channel with whether it can be ticked and, when
 *   not, the reason in one sentence under its name. A channel still being set
 *   up or switched off cannot take a post at all (the composer's own rule); a
 *   channel the clip does not fit gets `videoFit`'s sentence, from the same
 *   rules the API checks the send against.
 * - `sentExport`: the export whose file a send posts (the clip's exported
 *   file), for its facts.
 */
import {
  type ProviderRules,
  type VideoFacts,
  videoFit,
  videoFitSentence,
} from '@postgear/social-core/composer';
import type { Channel, ProviderSummary } from '@/types/channel';
import type { ClipExportView } from '@/types/clips';

export const SEND_TITLE = 'Send To Composer';
export const SEND_OUTDATED = 'You changed this clip after the last export.';
export const SEND_NO_CHANNELS = 'Connect a channel to post this clip.';
export const SEND_CHANNELS_FAILED =
  'We could not load your channels. Check your connection and try again.';
export const SEND_FAILED = 'We could not make the draft. Try again.';
export const SEND_PICK_ONE = 'Choose at least one channel for the draft.';
export const SEND_NOT_EXPORTED = 'Export this clip first, then send it.';
/** Studio's caption cap (`MAX_CAPTION_LENGTH`); the composer measures it per platform. */
export const CAPTION_MAX = 3_000;

/** One channel in the dialog's list. */
export interface ChannelChoice {
  channel: Channel;
  /** The platform's name as the provider gives it. */
  platform: string;
  /** Why it cannot be ticked; null when it can. */
  reason: string | null;
}

/** The newest finished export whose file is the clip's exported file (else the newest finished one). */
export function sentExport(
  exports: readonly ClipExportView[],
  exportedMediaId: string | null,
): ClipExportView | null {
  const done = exports.filter((row) => row.job.status === 'DONE' && row.media !== null);
  return done.find((row) => row.media?.id === exportedMediaId) ?? done[0] ?? null;
}

/** What `videoFit` reads about an export's file. */
export function factsOf(row: ClipExportView | null, durationMs: number): VideoFacts {
  const media = row?.media ?? null;
  return {
    durationMs: media?.durationMs ?? durationMs,
    width: media?.width ?? null,
    height: media?.height ?? null,
    bytes: media?.bytes ?? null,
  };
}

/** Each channel with whether this clip can go to it, in the workspace's order. */
export function channelChoices(
  channels: readonly Channel[],
  providers: readonly ProviderSummary[],
  facts: VideoFacts,
): ChannelChoice[] {
  const byId = new Map(providers.map((provider) => [provider.identifier, provider]));
  return channels.map((channel) => {
    const provider = byId.get(channel.providerIdentifier);
    const platform = provider?.name ?? channel.providerName;
    if (channel.inBetweenSteps || channel.health === 'needs_setup') {
      return {
        channel,
        platform,
        reason: 'Finish setting up this channel on the Channels page first.',
      };
    }
    if (channel.disabled || channel.health === 'disabled') {
      return { channel, platform, reason: 'This channel is turned off.' };
    }
    if (!provider) {
      return { channel, platform, reason: `${platform} cannot be posted to from here.` };
    }
    return { channel, platform, reason: fitReason(provider.rules, platform, facts) };
  });
}

function fitReason(rules: ProviderRules, platform: string, facts: VideoFacts): string | null {
  const fit = videoFit(rules, facts);
  return fit.ok ? null : videoFitSentence(fit, platform, facts, 'clip');
}

/** "120 / 3000": the caption's count. */
export function captionCount(caption: string): string {
  return `${caption.length.toLocaleString('en-US')} / ${CAPTION_MAX.toLocaleString('en-US')}`;
}

/** The composer's address for a draft. */
export function composerHref(orgId: string, group: string): string {
  return `/${encodeURIComponent(orgId)}/composer?group=${encodeURIComponent(group)}`;
}
