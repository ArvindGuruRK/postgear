/**
 * Clips (Sprint 12): long videos into short clips.
 *
 * A normal framed page (the rail and the top bar stay), desktop only. The
 * open tab comes from `?tab=`, and (Module 19) the Videos order from
 * `?sort=` (the storage notice links to `?tab=videos&sort=size`). The status (tools, platforms, storage, plan
 * limits) is read here so the first paint already has the meters and the
 * right buttons; a status that did not load is passed down as `null` and the
 * page asks again on its own. The island is keyed by the workspace, so
 * switching workspaces starts clean.
 */
import type { Metadata } from 'next';
import { clipsTabFrom, videoSortFrom } from '@/components/clips/clips-model';
import { ClipsView } from '@/components/clips/clips-view';
import { ClipsDesktopOnly } from '@/components/clips/desktop-only';
import { serverApi } from '@/lib/api';
import { getSessionCookieHeader } from '@/lib/session';
import type { ClipsStatus } from '@/types/clips';

export const metadata: Metadata = { title: 'Clips' };

export default async function ClipsRoute({ params, searchParams }: PageProps<'/[orgId]/clips'>) {
  const [{ orgId }, query, cookie] = await Promise.all([
    params,
    searchParams,
    getSessionCookieHeader(),
  ]);
  const status = await serverApi<{ status: ClipsStatus }>('/clips/status', { cookie })
    .then((answer) => answer.status)
    .catch(() => null);

  return (
    <ClipsDesktopOnly>
      <ClipsView
        key={orgId}
        orgId={orgId}
        initialTab={clipsTabFrom(query.tab)}
        initialSort={videoSortFrom(query.sort)}
        initialStatus={status}
      />
    </ClipsDesktopOnly>
  );
}
