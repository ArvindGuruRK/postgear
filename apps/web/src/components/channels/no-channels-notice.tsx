'use client';

/**
 * The composer's answer to "no channel is connected yet" (2026-10-21).
 *
 * The composer stays fully usable for writing and previewing; only saving and
 * scheduling wait for a channel. This box stands in the channel row and says
 * so. It is a button: pressing it opens the same Add Channel dialog the
 * calendar's channel card opens, so there is one place where a platform is
 * picked and one connect flow behind it.
 *
 * The look is the dashed, line-bordered box the row had before (the owner
 * liked it), now holding one message instead of a list of platforms.
 *
 * Only an admin can connect (the API refuses anyone else), so a member sees
 * the same box as plain text, saying who to ask, rather than a button that
 * would end in a 403.
 */
import { cn } from '@postgear/ui';
import { Radio } from 'lucide-react';
import { useState } from 'react';
import { useWorkspace } from '@/components/navigation/workspace-provider';
import type { ProviderSummary } from '@/types/channel';
import { ConnectChannelDialog } from './connect-channel-dialog';

const BOX = 'flex w-full items-start gap-3 rounded-lg border-2 border-dashed border-ink/30 p-4';

const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

function Message({ children }: { children: string }) {
  return (
    <>
      <Radio className="mt-0.5 h-5 w-5 shrink-0 text-ink" strokeWidth={2.25} aria-hidden />
      <span className="flex flex-col gap-1">
        <span className="type-ui text-sm text-ink">Nothing has been connected yet</span>
        <span className="font-sans text-sm text-ink type-muted">{children}</span>
      </span>
    </>
  );
}

export function NoChannelsNotice({ providers }: { providers: ProviderSummary[] }) {
  const { role } = useWorkspace();
  const [open, setOpen] = useState(false);
  const canConnect = role === 'ADMIN' || role === 'SUPERADMIN';

  if (!canConnect) {
    return (
      <div className={BOX}>
        <Message>Ask a workspace admin to connect a channel first.</Message>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          BOX,
          'cursor-pointer text-start transition-colors hover:border-actionPrimary hover:bg-actionPrimary/5',
          FOCUS,
        )}
      >
        <Message>You need to connect a channel first. Please press here to add one.</Message>
      </button>

      <ConnectChannelDialog open={open} onOpenChange={setOpen} providers={providers} />
    </>
  );
}
