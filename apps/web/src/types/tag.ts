/**
 * Post tags (2026-10-19, after Postiz's tags): a workspace's own labels,
 * each in one colour of the avatar palette, so a tag reads the same on the
 * calendar card, in the composer and in the filter. Mirrors `/tags`.
 *
 * The colour is stored by name rather than as a hex value: every colour in
 * the app comes from a theme token, and the palette is the same in every
 * theme. `TAG_COLORS` is the order the picker shows them in, and the API
 * accepts exactly these names.
 */
export const TAG_COLORS = ['violet', 'teal', 'green', 'yellow', 'orange', 'rose', 'cyan'] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export interface Tag {
  id: string;
  name: string;
  color: TagColor;
}

/** Fill and text classes per colour: the `--color-avatar-*` pairs in packages/ui colors.css. */
export const TAG_COLOR_CLASS: Record<TagColor, string> = {
  violet: 'bg-avatar1 text-onAvatar1',
  teal: 'bg-avatar2 text-onAvatar2',
  green: 'bg-avatar3 text-onAvatar3',
  yellow: 'bg-avatar4 text-onAvatar4',
  orange: 'bg-avatar5 text-onAvatar5',
  rose: 'bg-avatar6 text-onAvatar6',
  cyan: 'bg-avatar7 text-onAvatar7',
};

/** Shown in the colour picker and read out to screen readers. */
export const TAG_COLOR_LABEL: Record<TagColor, string> = {
  violet: 'Violet',
  teal: 'Teal',
  green: 'Green',
  yellow: 'Yellow',
  orange: 'Orange',
  rose: 'Rose',
  cyan: 'Cyan',
};
