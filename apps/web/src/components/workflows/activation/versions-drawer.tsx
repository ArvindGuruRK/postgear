'use client';

/**
 * Versions (Module 09, blueprint 8; after n8n, 2026-11-03): a dock beside the
 * canvas with Current Changes on top and every activated version under it, with
 * its number, author, time, note and the Active marker. Choosing one previews it
 * read-only on the hatched canvas, with the dock still open to compare others.
 * The canvas's Actions menu offers Restore As Draft (Zapier's rollback). A
 * version itself is never edited.
 */
import { ChevronDownIcon } from '@animateicons/react/lucide/chevron-down-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
import {
  Alert,
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MotionIcon,
  Skeleton,
  Text,
  toast,
} from '@postgear/ui';
import { useCallback, useEffect, useState } from 'react';
import { getVersion, listVersions, restoreVersion } from '@/lib/workflows-api';
import type { AutomationDetail, VersionDetail, VersionSummary } from '@/types/workflows';
import {
  NO_VERSIONS,
  restoredToast,
  restoreFailure,
  saveFirstFailure,
  versionByline,
  versionTitle,
} from './activation-model';

export interface VersionsDockProps {
  automationId: string;
  /** The version previewed now, if any. */
  previewing: number | null;
  /** Preview one on the canvas; null goes back to the draft. */
  onPreview: (version: VersionDetail | null) => void;
  onClose: () => void;
}

/** One row of the list: quiet until pressed, marked while it is on the canvas. */
const ROW =
  'flex w-full flex-col items-start gap-1 rounded-md px-2 py-2 text-left text-ink outline-none hover:bg-primary focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing disabled:opacity-50';

export function VersionsDock({ automationId, previewing, onPreview, onClose }: VersionsDockProps) {
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState<number | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setVersions(await listVersions(automationId));
    } catch {
      setFailed(true);
    }
  }, [automationId]);

  // Fresh each time it opens: a version may have been added since.
  useEffect(() => {
    void load();
  }, [load]);

  async function preview(summary: VersionSummary) {
    if (summary.version === previewing) return;
    setOpening(summary.version);
    try {
      onPreview(await getVersion(automationId, summary.version));
    } catch {
      toast({ title: 'That version could not be opened. Try again.', variant: 'danger' });
    } finally {
      setOpening(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="versions-drawer">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b-2 border-outline px-4">
        <h2 className="type-heading min-w-0 flex-1 truncate text-lg text-ink">Versions</h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 px-0"
          aria-label="Close versions"
          onClick={onClose}
        >
          <MotionIcon icon={XIcon} className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
        <button
          type="button"
          onClick={() => onPreview(null)}
          aria-current={previewing === null ? 'true' : undefined}
          data-testid="version-current"
          className={cn(ROW, previewing === null ? 'bg-primary' : '')}
        >
          <span className="type-ui text-sm">Current Changes</span>
          <span className="font-sans text-xs text-ink type-muted">
            The draft you are working on.
          </span>
        </button>
        {versions === null && !failed ? (
          <div className="flex flex-col gap-2 p-1" role="status" aria-label="Loading versions">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : versions === null ? (
          <Alert variant="danger" className="flex-wrap items-center">
            <span className="min-w-0 grow">The versions could not be loaded.</span>
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </Alert>
        ) : versions.length === 0 ? (
          <Text muted size="sm" className="px-2 py-2">
            {NO_VERSIONS}
          </Text>
        ) : (
          <ul className="flex flex-col gap-1" aria-label="Versions">
            {versions.map((summary) => (
              <li key={summary.version}>
                <button
                  type="button"
                  onClick={() => void preview(summary)}
                  disabled={opening !== null}
                  aria-current={summary.version === previewing ? 'true' : undefined}
                  data-testid="version-row"
                  className={cn(ROW, summary.version === previewing ? 'bg-primary' : '')}
                >
                  <span className="flex w-full flex-wrap items-center gap-2">
                    <span className="type-ui text-sm">{versionTitle(summary.version)}</span>
                    {summary.active ? <Badge variant="success">Active</Badge> : null}
                    {opening === summary.version ? (
                      <span className="ml-auto font-sans text-xs type-muted">Opening...</span>
                    ) : null}
                  </span>
                  <span className="font-sans text-xs text-ink type-muted">
                    {versionByline(summary)}
                  </span>
                  {summary.note ? (
                    <span className="font-sans text-sm text-ink break-words">{summary.note}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export interface VersionPreviewActionsProps {
  automationId: string;
  version: VersionDetail;
  /** Saves pending edits first; resolves with the saved draft revision. */
  flush: () => Promise<number>;
  /** Restore As Draft worked: the page swaps in the new draft and ends the preview. */
  onRestored: (automation: AutomationDetail) => void;
  onClose: () => void;
}

/** Over the previewed canvas: which version this is, and what to do with it. */
export function VersionPreviewActions({
  automationId,
  version,
  flush,
  onRestored,
  onClose,
}: VersionPreviewActionsProps) {
  const [busy, setBusy] = useState(false);

  async function restore() {
    setBusy(true);
    let revision: number;
    try {
      revision = await flush();
    } catch (cause) {
      toast({ title: saveFirstFailure(cause), variant: 'danger' });
      setBusy(false);
      return;
    }
    try {
      const automation = await restoreVersion(automationId, version.version, revision);
      toast({ title: restoredToast(version.version) });
      onRestored(automation);
    } catch (cause) {
      toast({ title: restoreFailure(cause), variant: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="absolute top-3 left-3 z-10" role="status" data-testid="version-preview-chip">
        <Badge variant="outline" className="h-9 gap-2 bg-secondary px-3 shadow-brutalSm">
          {versionTitle(version.version)}
          {version.active ? ', Active' : ', Read Only'}
        </Badge>
      </div>
      <div className="absolute top-3 right-3 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" disabled={busy} data-testid="version-actions">
              {busy ? 'Restoring...' : 'Actions'}
              <MotionIcon icon={ChevronDownIcon} className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void restore()}>Restore As Draft</DropdownMenuItem>
            <DropdownMenuItem onSelect={onClose}>Back To Current Changes</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
