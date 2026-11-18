/**
 * The clip editor (Sprint 12, Module 08), in the whole window
 * (`immersion()`: `clips/edit/{clipId}` is `fixed`).
 *
 * The clip, its video, the signed light copy, the filmstrip and whether the
 * sharp video is in are read here, so the first paint has the editor. A clip
 * that is not in this workspace (or was deleted) is a 404. Desktop only; the
 * island is keyed by the clip so moving between clips starts clean.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ClipEditor } from '@/components/clips/editor/clip-editor';
import { ClipUnreadable } from '@/components/clips/editor/clip-unreadable';
import { ClipsDesktopOnly } from '@/components/clips/desktop-only';
import { ClipsWorkspaceWaiting } from '@/components/clips/workspace-waiting';
import { ApiError, serverApi } from '@/lib/api';
import { getActiveOrgId, getSessionCookieHeader } from '@/lib/session';
import type { ClipDetail } from '@/types/clips';

export const metadata: Metadata = { title: 'Clip Editor' };

export default async function ClipEditRoute({ params }: PageProps<'/[orgId]/clips/edit/[clipId]'>) {
  const [{ orgId, clipId }, cookie] = await Promise.all([params, getSessionCookieHeader()]);
  // Opened before the workspace cookie names this workspace: fetch nothing until the
  // layout's switch lands and refreshes the page.
  if ((await getActiveOrgId()) !== orgId) {
    return (
      <ClipsDesktopOnly>
        <ClipsWorkspaceWaiting label="Opening the clip" />
      </ClipsDesktopOnly>
    );
  }
  const detail = await serverApi<ClipDetail>(`/clips/${encodeURIComponent(clipId)}`, {
    cookie,
  }).catch((cause: unknown) => {
    // A malformed id (400) or a clip that is not here (404) is the same page.
    if (cause instanceof ApiError && (cause.status === 404 || cause.status === 400)) return null;
    throw cause;
  });
  if (!detail) notFound();

  const document = detail.clip.document;

  return (
    <ClipsDesktopOnly>
      {document ? (
        <ClipEditor key={clipId} orgId={orgId} initial={detail} document={document} />
      ) : (
        <ClipUnreadable orgId={orgId} videoId={detail.video?.id ?? null} clipId={clipId} />
      )}
    </ClipsDesktopOnly>
  );
}
