/**
 * Emote Maker (Sprint 13, Module 14). Opened from Creator Tools, or from a
 * clip's Make An Emote with `?video=&clip=&from=&to=` (its video and range).
 *
 * The first page of the workspace's videos and clips is read here for Pick A
 * Clip; a list that did not load is treated as empty and the page says how
 * to bring a video in. Nothing is fetched while the workspace cookie still
 * names another workspace.
 */
import type { Metadata } from 'next';
import { ClipsDesktopOnly } from '@/components/clips/desktop-only';
import { EmoteMaker } from '@/components/clips/emote/emote-maker';
import {
  initialSource,
  parseEmoteQuery,
  sourceOptions,
} from '@/components/clips/emote/emote-model';
import { ClipsWorkspaceWaiting } from '@/components/clips/workspace-waiting';
import { serverApi } from '@/lib/api';
import { getActiveOrgId, getSessionCookieHeader } from '@/lib/session';
import type { ClipListPage, ClipVideoPage } from '@/types/clips';

export const metadata: Metadata = { title: 'Emote Maker' };

export default async function EmoteMakerRoute({
  params,
  searchParams,
}: PageProps<'/[orgId]/clips/tools/emote'>) {
  const [{ orgId }, query, cookie] = await Promise.all([
    params,
    searchParams,
    getSessionCookieHeader(),
  ]);
  if ((await getActiveOrgId()) !== orgId) {
    return (
      <ClipsDesktopOnly>
        <ClipsWorkspaceWaiting label="Opening Emote Maker" />
      </ClipsDesktopOnly>
    );
  }
  const [videos, clips] = await Promise.all([
    serverApi<ClipVideoPage>('/clips/videos', { cookie })
      .then((page) => page.videos.map((card) => card.video))
      .catch(() => []),
    serverApi<ClipListPage>('/clips', { cookie })
      .then((page) => page.clips)
      .catch(() => []),
  ]);
  const sources = sourceOptions(videos, clips);
  const start = parseEmoteQuery(query);

  return (
    <ClipsDesktopOnly>
      <EmoteMaker
        key={orgId}
        orgId={orgId}
        sources={sources}
        initial={initialSource(sources, start)}
      />
    </ClipsDesktopOnly>
  );
}
