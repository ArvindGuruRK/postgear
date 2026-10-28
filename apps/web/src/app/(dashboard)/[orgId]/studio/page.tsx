/**
 * Design Studio (Sprint 9): the brand kits and the workspace's designs.
 *
 * The server renders the first page of designs and the brand kits so both
 * are there on first paint, with whether the plan includes premium templates
 * (Sprint 9b) so a premium template offered here is locked from the first
 * paint too; the client island owns search, the format filter, paging and
 * every action. A failed first load is handed down as `null`, and the island
 * shows its own Try Again.
 *
 * Nothing is fetched while the active-workspace cookie names another
 * workspace (right after a switch, or after signing in to an account with
 * two): the API scopes on that cookie, so the answer would be the other
 * workspace's designs. The island then loads them itself once the switch
 * has landed.
 */
import type { Metadata } from 'next';
import { StudioLanding } from '@/components/studio/studio-landing';
import { serverApi } from '@/lib/api';
import { getActiveOrgId, getSessionCookieHeader } from '@/lib/session';
import type { BrandKitView, DesignPage, StudioAccess } from '@/types/studio';

export const metadata: Metadata = { title: 'Design Studio' };

export default async function StudioPage({ params }: PageProps<'/[orgId]/studio'>) {
  const { orgId } = await params;
  const cookie = await getSessionCookieHeader();
  const pending = (await getActiveOrgId()) !== orgId;

  const [designs, kits, access] = pending
    ? [null, null, null]
    : await Promise.all([
        serverApi<DesignPage>('/studio/designs?page=1', { cookie }).catch(() => null),
        serverApi<{ brandKits: BrandKitView[] }>('/studio/brand-kits', { cookie })
          .then((result) => result.brandKits)
          .catch(() => null),
        serverApi<StudioAccess>('/studio/access', { cookie }).catch(() => null),
      ]);

  return (
    <StudioLanding
      orgId={orgId}
      initialDesigns={designs}
      initialKits={kits}
      initialAccess={access}
    />
  );
}
