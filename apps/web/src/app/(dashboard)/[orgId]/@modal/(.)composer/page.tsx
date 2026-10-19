/**
 * The composer as a modal (UI revamp, 2026-10-19): any in-app navigation to
 * `/[orgId]/composer` (Create Post, a calendar slot, a post's card, Edit,
 * "Use in a post") is intercepted here and opens over the page the person
 * was on, the way the reference composes over its calendar.
 *
 * The URL still changes, so `?group=` / `?at=` / `?media=` / `?template=` /
 * `?duplicate=` / `?channel=` work as links (`lib/composer-data.ts` says what
 * each means), and the browser's back button closes the modal. A reload or
 * a shared link opens the same modal over the calendar instead
 * (`../composer/page.tsx`, with `opened="direct"`). Same loader, same
 * component: it is always a modal.
 *
 * Each render passes a fresh `renderId` and what its URL asked for, and
 * `ComposerHost` decides from those whether this render is a navigation to
 * start over from or a refresh to keep the writing through.
 */
import { randomUUID } from 'node:crypto';
import { ComposerHost } from '@/components/composer/composer-host';
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
    <ComposerHost
      renderId={randomUUID()}
      request={data.request}
      opened="in-app"
      orgId={orgId}
      channels={data.channels}
      providers={data.providers}
      initialPost={data.post}
      initialMedia={data.media}
      initialPublishAt={data.publishAt}
      initialText={data.text}
      initialParts={data.parts}
      initialChannelId={data.channelId}
      initialSignature={data.signature}
      loadError={data.loadError}
    />
  );
}
