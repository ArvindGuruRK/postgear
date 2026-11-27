/**
 * Schedule Maker (Sprint 13, Module 14 section C4): a week of streams as a
 * picture, from a Twitch name or typed by hand, opened as an ordinary Design
 * Studio design. A framed page, desktop only like every Clips screen,
 * reached from Creator Tools.
 *
 * Nothing is read on the server: the page has nothing to show until the
 * person types a name, and the browser's own zone is the default. Nothing is
 * shown while the workspace cookie still names another workspace.
 *
 * The props are typed by hand rather than through the generated
 * `PageProps<'/[orgId]/clips/tools/schedule'>`, which only exists once the
 * dev server has seen the route.
 */
import type { Metadata } from 'next';
import { ScheduleMaker } from '@/components/clips/schedule/schedule-maker';
import { ClipsDesktopOnly } from '@/components/clips/desktop-only';
import { ClipsWorkspaceWaiting } from '@/components/clips/workspace-waiting';
import { getActiveOrgId } from '@/lib/session';

export const metadata: Metadata = { title: 'Schedule Maker' };

export default async function ScheduleMakerRoute({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  if ((await getActiveOrgId()) !== orgId) {
    return (
      <ClipsDesktopOnly>
        <ClipsWorkspaceWaiting label="Opening Schedule Maker" />
      </ClipsDesktopOnly>
    );
  }

  return (
    <ClipsDesktopOnly>
      <ScheduleMaker key={orgId} orgId={orgId} />
    </ClipsDesktopOnly>
  );
}
