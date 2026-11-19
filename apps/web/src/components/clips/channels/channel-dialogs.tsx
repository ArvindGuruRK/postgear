'use client';

/**
 * The two dialogs around My Channels (Module 06, section 6):
 *
 * - `BrowseChannelsDialog`: Browse Channels on the link box. The same
 *   `ChannelBrowser` as the Streams tab, with platform tabs; a row's Import
 *   closes it and the link card carries on in the link box.
 * - `LinkCardDialog`: Import on the Streams tab. The very `LinkCard` of the
 *   link box, with focus on the rights tick, so a channel row never offers a
 *   way around the tick or any refusal.
 */
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@postgear/ui';
import type { ClipPlatformId } from '@postgear/video-engine';
import type { ClipImportOutcome, ClipProbe, DownloadStarted } from '@/types/clips';
import { LinkCard } from '../home/link-card';
import { ChannelBrowser } from './channel-browser';
import { ONLY_PUBLIC_LINE } from './channels-model';
import type { ChannelsState } from './use-channels';

export function BrowseChannelsDialog({
  open,
  onOpenChange,
  orgId,
  platforms,
  disabled,
  channelsState,
  onProbed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  platforms: readonly ClipPlatformId[];
  disabled: boolean;
  channelsState: ChannelsState;
  onProbed: (url: string, probe: ClipProbe) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(860px,calc(100vh-4rem))] max-w-4xl flex-col gap-5 overflow-hidden">
        <DialogHeader>
          <DialogTitle>Browse Channels</DialogTitle>
          <DialogDescription>{ONLY_PUBLIC_LINE}</DialogDescription>
        </DialogHeader>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
          {open ? (
            <ChannelBrowser
              orgId={orgId}
              platforms={platforms}
              disabled={disabled}
              platformTabs
              channelsState={channelsState}
              onProbed={(url, probe) => {
                onOpenChange(false);
                onProbed(url, probe);
              }}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LinkCardDialog({
  shown,
  onClose,
  orgId,
  disabled,
  onImported,
  onDownloaded,
}: {
  /** The probe to show; null closes the dialog. */
  shown: { url: string; probe: ClipProbe } | null;
  onClose: () => void;
  orgId: string;
  disabled: boolean;
  onImported: (outcome: ClipImportOutcome) => void;
  /** Module 18: a download was asked for; the dialog closes first. */
  onDownloaded?: (outcome: DownloadStarted) => void;
}) {
  return (
    <Dialog open={shown !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Video</DialogTitle>
          <DialogDescription className="sr-only">
            Check the video, confirm your rights and import it.
          </DialogDescription>
        </DialogHeader>
        {shown ? (
          <LinkCard
            key={shown.probe.link.canonicalUrl}
            probe={shown.probe}
            orgId={orgId}
            disabled={disabled}
            autoFocusRights
            onImported={(outcome) => {
              onClose();
              onImported(outcome);
            }}
            onDownloaded={
              onDownloaded
                ? (outcome) => {
                    onClose();
                    onDownloaded(outcome);
                  }
                : undefined
            }
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
