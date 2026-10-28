/**
 * Create Design: the three-step wizard (Sprint 9, DS-2.4 and DS-3).
 *
 * The server loads the brand kits, the favourite templates and whether the
 * plan includes premium templates (Sprint 9b), so the first step is there on
 * first paint and the gallery's locks are right from the start; which step
 * is open, and every answer so far, is in the URL, which the island reads.
 * Nothing workspace-scoped is fetched while the active-workspace cookie names
 * another workspace (see the Studio page); the island loads all three itself
 * once the switch has landed.
 */
import type { Metadata } from 'next';
import { StudioWizard } from '@/components/studio/studio-wizard';
import { serverApi } from '@/lib/api';
import { getActiveOrgId, getSessionCookieHeader } from '@/lib/session';
import type { BrandKitView, StudioAccess } from '@/types/studio';

export const metadata: Metadata = { title: 'Create Design' };

export default async function CreateDesignPage({ params }: PageProps<'/[orgId]/studio/new'>) {
  const { orgId } = await params;
  const cookie = await getSessionCookieHeader();
  const pending = (await getActiveOrgId()) !== orgId;

  const [kits, favourites, access] = pending
    ? [null, null, null]
    : await Promise.all([
        serverApi<{ brandKits: BrandKitView[] }>('/studio/brand-kits', { cookie })
          .then((result) => result.brandKits)
          .catch(() => null),
        serverApi<{ presetIds: string[] }>('/studio/favourites', { cookie })
          .then((result) => result.presetIds)
          .catch(() => null),
        serverApi<StudioAccess>('/studio/access', { cookie }).catch(() => null),
      ]);

  return (
    <StudioWizard
      orgId={orgId}
      initialKits={kits}
      initialFavourites={favourites}
      initialAccess={access}
    />
  );
}
