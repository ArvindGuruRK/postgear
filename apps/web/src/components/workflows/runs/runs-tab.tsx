'use client';

/**
 * The Runs tab (Module 08, blueprint 7.3): the run list on the left, the
 * chosen run on the right (its own graph version painted read-only, the
 * step list, Copy Details, Cancel Run, Retry From Here, Debug In Editor and
 * a waiting Manual Review's card).
 *
 * Below `lg` (like the builder's own small-screen layout) the two stack:
 * the list, then the chosen run with a Back control in its place.
 */
import { cn, EmptyState } from '@postgear/ui';
import { History } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { PinnedStep, RunSummary, WorkspaceCatalog } from '@/types/workflows';
import { RunDetail } from './run-detail';
import { RunList } from './run-list';
import type { RunPatch } from './run-list-model';

export interface RunsTabProps {
  orgId: string;
  automationId: string;
  automationName: string;
  catalog: WorkspaceCatalog | null;
  /** The live version now, for Retry From Here's "older version" rule. */
  activeVersion: number | null;
  /** `?run=`: the run shown on the right. */
  runId: string | null;
  /** `?review=1`: open the run's waiting review card at once. */
  openReview: boolean;
  /** Keeps `?run=` in the address bar. */
  onSelectRun: (runId: string | null) => void;
  /**
   * Debug In Editor: the pins are already saved through the API. The page
   * swaps them in, switches to the Editor and selects `focusKey`.
   */
  onDebugInEditor: (result: { pinned: PinnedStep[]; focusKey: string | null }) => void;
}

export function RunsTab({
  automationId,
  automationName,
  catalog,
  activeVersion,
  runId,
  openReview,
  onSelectRun,
  onDebugInEditor,
}: RunsTabProps) {
  const [reloadKey, setReloadKey] = useState(0);
  const [patch, setPatch] = useState<RunPatch | null>(null);

  const onSelect = useCallback((id: string) => onSelectRun(id), [onSelectRun]);
  const onBack = useCallback(() => onSelectRun(null), [onSelectRun]);
  const onRetried = useCallback(
    (run: RunSummary) => {
      setReloadKey((value) => value + 1);
      onSelectRun(run.id);
    },
    [onSelectRun],
  );

  return (
    <div
      className="flex min-h-0 flex-1 overflow-hidden rounded-card border-2 border-outline shadow-brutalSm"
      data-testid="runs-tab"
    >
      <aside
        aria-label="Run history"
        className={cn(
          'min-h-0 w-full flex-col bg-chrome lg:flex lg:w-80 lg:shrink-0 lg:border-r-2 lg:border-outline',
          runId ? 'hidden' : 'flex',
        )}
      >
        <RunList
          automationId={automationId}
          catalog={catalog}
          selectedId={runId}
          onSelect={onSelect}
          reloadKey={reloadKey}
          patch={patch}
        />
      </aside>

      <section
        aria-label="Chosen run"
        className={cn(
          'min-h-0 min-w-0 flex-1 flex-col bg-chrome lg:flex',
          runId ? 'flex' : 'hidden',
        )}
      >
        {runId ? (
          <RunDetail
            key={runId}
            automationId={automationId}
            automationName={automationName}
            catalog={catalog}
            activeVersion={activeVersion}
            runId={runId}
            openReview={openReview}
            onBack={onBack}
            onRetried={onRetried}
            onRunPatch={setPatch}
            onDebugInEditor={onDebugInEditor}
          />
        ) : (
          <EmptyState
            icon={History}
            title="Choose a run"
            description="Its steps, their data and any review waiting for an answer show here."
            className="flex-1"
          />
        )}
      </section>
    </div>
  );
}
