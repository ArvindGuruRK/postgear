/**
 * Clips (Sprint 12): long videos into short clips.
 *
 * A normal framed page (the rail and the top bar stay), desktop only. The
 * open tab comes from `?tab=`; everything else is fetched by the tabs as
 * their modules land. The island is keyed by the workspace, so switching
 * workspaces starts clean.
 */
import type { Metadata } from 'next';
import { clipsTabFrom } from '@/components/clips/clips-model';
import { ClipsView } from '@/components/clips/clips-view';
import { ClipsDesktopOnly } from '@/components/clips/desktop-only';

export const metadata: Metadata = { title: 'Clips' };

export default async function ClipsRoute({ params, searchParams }: PageProps<'/[orgId]/clips'>) {
  const [{ orgId }, query] = await Promise.all([params, searchParams]);

  return (
    <ClipsDesktopOnly>
      <ClipsView key={orgId} orgId={orgId} initialTab={clipsTabFrom(query.tab)} />
    </ClipsDesktopOnly>
  );
}
