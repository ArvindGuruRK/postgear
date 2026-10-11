/**
 * From stored rows to what a provider publishes — pure, and tested on its own.
 *
 * The composer, the API and this file all render a post through the same
 * `renderPlainText`, so the text a platform receives is the text the preview
 * showed, to the character. Media ids become public URLs here, at publish
 * time, which is why a stored post never holds a stale URL.
 */
import { parsePublishStatus } from '@postgear/scheduling';
import type { MediaDescriptor, PostDetails } from '@postgear/social-core';
import { parseDocument, renderPlainText } from '@postgear/social-core';

/** The columns of a `Post` row this module reads. */
export interface ChainRow {
  id: string;
  parentPostId: string | null;
  content: string;
  image: string | null;
  settings: string | null;
}

/** The columns of a `Media` row this module reads. */
export interface MediaRow {
  id: string;
  type: string;
  path: string;
  thumbnail: string | null;
  alt: string | null;
  mimeType: string | null;
  fileSize: number;
  width: number | null;
  height: number | null;
}

/**
 * Orders one channel's rows from the root to the last part by following
 * parent links — the same tolerant walk the API's repository uses: an orphan
 * is a root, a cycle cannot loop, and whatever the walk never reaches is
 * appended rather than lost.
 */
export function orderChain<T extends { id: string; parentPostId: string | null }>(rows: T[]): T[] {
  const ids = new Set(rows.map((row) => row.id));
  const children = new Map<string, T[]>();
  const roots: T[] = [];

  for (const row of rows) {
    if (row.parentPostId && ids.has(row.parentPostId)) {
      children.set(row.parentPostId, [...(children.get(row.parentPostId) ?? []), row]);
    } else {
      roots.push(row);
    }
  }

  const ordered: T[] = [];
  const seen = new Set<string>();
  const queue = [...roots];

  while (queue.length > 0) {
    const row = queue.shift() as T;

    if (seen.has(row.id)) {
      continue;
    }

    seen.add(row.id);
    ordered.push(row);
    queue.unshift(...(children.get(row.id) ?? []));
  }

  for (const row of rows) {
    if (!seen.has(row.id)) {
      ordered.push(row);
    }
  }

  return ordered;
}

/** `Post.image` is `[{"id": …}]`; anything else yields no ids. */
export function parseImageIds(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    return Array.isArray(parsed)
      ? parsed.flatMap((entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as { id?: unknown }).id === 'string'
            ? [(entry as { id: string }).id]
            : [],
        )
      : [];
  } catch {
    return [];
  }
}

/**
 * Provider options stored on the row.
 *
 * `customized` is the composer's own flag, not a provider setting, so it is
 * dropped; everything else (a YouTube title, a Pinterest board) passes through
 * for the provider to validate.
 */
export function parseProviderSettings(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    const { customized: _customized, ...settings } = parsed as Record<string, unknown>;
    return settings;
  } catch {
    return {};
  }
}

export function toMediaDescriptor(
  media: MediaRow,
  publicUrl: (key: string) => string,
): MediaDescriptor {
  return {
    type: media.type === 'video' ? 'video' : 'image',
    path: publicUrl(media.path),
    alt: media.alt ?? undefined,
    thumbnail: media.thumbnail ? publicUrl(media.thumbnail) : undefined,
    mimeType: media.mimeType ?? undefined,
    bytes: media.fileSize,
    width: media.width ?? undefined,
    height: media.height ?? undefined,
  };
}

/**
 * The parts of one channel's chain, rendered and ready for `provider.post`.
 *
 * A media id with no live row (deleted from the library after the post was
 * queued) is skipped rather than failing the publish: the composer already
 * showed it as removed, and a post without one of its images is what the
 * person would see if they reopened it.
 */
export function buildPostDetails(
  rows: ChainRow[],
  mediaById: Map<string, MediaRow>,
  publicUrl: (key: string) => string,
): PostDetails[] {
  return orderChain(rows).map((row) => ({
    id: row.id,
    message: renderPlainText(parseDocument(row.content)),
    media: parseImageIds(row.image).flatMap((id) => {
      const media = mediaById.get(id);
      return media ? [toMediaDescriptor(media, publicUrl)] : [];
    }),
    settings: parseProviderSettings(row.settings),
  }));
}

/** The first line of a rendered post, for notifications and logs. */
export function previewOf(details: PostDetails[], length = 80): string {
  const text = details[0]?.message.split('\n').find((line) => line.trim() !== '') ?? '';
  const characters = Array.from(text.trim());

  return characters.length <= length
    ? characters.join('')
    : `${characters
        .slice(0, length - 1)
        .join('')
        .trimEnd()}…`;
}

/**
 * True when the root row still carries an `in_flight` marker from an attempt
 * before this one. The marker is written just before the platform is called
 * and replaced by every outcome the activity can record; only an attempt that
 * died mid-call leaves it behind.
 */
export function previousAttemptInFlight(rawStatus: string | null, currentAttempt: number): boolean {
  const status = parsePublishStatus(rawStatus);
  return status?.kind === 'in_flight' && status.attempt < currentAttempt;
}
