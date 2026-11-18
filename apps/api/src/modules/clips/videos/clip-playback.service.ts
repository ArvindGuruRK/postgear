/**
 * Signed addresses for a video's private files (Sprint 12, Modules 04 and 05).
 *
 * The private space is never public: a browser reaches a file only through
 * an address that names one key and expires. Playing, the filmstrip, the
 * waveform and the poster all get six hours, long enough for an editing
 * session, short enough that a copied link dies the same day. The key itself
 * never leaves the API: only the signed address does.
 *
 * A signing failure (a misconfigured binding) is logged and answered as "no
 * address", so a page still shows the video's facts instead of failing whole.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PrivateStorage } from '@postgear/storage';
import { PRIVATE_STORAGE } from '../../media/storage/storage.interface';

/** How long a playing address works: six hours. */
export const PLAYBACK_SECONDS = 6 * 60 * 60;

export interface SignedAddress {
  url: string;
  /** ISO time the address stops working. */
  expiresAt: string;
}

@Injectable()
export class ClipPlaybackService {
  private readonly logger = new Logger(ClipPlaybackService.name);

  constructor(@Inject(PRIVATE_STORAGE) private readonly storage: PrivateStorage) {}

  /** A six hour read address for one private key, or null when it cannot be made. */
  async address(key: string, now: Date = new Date()): Promise<SignedAddress | null> {
    try {
      const url = await this.storage.signedUrl(key, { expiresInSeconds: PLAYBACK_SECONDS });
      return { url, expiresAt: new Date(now.getTime() + PLAYBACK_SECONDS * 1000).toISOString() };
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.playback.sign_failed',
          reason: error instanceof Error ? error.name : 'unknown',
        }),
      );
      return null;
    }
  }
}
