/**
 * Where generated images go: the workspace's media library.
 *
 * The engine produces bytes and a rewritten prompt; this turns them into an
 * ordinary library item through `MediaService.saveGenerated`, so a generated
 * image is attachable, listable and deletable exactly like an upload. Bound
 * to one workspace at construction: see `engine.types.ts` for why a sink
 * cannot be shared across requests.
 */
import type { ImageSink } from '@postgear/ai-engine';
import type { MediaService } from '../../media/media.service';

export function imageSinkFor(media: Pick<MediaService, 'saveGenerated'>, orgId: string): ImageSink {
  return {
    async save(image, meta) {
      const view = await media.saveGenerated(orgId, {
        data: image.data,
        mimeType: image.mimeType,
        name: meta.name,
        // The provider's rewritten prompt describes what was actually drawn;
        // the original is the fallback.
        alt: image.revisedPrompt ?? meta.prompt,
      });

      return { mediaId: view.id, url: view.url, thumbnailUrl: view.thumbnailUrl };
    },
  };
}
