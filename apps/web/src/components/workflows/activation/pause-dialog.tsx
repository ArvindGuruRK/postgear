'use client';

/**
 * The pause confirm (Module 09, blueprint 8): turning a workflow off stops
 * new runs at once, while runs in progress finish. A Schedule adds that the
 * runs it misses while paused are not caught up later, because pausing
 * deletes its schedule.
 */
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  toast,
} from '@postgear/ui';
import { useState } from 'react';
import { pauseWorkflow } from '@/lib/workflows-api';
import type { AutomationDetail } from '@/types/workflows';
import { PAUSED, pauseFailure, pauseLines } from './activation-model';

export interface PauseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  automationId: string;
  /** The workflow's trigger type: a Schedule adds the no catch-up sentence. */
  triggerType: string | null;
  onPaused: (automation: AutomationDetail) => void;
}

export function PauseDialog({
  open,
  onOpenChange,
  automationId,
  triggerType,
  onPaused,
}: PauseDialogProps) {
  const [busy, setBusy] = useState(false);
  const lines = pauseLines(triggerType);

  async function pause() {
    setBusy(true);
    try {
      const automation = await pauseWorkflow(automationId);
      toast({ title: PAUSED });
      onPaused(automation);
      onOpenChange(false);
    } catch (cause) {
      toast({ title: pauseFailure(cause), variant: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <AlertDialogContent data-testid="pause-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Pause Workflow</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              {lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep It On</AlertDialogCancel>
          <Button onClick={() => void pause()} disabled={busy} data-testid="pause-confirm">
            {busy ? 'Pausing...' : 'Pause'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
