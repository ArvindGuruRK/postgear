/**
 * The waiting-caller helpers on `postgear-media-quick` (Module 03):
 *
 * - `clipProbeLink`: what is behind a recognised link (`Downloader.probe`).
 * - `clipListChannel`: resolve a channel handle, or read one page of its
 *   list, through the yt-dlp flat lister (or the simulated one).
 *
 * Both answer within the API's wait, honour the cancel signal, and fail with
 * our code in `details[0]` (never a tool's text).
 */
import {
  CLIP_PLATFORMS,
  type ClipListChannelAnswer,
  type ClipListChannelRequest,
  type LinkInfo,
  type LinkRef,
  linkRefSchema,
} from '@postgear/video-engine';
import { runClipActivity } from '../activity-kit';
import type { ClipActivityDeps } from '../deps';
import { ClipStepError } from '../failures';

export function createProbeActivities(deps: Pick<ClipActivityDeps, 'providers'>) {
  return {
    async clipProbeLink(link: LinkRef): Promise<LinkInfo> {
      return runClipActivity('clipProbeLink', undefined, async ({ signal }) => {
        const parsed = linkRefSchema.safeParse(link);
        if (!parsed.success) throw new ClipStepError('link_unsupported');
        return deps.providers.downloader.probe(parsed.data, signal);
      });
    },

    async clipListChannel(request: ClipListChannelRequest): Promise<ClipListChannelAnswer> {
      return runClipActivity('clipListChannel', undefined, async ({ signal }) => {
        if (!(CLIP_PLATFORMS as readonly string[]).includes(request?.platform)) {
          throw new ClipStepError('channel_not_found', { retryable: false });
        }
        const lister = deps.providers.channelLister(request.platform);
        if (request.op === 'resolve') {
          return { op: 'resolve', channel: await lister.resolve(request.handle, signal) };
        }
        return { op: 'list', page: await lister.list(request.channel, request.query, signal) };
      });
    },
  };
}
