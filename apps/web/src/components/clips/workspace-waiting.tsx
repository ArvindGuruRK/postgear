/**
 * What a Clips page shows for the moment its link was opened before the
 * workspace cookie names this workspace (a bookmark, a shared link, the
 * first page after Login). The page fetches nothing then, since the API would
 * answer for another workspace or not at all; the workspace layout switches
 * the cookie and refreshes, and the page comes back with its data. Studio's
 * pages follow the same rule.
 */
import { Spinner } from '@postgear/ui';

export function ClipsWorkspaceWaiting({ label }: { label: string }) {
  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center p-10"
      data-testid="clips-workspace-waiting"
    >
      <Spinner aria-label={label} className="motion-reduce:animate-none" />
    </div>
  );
}
