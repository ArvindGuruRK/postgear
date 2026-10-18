/**
 * What sits beneath the composer when `/[orgId]/composer` is loaded directly
 * (a reload, a bookmark, a shared link): the calendar (UI revamp,
 * 2026-10-19).
 *
 * The composer is only ever a modal, never a page of its own. On a direct
 * load, the modal itself comes from the `@modal` slot
 * (`../@modal/composer/page.tsx`) and this page supplies the calendar it
 * opens over, the app's home. In-app navigations to the composer are
 * intercepted (`../@modal/(.)composer`) and keep whatever page was already
 * there, so this renders only on a direct load.
 */
import type { Metadata } from 'next';
import CalendarPage from '../calendar/page';

export const metadata: Metadata = { title: 'Create Post' };

export default async function ComposerBackdrop({
  params,
  searchParams,
}: PageProps<'/[orgId]/composer'>) {
  return <CalendarPage params={params} searchParams={searchParams} />;
}
