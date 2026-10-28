/**
 * Edit Design (Sprint 9, Screen 4): the Design Studio editor.
 *
 * The server loads the design and the brand kits so the editor is there on
 * first paint, with whether the plan includes premium looks (Sprint 9b), so
 * the Design tab's premium themes and art are locked from the first paint
 * too. A design that is not there, or is another workspace's, is the
 * not-found page: the API answers both alike, so nothing about it is shown.
 * One this version cannot read is handed down with the API's sentence. Any
 * other failure is handed down as `null`, and the editor tries again itself.
 *
 * Nothing is fetched while the active-workspace cookie names another
 * workspace (see the Studio page): the editor loads the design once the
 * switch has landed.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StudioEditor } from '@/components/studio/studio-editor';
import {
  type DesignOutcome,
  type LoadFailure,
  loadFailureOf,
} from '@/components/studio/studio-editor-model';
import { serverApi } from '@/lib/api';
import { getActiveOrgId, getSessionCookieHeader } from '@/lib/session';
import type { BrandKitView, DesignDetail, StudioAccess } from '@/types/studio';

export const metadata: Metadata = { title: 'Edit Design' };

async function loadDesign(designId: string, cookie: string): Promise<DesignOutcome | LoadFailure> {
  try {
    const { design } = await serverApi<{ design: DesignDetail }>(
      `/studio/designs/${encodeURIComponent(designId)}`,
      { cookie },
    );
    return { kind: 'ready', design };
  } catch (cause) {
    return loadFailureOf(cause);
  }
}

export default async function EditDesignPage({ params }: PageProps<'/[orgId]/studio/[designId]'>) {
  const { orgId, designId } = await params;
  const cookie = await getSessionCookieHeader();
  const pending = (await getActiveOrgId()) !== orgId;

  const [loaded, kits, access] = pending
    ? [null, null, null]
    : await Promise.all([
        loadDesign(designId, cookie),
        serverApi<{ brandKits: BrandKitView[] }>('/studio/brand-kits', { cookie })
          .then((result) => result.brandKits)
          .catch(() => null),
        // Not known is no lock at all: the island asks again, and the API has the last word.
        serverApi<StudioAccess>('/studio/access', { cookie }).catch(() => null),
      ]);

  // Outside any try: `notFound()` works by throwing.
  if (loaded?.kind === 'missing') notFound();

  const initial = loaded?.kind === 'ready' || loaded?.kind === 'unreadable' ? loaded : null;

  return (
    <StudioEditor
      key={designId}
      orgId={orgId}
      designId={designId}
      initial={initial}
      initialKits={kits}
      initialAccess={access}
    />
  );
}
