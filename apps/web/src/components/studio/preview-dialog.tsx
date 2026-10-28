'use client';

/**
 * Preview (Sprint 9: Screen 5, DS-7.1 and DS-7.2), opened by the editor's
 * eye button: the design in an Instagram, Facebook, LinkedIn or X frame (the
 * ones the API says take its format), with the caption written right there.
 *
 * - The frame is the share page's own (`PlatformPreview`), with the
 *   workspace's name and initials as the account and a Preview badge on it.
 * - It opens on the slide the canvas shows, and focus starts on the
 *   carousel's arrow, so the arrow keys turn slides straight away. Escape
 *   closes it.
 * - The caption goes back through `onCaptionChange` on every keystroke; the
 *   editor makes it one undo step and saves it with the design.
 * - Keys pressed in here stay in here: the editor's own shortcuts (arrows
 *   nudge, Delete hides) must not act on a slide nobody can see.
 */
import type { DesignDocument } from '@postgear/design-engine';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@postgear/ui';
import { useMemo, useRef } from 'react';
import { useWorkspace } from '@/components/navigation/workspace-provider';
import type { PreviewPlatform, StudioMediaRef } from '@/types/studio';
import { PlatformPreview, type PreviewAccount } from './platform-frame';

export interface PreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: DesignDocument;
  /** The frames to offer, as the design's detail lists them. */
  platforms: PreviewPlatform[];
  media: Readonly<Record<string, StudioMediaRef>>;
  /** The slide on the canvas: the carousel opens on it. */
  startIndex: number;
  /** Every change to the caption; the editor applies it as one undo step. */
  onCaptionChange: (caption: string) => void;
}

export function PreviewDialog({
  open,
  onOpenChange,
  document,
  platforms,
  media,
  startIndex,
  onCaptionChange,
}: PreviewDialogProps) {
  const { organizations, activeOrgId } = useWorkspace();
  const content = useRef<HTMLDivElement>(null);
  const name =
    organizations.find((organization) => organization.id === activeOrgId)?.name ?? 'Your Workspace';
  const account = useMemo<PreviewAccount>(() => ({ name }), [name]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={content}
        data-testid="studio-preview"
        className="flex max-h-[90dvh] max-w-2xl flex-col gap-0 p-0"
        onOpenAutoFocus={(event) => {
          const step = firstStep(content.current);
          if (!step) return;
          event.preventDefault();
          step.focus();
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <DialogHeader className="px-6 pt-6 pb-4 pe-14">
          <DialogTitle>Preview</DialogTitle>
          <DialogDescription>
            Check your slides in each feed and write the caption. Nothing is posted from here.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-6 sm:px-6 pg-scrollbar pg-scrollbar-secondary">
          <PlatformPreview
            design={document}
            caption={document.caption}
            onCaptionChange={onCaptionChange}
            media={media}
            platforms={platforms}
            account={account}
            startIndex={startIndex}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The carousel's arrow to start on: Next, or Previous when the design opens
 * on its last slide. Null for a single slide, which leaves focus where the
 * dialog puts it.
 */
function firstStep(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  return (
    root.querySelector<HTMLElement>('[data-slide-step="next"]:not([aria-disabled="true"])') ??
    root.querySelector<HTMLElement>('[data-slide-step="previous"]:not([aria-disabled="true"])')
  );
}
