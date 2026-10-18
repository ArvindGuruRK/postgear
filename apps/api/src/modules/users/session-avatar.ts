import type { User } from '@postgear/db';

/**
 * The user's avatar as the API returns it: a bundled preset, an image on our
 * storage (an upload, or the OAuth photo re-hosted at signup), or none (the UI
 * draws initials). Mirrored on the web side by `SessionAvatar` in
 * `apps/web/src/lib/session.ts`.
 *
 * In its own file rather than in `auth.service.ts` (which re-exports both) so
 * `AvatarService` can use it without an import cycle: `AuthService` injects
 * `AvatarService`, and a cycle between the two would leave one class
 * `undefined` in the other's DI metadata depending on load order.
 */
export type SessionAvatar = { kind: 'preset'; id: string } | { kind: 'image'; url: string } | null;

/** Maps the two avatar columns to the API shape; the image wins if both are set. */
export function toSessionAvatar(user: Pick<User, 'avatarUrl' | 'avatarPreset'>): SessionAvatar {
  if (user.avatarUrl) return { kind: 'image', url: user.avatarUrl };
  if (user.avatarPreset) return { kind: 'preset', id: user.avatarPreset };
  return null;
}
