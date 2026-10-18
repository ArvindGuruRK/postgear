import type { SessionAvatar } from './session';

/**
 * The preset avatars, as data: what the picker renders and how a stored
 * avatar becomes an image URL.
 *
 * The SVGs live in `public/avatars/` and are generated once by
 * `apps/web/scripts/generate-avatars.mjs` (DiceBear "Notionists", CC0 artwork:
 * see `public/avatars/README.md`).
 *
 * **Duplicated on purpose** in `apps/api/src/modules/users/avatar.presets.ts`,
 * which is the server's allowlist for `PUT /users/me/avatar/preset`. The web
 * app cannot import from the API package and the API should not trust a list
 * the browser sends, so the ids exist twice; adding an avatar is an entry in
 * the generator, here, and there.
 */

export interface AvatarPreset {
  id: string;
  /** Alt text: who is pictured, so a screen reader can tell the tiles apart. */
  label: string;
}

/** Picker order: the generator lays the colours out for a 4-column grid. */
export const AVATAR_PRESETS: readonly AvatarPreset[] = [
  { id: 'notionists-01', label: 'Person with a hair bow and sunglasses, on yellow' },
  { id: 'notionists-02', label: 'Long-haired person with a beard, waving, on blue' },
  { id: 'notionists-03', label: 'Smiling person with a top bun, on mint' },
  { id: 'notionists-04', label: 'Person with curly hair and round sunglasses, on orange' },
  { id: 'notionists-05', label: 'Person with two hair buns, waving, on violet' },
  { id: 'notionists-06', label: 'Smiling person with round glasses, on light blue' },
  { id: 'notionists-07', label: 'Person in a cap and heart sunglasses, on green' },
  { id: 'notionists-08', label: 'Person in a hijab, waving with both hands, on peach' },
  { id: 'notionists-09', label: 'Curly-haired person with a beard, on cream' },
  { id: 'notionists-10', label: 'Person with wavy hair and sunglasses, on lavender' },
  { id: 'notionists-11', label: 'Smiling person with glasses, on yellow' },
  { id: 'notionists-12', label: 'Person with two hair buns, on blue' },
  { id: 'notionists-13', label: 'Person with a ponytail making an OK sign, on green' },
  { id: 'notionists-14', label: 'Person with white hair and sunglasses, on orange' },
  { id: 'notionists-15', label: 'Smiling person with curly hair, on violet' },
  { id: 'notionists-16', label: 'Grinning person with a goatee, on mint' },
];

const PRESET_IDS = new Set(AVATAR_PRESETS.map((preset) => preset.id));

export function presetSrc(id: string): string {
  return `/avatars/${id}.svg`;
}

/**
 * The image URL for a stored avatar, or `undefined` for "draw initials".
 *
 * An unknown preset id (one retired from the set after a user picked it)
 * resolves to initials rather than a broken `<img>`.
 */
export function avatarSrc(avatar: SessionAvatar | undefined): string | undefined {
  if (!avatar) return undefined;
  if (avatar.kind === 'image') return avatar.url;
  return PRESET_IDS.has(avatar.id) ? presetSrc(avatar.id) : undefined;
}

/** Up to two initials, matching what `UserMenu` draws. */
export function initialsOf(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
