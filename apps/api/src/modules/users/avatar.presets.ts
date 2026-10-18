/**
 * The preset avatar ids the API accepts.
 *
 * An allowlist rather than a pattern: `avatarPreset` is rendered by the web app
 * as `/avatars/<id>.svg`, so accepting any well-formed string would let a user
 * store an id with no file behind it and get a broken image. The pattern below
 * is a second fence for the test, not the check.
 *
 * **Duplicated on purpose** in `apps/web/src/lib/avatars.ts` (ids + alt text)
 * and `apps/web/scripts/generate-avatars.mjs` (seeds + colours): the API cannot
 * import from the web app, and it must not trust a list the browser sends.
 * Adding an avatar is an entry in all three, plus the generated SVG. Never
 * remove an id that has shipped: users have it stored.
 */
export const AVATAR_PRESET_IDS = [
  'notionists-01',
  'notionists-02',
  'notionists-03',
  'notionists-04',
  'notionists-05',
  'notionists-06',
  'notionists-07',
  'notionists-08',
  'notionists-09',
  'notionists-10',
  'notionists-11',
  'notionists-12',
  'notionists-13',
  'notionists-14',
  'notionists-15',
  'notionists-16',
] as const;

export type AvatarPresetId = (typeof AVATAR_PRESET_IDS)[number];

/** What a preset id must look like: it becomes a URL path segment and a filename. */
export const AVATAR_PRESET_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const PRESET_SET: ReadonlySet<string> = new Set(AVATAR_PRESET_IDS);

export function isAvatarPresetId(value: string): value is AvatarPresetId {
  return PRESET_SET.has(value);
}
