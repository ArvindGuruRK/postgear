/**
 * The second line under a job waiting for its turn (Sprint 13, Module 15):
 * "Plans with a higher priority go first." while a low priority job waits,
 * nothing otherwise. The words are `lowPriorityLine` (`waiting-words.ts`);
 * each place passes its own note style.
 */
import type { ClipJobView } from '@/types/clips';
import { lowPriorityLine } from './waiting-words';

const DEFAULT_NOTE = 'm-0 font-sans text-xs text-ink type-muted';

export function WaitingNote({
  job,
  className = DEFAULT_NOTE,
}: {
  job: Pick<ClipJobView, 'status' | 'waiting'> | null | undefined;
  className?: string;
}) {
  const line = lowPriorityLine(job);
  if (!line) return null;
  return (
    <p className={className} data-testid="clips-waiting-note">
      {line}
    </p>
  );
}
