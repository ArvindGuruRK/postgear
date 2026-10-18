/**
 * The composer as a modal (UI revamp, 2026-10-19): any in-app navigation to
 * `/[orgId]/composer` (Create Post, a calendar slot, a post's card, Edit,
 * "Use in a post") is intercepted here and opens over the page the person
 * was on, the way the reference composes over its calendar.
 *
 * The URL still changes, so `?group=` / `?at=` / `?media=` work as links, and
 * the browser's back button closes the modal. A reload or a shared link opens
 * the same modal over the calendar instead (`../composer/page.tsx`, with
 * `opened="direct"`). Same loader, same component: it is always a modal.
 *
 * ## Why the composer's key is a fresh id per render
 *
 * The composer keeps its state in the client, and after a first save it
 * rewrites the URL to `?group=` without navigating (so editors are not torn
 * down). A key derived from the URL would therefore see "new post" before and
 * after, and opening a new post from a just-saved draft would keep showing the
 * draft. This server component only renders on a navigation, so a random key
 * per render means exactly: every navigation into the composer starts from
 * what the server says, and nothing else remounts it.
 */
import { randomUUID } from 'node:crypto';
import { Composer } from '@/components/composer/composer';
import { loadComposer } from '@/lib/composer-data';

export default async function ComposerModalPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orgId } = await params;
  const data = await loadComposer(await searchParams);

  return (
    <Composer
      key={randomUUID()}
      opened="in-app"
      orgId={orgId}
      channels={data.channels}
      providers={data.providers}
      initialPost={data.post}
      initialMedia={data.media}
      initialPublishAt={data.publishAt}
      loadError={data.loadError}
    />
  );
}
