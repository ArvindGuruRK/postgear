/**
 * Clip Setup (Sprint 13, Module 05): the choices of one Find Clips run, and
 * its price in AI minutes before anything runs. The video is read here; the
 * price is asked for by the form as the choices change. Desktop only, like
 * every Clips screen; another workspace's video (or a bad id) is a 404.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ClipsDesktopOnly } from '@/components/clips/desktop-only';
import { SetupForm } from '@/components/clips/setup/setup-form';
import { ClipsWorkspaceWaiting } from '@/components/clips/workspace-waiting';
import { ApiError, serverApi } from '@/lib/api';
import { getActiveOrgId, getSessionCookieHeader } from '@/lib/session';
import type { ClipVideoDetail } from '@/types/clips';

export const metadata: Metadata = { title: 'Clip Setup' };

export default async function ClipSetupRoute({
  params,
}: PageProps<'/[orgId]/clips/video/[videoId]/setup'>) {
  const [{ orgId, videoId }, cookie] = await Promise.all([params, getSessionCookieHeader()]);
  if ((await getActiveOrgId()) !== orgId) {
    return (
      <ClipsDesktopOnly>
        <ClipsWorkspaceWaiting label="Opening Clip Setup" />
      </ClipsDesktopOnly>
    );
  }
  const detail = await serverApi<ClipVideoDetail>(`/clips/videos/${encodeURIComponent(videoId)}`, {
    cookie,
  }).catch((cause: unknown) => {
    if (cause instanceof ApiError && (cause.status === 404 || cause.status === 400)) return null;
    throw cause;
  });
  if (detail?.video.status !== 'READY') notFound();

  return (
    <ClipsDesktopOnly>
      <SetupForm key={videoId} orgId={orgId} detail={detail} />
    </ClipsDesktopOnly>
  );
}
