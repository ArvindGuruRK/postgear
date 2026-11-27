/**
 * Recipes And Brand Kit (Sprint 13, Module 10): the workspace's recipes (the
 * five starters and its own) and its Studio brand kits with their clip
 * fields. A framed page, desktop only like every Clips screen, reached from
 * the Clips page's actions row.
 *
 * Both lists are read here so the first paint has them; one that did not
 * load is passed down as `null` and the tab asks again on its own. Nothing is
 * fetched while the workspace cookie still names another workspace.
 */
import type { Metadata } from 'next';
import { kitTabFrom } from '@/components/clips/kit/kit-model';
import { KitView } from '@/components/clips/kit/kit-view';
import { ClipsDesktopOnly } from '@/components/clips/desktop-only';
import { ClipsWorkspaceWaiting } from '@/components/clips/workspace-waiting';
import { serverApi } from '@/lib/api';
import { getActiveOrgId, getSessionCookieHeader } from '@/lib/session';
import type { ClipBrandKitsView, RecipesView } from '@/types/clips-recipes';

export const metadata: Metadata = { title: 'Recipes And Brand Kit' };

export default async function ClipsKitRoute({
  params,
  searchParams,
}: PageProps<'/[orgId]/clips/kit'>) {
  const [{ orgId }, query, cookie] = await Promise.all([
    params,
    searchParams,
    getSessionCookieHeader(),
  ]);
  if ((await getActiveOrgId()) !== orgId) {
    return (
      <ClipsDesktopOnly>
        <ClipsWorkspaceWaiting label="Opening Recipes And Brand Kit" />
      </ClipsDesktopOnly>
    );
  }
  const [recipes, kits] = await Promise.all([
    serverApi<RecipesView>('/clips/recipes', { cookie }).catch(() => null),
    serverApi<ClipBrandKitsView>('/clips/brand-kits', { cookie })
      .then((answer) => answer.brandKits)
      .catch(() => null),
  ]);

  return (
    <ClipsDesktopOnly>
      <KitView
        key={orgId}
        orgId={orgId}
        initialTab={kitTabFrom(query.tab)}
        initialRecipes={recipes}
        initialKits={kits}
      />
    </ClipsDesktopOnly>
  );
}
