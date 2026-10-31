/**
 * Rules behind the step form's Media field (Module 10): the chip input
 * holds media from earlier steps (a template), and Pick From Media keeps
 * Media library ids at the field's `libraryPath`, at most 10. Pure, so the
 * limits are unit tested.
 */

/** The most library items one posting step takes (the catalog's `mediaIds` cap). */
export const MAX_LIBRARY_MEDIA = 10;

/** The ids stored at `libraryPath`: text only, each once, in order. */
export function libraryIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry === 'string' && entry !== '') seen.add(entry);
  }
  return [...seen];
}

/** How many more items Pick From Media may add. */
export function slotsLeft(current: readonly string[], max = MAX_LIBRARY_MEDIA): number {
  return Math.max(0, max - current.length);
}

/** `current` plus the new picks, never twice, cut at `max`. */
export function addLibraryPicks(
  current: readonly string[],
  picks: readonly string[],
  max = MAX_LIBRARY_MEDIA,
): string[] {
  const next = [...current];
  for (const id of picks) {
    if (next.length >= max) break;
    if (id && !next.includes(id)) next.push(id);
  }
  return next;
}

export function removeLibraryPick(current: readonly string[], id: string): string[] {
  return current.filter((entry) => entry !== id);
}

/** What the field writes back: nothing at all once the last pick is removed. */
export function storedPicks(ids: readonly string[]): string[] | undefined {
  return ids.length > 0 ? [...ids] : undefined;
}
