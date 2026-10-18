/**
 * User avatars: a bundled preset, an uploaded photo, or none (initials).
 *
 * ## Two columns, at most one set
 *
 * `User.avatarPreset` holds an id from `avatar.presets.ts`; `User.avatarUrl`
 * holds the public URL of an image on our own storage: an upload, or the
 * Google/Facebook photo re-hosted at signup. Every write here sets one and
 * clears the other, so `toSessionAvatar` never has to break a tie in practice.
 *
 * ## Not the media library
 *
 * Images go straight to the storage backend under `avatars/<userId>/…` and no
 * `Media` row is created. A `Media` row belongs to a workspace and would put
 * someone's face in every teammate's library grid, available to attach to a
 * post. The legacy `User.pictureId → Media` relation inherited from Postiz is
 * deliberately left unused for the same reason.
 *
 * ## Replacing an image deletes the old one: best effort
 *
 * Keys are never reused (the S3 backend caches objects as immutable for a
 * year), so a new upload is a new object and the previous one is removed
 * afterwards. Only a URL that round-trips to one of *this user's* avatar keys
 * is ever deleted; a storage failure is logged and does not fail the request,
 * since the database already points at the new image.
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { prisma } from '@postgear/db';
import { formatBytes } from '@postgear/social-core';
import { securityLogger } from '../../common/logging/security-logger';
import { SNIFF_BYTES, type SniffedMedia, sniffMedia } from '../media/file-type';
import { processAvatarImage, UnreadableImageError } from '../media/image-processor';
import { STORAGE_BACKEND, type StorageBackend } from '../media/storage/storage.interface';
import { CONTENT_TYPES, createAvatarKey, isAvatarKey } from '../media/storage/storage-keys';
import { isAvatarPresetId } from './avatar.presets';
import { type SessionAvatar, toSessionAvatar } from './session-avatar';

/** Largest upload accepted, before it is shrunk to 256 px. Also the multipart limit. */
export const MAX_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Largest OAuth photo fetched. Provider photos are a few hundred KB at most;
 * anything bigger is not the profile picture we asked for.
 */
export const MAX_REMOTE_AVATAR_BYTES = 2 * 1024 * 1024;

/** How long sign-in waits for the provider's CDN before giving up on the photo. */
export const REMOTE_AVATAR_TIMEOUT_MS = 5_000;

/**
 * Hosts an OAuth photo may be fetched from: Google's and Facebook's image
 * CDNs. The URL arrives inside the provider's own profile response, so it is
 * not attacker-typed, but the API should still never be talked into fetching
 * an arbitrary address (an internal metadata endpoint, say) on someone's
 * behalf. Redirects are followed by hand so every hop is checked too.
 */
const REMOTE_AVATAR_HOST_SUFFIXES = ['.googleusercontent.com', '.fbcdn.net', '.fbsbx.com'];
const MAX_REDIRECTS = 3;

export const AVATAR_MESSAGES = {
  NO_FILE: 'Choose a photo to upload.',
  UNSUPPORTED: 'Upload a JPEG, PNG or WebP image.',
  TOO_LARGE: `Photos can be at most ${formatBytes(MAX_AVATAR_UPLOAD_BYTES)}.`,
  UNREADABLE:
    'That image could not be read. It may be damaged, or not the kind of file its name says.',
  UNKNOWN_PRESET: 'That avatar is not available.',
} as const;

/** The subset of Multer's in-memory file object this service reads. */
export interface AvatarUploadInput {
  buffer: Buffer;
  size: number;
}

type ImageSniff = Extract<SniffedMedia, { kind: 'image' }>;

