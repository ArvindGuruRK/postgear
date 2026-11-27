/**
 * Creator Tools (Sprint 13, Module 14): the hub reached from the Clips
 * page's Creator Tools button, with the Emote Maker and the Schedule Maker.
 * A framed page, desktop only like every Clips screen. It reads nothing.
 */
import type { Metadata } from 'next';
import { ClipsDesktopOnly } from '@/components/clips/desktop-only';
import { CreatorTools } from '@/components/clips/emote/creator-tools';

export const metadata: Metadata = { title: 'Creator Tools' };

export default async function CreatorToolsRoute({ params }: PageProps<'/[orgId]/clips/tools'>) {
  const { orgId } = await params;
  return (
    <ClipsDesktopOnly>
      <CreatorTools orgId={orgId} />
    </ClipsDesktopOnly>
  );
}
