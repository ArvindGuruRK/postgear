/**
 * A competitor's YouTube channel, from the channel's public feed (research 01,
 * section 3.9). No key and no quota: it is an Atom feed of the newest videos,
 * read by the same mapper as any other feed, with one label for every row.
 *
 * The channel id ends up inside an address, so it is checked against the shape
 * every channel id has ("UC" and 22 more characters) first. Anything else is
 * answered without a request.
 */
import { type CompetitorSource, type CompetitorSourceOptions, emptyResult } from './competitor';
import { type FeedLabel, readCompetitorFeed } from './rss';

const NAME = 'YouTube';
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const LABEL: FeedLabel = { id: 'youtube', fallbackName: NAME, summary: 'YouTube video' };

export function isYoutubeChannelId(value: string): boolean {
  return CHANNEL_ID.test(value);
}

export function youtubeChannelFeedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

export function createYoutubeChannelSource(options: CompetitorSourceOptions): CompetitorSource {
  return {
    id: 'youtube',
    name: NAME,

    read: async (reference, signal) => {
      const channelId = reference.trim();
      if (!isYoutubeChannelId(channelId)) {
        return emptyResult({ name: NAME }, 'not_found', {
          warnings: ['That is not a YouTube channel id.'],
        });
      }

      return readCompetitorFeed(options, youtubeChannelFeedUrl(channelId), LABEL, signal);
    },
  };
}
