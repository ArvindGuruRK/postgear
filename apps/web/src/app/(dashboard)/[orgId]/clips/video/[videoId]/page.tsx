/**
 * One video's page (Sprint 12, Module 07): play, mark and cut clips.
 *
 * The video, its signed light copy, filmstrip, waveform, import and clips are
 * read here, so the first paint has the player and the timeline. A video
 * that is not in this workspace (or was deleted) is a 404. Desktop only; the
 * island is keyed by the video so moving between videos starts clean.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ClipsDesktopOnly } from '@/components/clips/desktop-only';
import { ClipsWorkspaceWaiting } from '@/components/clips/workspace-waiting';
import { VideoPage } from '@/components/clips/video/video-page';
import { ApiError, serverApi } from '@/lib/api';
import { getActiveOrgId, getSessionCookieHeader } from '@/lib/session';
import type { ClipVideoDetail } from '@/types/clips';

export const metadata: Metadata = { title: 'Clips' };

export default async function ClipsVideoRoute({
  params,
  searchParams,
}: PageProps<'/[orgId]/clips/video/[videoId]'>) {
  const [{ orgId, videoId }, query, cookie] = await Promise.all([
    params,
    searchParams,
    getSessionCookieHeader(),
  ]);
  // `?clip=`: the editor's way back lands on the clip it edited.
  const clipId = typeof query.clip === 'string' ? query.clip : null;
  // Opened before the workspace cookie names this workspace: fetch nothing until the
  // layout's switch lands and refreshes the page.
  if ((await getActiveOrgId()) !== orgId) {
    return (
      <ClipsDesktopOnly>
        <ClipsWorkspaceWaiting label="Opening the video" />
      </ClipsDesktopOnly>
    );
  }
  const detail = await serverApi<ClipVideoDetail>(`/clips/videos/${encodeURIComponent(videoId)}`, {
    cookie,
  }).catch((cause: unknown) => {
    // A malformed id (400) or a video that is not here (404) is the same page.
    if (cause instanceof ApiError && (cause.status === 404 || cause.status === 400)) return null;
    throw cause;
  });
  if (!detail) notFound();

  return (
    <ClipsDesktopOnly>
      <VideoPage key={videoId} orgId={orgId} initial={detail} initialClipId={clipId} />
    </ClipsDesktopOnly>
  );
}
