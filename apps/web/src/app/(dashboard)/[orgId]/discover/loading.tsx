/**
 * What Discover shows while the server asks for its status, the workspace's
 * settings and the viewer's role (Module 10). The page's own frame, drawn
 * empty: the two chips and Refresh in the actions row, the tab bar, then a
 * group of cards. So the page does not jump when the real one arrives, and
 * the top bar and the rail stay usable meanwhile (Next wraps the page in a
 * Suspense boundary with this as its fallback).
 */
import { PageActions, Skeleton, Stack } from '@postgear/ui';
import { DiscoverSkeleton } from '@/components/discover/discover-group';

export default function DiscoverLoading() {
  return (
    <Stack gap="lg">
      <PageActions className="items-start justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-10 w-56 rounded-lg" />
            <Skeleton className="h-10 w-28 rounded-lg" />
          </div>
          <Skeleton className="h-3 w-44" />
        </div>
        <Skeleton className="h-10 w-28 rounded-lg" />
      </PageActions>
      <Skeleton className="h-11 w-full max-w-2xl rounded-lg" />
      <DiscoverSkeleton />
    </Stack>
  );
}
