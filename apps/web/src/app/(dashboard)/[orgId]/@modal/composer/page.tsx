/**
 * The composer on a full page load of `/[orgId]/composer`: a reload, a
 * bookmark, a shared link (UI revamp, 2026-10-19).
 *
 * The composer is only ever a modal, never a page of its own, as in the
 * reference apps. So a direct load opens the same modal, over the calendar
 * (the page beneath, `../../composer/page.tsx`, renders the calendar). In-app
 * navigations never reach this file: they are intercepted by
 * `../(.)composer/page.tsx`, which opens the modal over whatever page the
 * person was on.
 *
 * `opened="direct"` tells the composer there is no in-app page to go back to:
 * closing goes to the calendar rather than back in history, which here would
 * leave the app. See `../(.)composer/page.tsx` for why the key is a fresh id
 * per render.
 */
import { randomUUID } from 'node:crypto';
import { Composer } from '@/components/composer/composer';
import { loadComposer } from '@/lib/composer-data';

export default async function ComposerDirectModal({
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
      opened="direct"
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
