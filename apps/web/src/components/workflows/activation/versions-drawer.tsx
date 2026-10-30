'use client';

/**
 * The Versions drawer (Module 09, blueprint 8): every activated version
 * with its number, author, time, note and the Active marker. Choosing one
 * loads its graph and previews it read-only on the builder's canvas; the
 * drawer closes so the canvas shows. The banner over the preview offers
 * Restore As Draft (Zapier's rollback) and Close. A version itself is never
 * edited.
 */
import { RotateCcwIcon } from '@animateicons/react/lucide/rotate-ccw-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
import {
  Alert,
  Badge,
  Button,
  cn,
  MotionIcon,
  pressSm,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Text,
  toast,
} from '@postgear/ui';
import { Eye } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { getVersion, listVersions, restoreVersion } from '@/lib/workflows-api';
import type { AutomationDetail, VersionDetail, VersionSummary } from '@/types/workflows';
import {
  NO_VERSIONS,
  previewBannerText,
  restoredToast,
  restoreFailure,
  saveFirstFailure,
  versionByline,
  versionTitle,
} from './activation-model';

export interface VersionsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  automationId: string;
  /** The version previewed now, if any. */
  previewing: number | null;
  /** Preview one on the canvas; null ends the preview. */
  onPreview: (version: VersionDetail | null) => void;
}

export function VersionsDrawer({
  open,
  onOpenChange,
  automationId,
  previewing,
  onPreview,
}: VersionsDrawerProps) {
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
    if (open) void load();
  }, [open, load]);

  async function preview(summary: VersionSummary) {
    if (summary.version === previewing) {
      onOpenChange(false);
      return;
    }
    setOpening(summary.version);
    try {
      const detail = await getVersion(automationId, summary.version);
      onPreview(detail);
      onOpenChange(false);
    } catch {
      toast({ title: 'That version could not be opened. Try again.', variant: 'danger' });
    } finally {
      setOpening(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col" data-testid="versions-drawer">
        <SheetHeader>
          <SheetTitle>Versions</SheetTitle>
          <SheetDescription>
            Each time the workflow was turned on. Open one to see it on the canvas.
          </SheetDescription>
        </SheetHeader>
        <div className="-mx-6 flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-2">
          {versions === null && !failed ? (
            <div className="flex flex-col gap-3" role="status" aria-label="Loading versions">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : versions === null ? (
            <Alert variant="danger" className="flex-wrap items-center">
              <span className="min-w-0 grow">The versions could not be loaded.</span>
              <Button variant="secondary" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </Alert>
          ) : versions.length === 0 ? (
            <Text muted>{NO_VERSIONS}</Text>
          ) : (
            <ul className="flex flex-col gap-3" aria-label="Versions">
              {versions.map((summary) => (
                <li key={summary.version}>
                  <VersionRow
                    summary={summary}
                    previewing={summary.version === previewing}
                    busy={opening === summary.version}
                    disabled={opening !== null}
                    onOpen={() => void preview(summary)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function VersionRow({
  summary,
  previewing,
  busy,
  disabled,
  onOpen,
}: {
  summary: VersionSummary;
  previewing: boolean;
  busy: boolean;
  disabled: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      aria-current={previewing ? 'true' : undefined}
      data-testid="version-row"
      className={cn(
        'flex w-full flex-col items-start gap-1 rounded-md border-2 border-outline bg-secondary p-3 text-left text-ink outline-none',
        'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
        'disabled:opacity-50',
        pressSm,
      )}
    >
      <span className="flex w-full flex-wrap items-center gap-2">
        <span className="type-ui text-sm">{versionTitle(summary.version)}</span>
        {summary.active ? <Badge variant="success">Active</Badge> : null}
        {previewing ? (
          <span className="ml-auto flex items-center gap-1 font-sans text-xs font-bold">
            <Eye aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={3} />
            Previewing
          </span>
        ) : busy ? (
          <span className="ml-auto font-sans text-xs type-muted">Opening...</span>
        ) : null}
      </span>
      <span className="font-sans text-xs text-ink type-muted">{versionByline(summary)}</span>
      {summary.note ? (
        <span className="font-sans text-sm text-ink break-words">{summary.note}</span>
      ) : null}
    </button>
  );
}

export interface VersionPreviewBannerProps {
  automationId: string;
  version: VersionDetail;
  /** Saves pending edits first; resolves with the saved draft revision. */
  flush: () => Promise<number>;
  /** Restore As Draft worked: the page swaps in the new draft and ends the preview. */
  onRestored: (automation: AutomationDetail) => void;
  onClose: () => void;
}

/** "Viewing version 2. Restore As Draft or Close." over the previewed canvas. */
export function VersionPreviewBanner({
  automationId,
  version,
  flush,
  onRestored,
  onClose,
}: VersionPreviewBannerProps) {
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
    <Alert
      variant="info"
      role="status"
      className="flex-wrap items-center"
      data-testid="version-preview-banner"
    >
      <span className="min-w-0 grow font-bold">
        {previewBannerText(version.version)}
        {version.active ? ' It is the live version.' : ''}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => void restore()} disabled={busy}>
          <MotionIcon icon={RotateCcwIcon} className="h-4 w-4" />
          {busy ? 'Restoring...' : 'Restore As Draft'}
        </Button>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
          <MotionIcon icon={XIcon} className="h-4 w-4" />
          Close
        </Button>
      </div>
    </Alert>
  );
}
