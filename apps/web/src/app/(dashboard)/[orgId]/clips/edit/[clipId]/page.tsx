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
import { EDITOR_TABS, type EditorTab } from '@/components/clips/editor/editor-state';
import {
  ClipUnreadable,
  MONTAGE_VIDEO_REMOVED_CODE,
  MONTAGE_VIDEO_REMOVED_SENTENCE,
} from '@/components/clips/editor/clip-unreadable';
import { ClipsDesktopOnly } from '@/components/clips/desktop-only';
import { ClipsWorkspaceWaiting } from '@/components/clips/workspace-waiting';
import { ApiError, serverApi } from '@/lib/api';
import { getActiveOrgId, getSessionCookieHeader } from '@/lib/session';
import type { ClipDetail } from '@/types/clips';

export const metadata: Metadata = { title: 'Clip Editor' };

/** `?tab=export` (a ready export's notice) opens that tab; anything else opens the first. */
function tabOf(value: string | string[] | undefined): EditorTab | undefined {
  return typeof value === 'string' && (EDITOR_TABS as readonly string[]).includes(value)
    ? (value as EditorTab)
    : undefined;
}

export default async function ClipEditRoute({
  params,
  searchParams,
}: PageProps<'/[orgId]/clips/edit/[clipId]'>) {
  const [{ orgId, clipId }, query, cookie] = await Promise.all([
    params,
    searchParams,
    getSessionCookieHeader(),
  ]);
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
    // Module 11: a montage one of whose videos was removed cannot be opened.
    if (cause instanceof ApiError && cause.code === MONTAGE_VIDEO_REMOVED_CODE) {
      return 'video_removed' as const;
    }
    throw cause;
  });
  if (!detail) notFound();
  if (detail === 'video_removed') {
    return (
      <ClipsDesktopOnly>
        <ClipUnreadable
          orgId={orgId}
          videoId={null}
          clipId={clipId}
          sentence={MONTAGE_VIDEO_REMOVED_SENTENCE}
        />
      </ClipsDesktopOnly>
    );
  }

  const document = detail.clip.document;

  return (
    <ClipsDesktopOnly>
      {document ? (
        <ClipEditor
          key={clipId}
          orgId={orgId}
          initial={detail}
          document={document}
          initialTab={tabOf(query.tab)}
        />
      ) : (
        <ClipUnreadable orgId={orgId} videoId={detail.video?.id ?? null} clipId={clipId} />
      )}
    </ClipsDesktopOnly>
  );
}