/** PNG, JPEG and WebP only: GIF and AVIF are media-library formats, not profile photos. */
const ACCEPTED: ReadonlySet<ImageSniff['mimeType']> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const AVATAR_COLUMNS = { avatarPreset: true, avatarUrl: true } as const;

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  constructor(@Inject(STORAGE_BACKEND) private readonly storage: StorageBackend) {}

  async setPreset(userId: string, presetId: string): Promise<SessionAvatar> {
    // The route's schema already checked this; repeated so the service is
    // safe to call from anywhere.
    if (!isAvatarPresetId(presetId)) {
      throw new BadRequestException(AVATAR_MESSAGES.UNKNOWN_PRESET);
    }

    const previous = await this.currentUrl(userId);
    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatarPreset: presetId, avatarUrl: null },
      select: AVATAR_COLUMNS,
    });

    await this.removeOwnImage(userId, previous);
    return toSessionAvatar(user);
  }

  async upload(userId: string, file: AvatarUploadInput | undefined): Promise<SessionAvatar> {
    if (!file?.buffer?.length) {
      throw new BadRequestException(AVATAR_MESSAGES.NO_FILE);
    }

    // Multer's limit cut the stream off already; this guards other callers.
    if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
      throw new BadRequestException(AVATAR_MESSAGES.TOO_LARGE);
    }

    const sniffed = sniffMedia(file.buffer.subarray(0, SNIFF_BYTES));

    if (sniffed?.kind !== 'image' || !ACCEPTED.has(sniffed.mimeType)) {
      securityLogger.log('avatar.upload_rejected', { userId, reason: 'type' });
      throw new UnsupportedMediaTypeException(AVATAR_MESSAGES.UNSUPPORTED);
    }

    let data: Buffer;

    try {
      data = await processAvatarImage(file.buffer, sniffed);
    } catch (error) {
      if (error instanceof UnreadableImageError) {
        securityLogger.log('avatar.upload_rejected', { userId, reason: error.message });
        throw new UnprocessableEntityException(AVATAR_MESSAGES.UNREADABLE);
      }
      throw error;
    }

    const previous = await this.currentUrl(userId);
    const avatar = await this.store(userId, data);

    await this.removeOwnImage(userId, previous);
    return avatar;
  }

  /** Back to initials. */
  async clear(userId: string): Promise<SessionAvatar> {
    const previous = await this.currentUrl(userId);

    await prisma.user.update({
      where: { id: userId },
      data: { avatarPreset: null, avatarUrl: null },
      select: { id: true },
    });

    await this.removeOwnImage(userId, previous);
    return null;
  }

  /**
   * Copies an OAuth provider's profile photo onto our storage and makes it the
   * user's avatar, at first sign-up only.
   *
   * Copied rather than linked because Facebook's CDN URLs are signed and
   * expire, and Google's can change; a hot-linked avatar would quietly break
   * weeks later. **Never throws**: a slow CDN, a 404, an oversized or
   * non-image body, or a storage outage all leave the avatar empty (initials)
   * with a warning in the log, because none of them is a reason to fail a
   * sign-in. Also never overwrites: the write only lands while both avatar
   * columns are still empty.
   */
  async importFromUrl(userId: string, url: string | undefined): Promise<SessionAvatar> {
    if (!url) return null;

    let storedKey: string | null = null;

    try {
      const body = await this.fetchRemoteImage(url);
      const sniffed = sniffMedia(body.subarray(0, SNIFF_BYTES));

      if (sniffed?.kind !== 'image' || !ACCEPTED.has(sniffed.mimeType)) {
        throw new Error('response was not a PNG, JPEG or WebP image');
      }

      const data = await processAvatarImage(body, sniffed);
      storedKey = createAvatarKey(userId);
      await this.storage.put(storedKey, data, CONTENT_TYPES.webp);

      const avatarUrl = this.storage.publicUrl(storedKey);
      const { count } = await prisma.user.updateMany({
        where: { id: userId, avatarUrl: null, avatarPreset: null },
        data: { avatarUrl },
      });

      if (count === 0) {
        // Someone chose an avatar in the meantime; theirs wins.
        await this.removeKey(storedKey);
        return null;
      }

      return { kind: 'image', url: avatarUrl };
    } catch (error) {
      if (storedKey) await this.removeKey(storedKey);

      this.logger.warn(
        `Could not import the OAuth profile photo for user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /** Stores processed bytes and points the user at them, cleaning up if the write fails. */
  private async store(userId: string, data: Buffer): Promise<SessionAvatar> {
    const key = createAvatarKey(userId);
    await this.storage.put(key, data, CONTENT_TYPES.webp);

    try {
      const user = await prisma.user.update({
        where: { id: userId },
        data: { avatarUrl: this.storage.publicUrl(key), avatarPreset: null },
        select: AVATAR_COLUMNS,
      });

      return toSessionAvatar(user);
    } catch (error) {
      await this.removeKey(key);
      throw error;
    }
  }

  private async currentUrl(userId: string): Promise<string | null> {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { avatarUrl: true },
    });

    return user.avatarUrl;
  }

  /**
   * Deletes a previous avatar image if, and only if, it is one of this
   * user's objects on our storage. The key is recovered from the URL and must
   * map back to exactly that URL, so a URL we did not mint is never touched.
   */
  private async removeOwnImage(userId: string, url: string | null): Promise<void> {
    if (!url) return;

    const start = url.lastIndexOf('avatars/');
    if (start === -1) return;

    const key = url.slice(start);

    if (
      !isAvatarKey(key) ||
      !key.startsWith(`avatars/${userId}/`) ||
      this.storage.publicUrl(key) !== url
    ) {
      return;
    }

    await this.removeKey(key);
  }

  private async removeKey(key: string): Promise<void> {
    await this.storage.delete(key).catch((error: unknown) => {
      this.logger.warn(
        `Could not remove avatar object ${key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  /**
   * GETs an image from an allowlisted CDN with a timeout and a size cap.
   *
   * The cap is enforced while reading, not only from `Content-Length`, which a
   * server may omit or understate.
   */
  private async fetchRemoteImage(rawUrl: string): Promise<Buffer> {
    const signal = AbortSignal.timeout(REMOTE_AVATAR_TIMEOUT_MS);
    let url = rawUrl;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      assertAllowedRemote(url);

      const response = await fetch(url, { redirect: 'manual', signal });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error(`redirect ${response.status} without a location`);
        url = new URL(location, url).toString();
        continue;
      }

      if (!response.ok) {
        throw new Error(`photo request failed with ${response.status}`);
      }

      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > MAX_REMOTE_AVATAR_BYTES) {
        throw new Error(`photo is ${declared} bytes, over the cap`);
      }

      return readCapped(response, MAX_REMOTE_AVATAR_BYTES);
    }

    throw new Error('too many redirects');
  }
}

function assertAllowedRemote(url: string): void {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error('photo URL is not a URL');
  }

  const host = parsed.hostname.toLowerCase();

  if (
    parsed.protocol !== 'https:' ||
    !REMOTE_AVATAR_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    throw new Error(`photo host ${host} is not an allowed provider CDN`);
  }
}

async function readCapped(response: Response, cap: number): Promise<Buffer> {
  if (!response.body) {
    return Buffer.from(await response.arrayBuffer());
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      throw new Error('photo exceeded the size cap while downloading');
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks);
}
