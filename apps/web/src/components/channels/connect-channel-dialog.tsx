'use client';

import {
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@postgear/ui';
import { Info } from 'lucide-react';
import { PlatformIcon } from '@/components/platforms/platform-icon';
import { channelConnectUrl } from '@/lib/api';
import type { ProviderSummary } from '@/types/channel';

interface ConnectChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: ProviderSummary[];
}

/**
 * What kind of account each platform connects, shown under its name so the
 * person knows before they leave for the consent screen (a Facebook Page, not
 * a personal profile; an Instagram business or creator account).
 */
const ACCOUNT_KIND: Record<string, string> = {
  x: 'Profile',
  linkedin: 'Profile',
  'linkedin-page': 'Company Page',
  facebook: 'Page',
  instagram: 'Business or Creator',
  youtube: 'Channel',
  tiktok: 'Business or Personal',
  pinterest: 'Profile',
};

/**
 * Most used first (2026-10-18), so the platforms people reach for most are
 * at the top. A provider not listed here goes after these, in API order.
 */
const POPULARITY = [
  'instagram',
  'facebook',
  'x',
  'linkedin',
  'linkedin-page',
  'youtube',
  'tiktok',
  'pinterest',
];

function popularity(provider: ProviderSummary): number {
  const index = POPULARITY.indexOf(provider.identifier);
  return index === -1 ? POPULARITY.length : index;
}

/** Most used first; shared with the channel card's quick-connect icons. */
export function byPopularity(providers: ProviderSummary[]): ProviderSummary[] {
  return [...providers].sort((a, b) => popularity(a) - popularity(b));
}

function accountKind(provider: ProviderSummary): string {
  return (
    ACCOUNT_KIND[provider.identifier] ?? (provider.requiresEntitySelection ? 'Page' : 'Profile')
  );
}

/** The tile shell both states share: a large centred logo, the name, the account kind. */
const TILE = cn(
  'relative flex h-full min-h-[10.5rem] w-full flex-col items-center justify-center gap-3',
  'rounded-lg border-2 border-outline bg-secondary p-5 text-center text-ink',
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
);

/** Pressable: the tile is a button, so it takes the diagonal brutal shadow (§6). */
const AVAILABLE = cn(
  'shadow-brutalSm transition-[transform,box-shadow] duration-100',
  'hover:-translate-x-px hover:-translate-y-px hover:shadow-brutalMd',
  'active:translate-x-[1px] active:translate-y-[1px] active:shadow-brutalPressed',
);

function TileBody({ provider }: { provider: ProviderSummary }) {
  return (
    <>
      <PlatformIcon platform={provider.identifier} className="h-10 w-10" />
      <span className="flex flex-col gap-1">
        <span className="type-ui text-base">{provider.name}</span>
        <span className="font-sans text-sm text-ink opacity-70">{accountKind(provider)}</span>
      </span>
    </>
  );
}

/**
 * The provider picker (layout revamped 2026-10-18, after a reference the owner
 * supplied: a centred title over one scrolling grid of large logo tiles).
 *
 * A plain grid rather than a searchable, categorised list: with eight platforms
 * a search box is chrome that costs a keystroke and saves none.
 *
 * **Unconfigured providers are listed, dimmed, after the available ones**,
 * with an info mark in the corner whose tooltip gives the reason. Hiding them
 * would be tidier and worse: a self-hoster who has not set
 * `TIKTOK_CLIENT_KEY` would conclude PostGear does not support TikTok, rather
 * than that their deployment is missing a key. The tile is `aria-disabled`
 * rather than `disabled` so it stays focusable and hoverable: a disabled
 * button fires no pointer or focus events, so its tooltip could never open,
 * and keyboard users would never reach the reason.
 */
export function ConnectChannelDialog({ open, onOpenChange, providers }: ConnectChannelDialogProps) {
  const sorted = byPopularity(providers);
  const ordered = [
    ...sorted.filter((provider) => provider.configured),
    ...sorted.filter((provider) => !provider.configured),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader className="items-center px-8 text-center">
          <DialogTitle>Connect a channel</DialogTitle>
          <DialogDescription className="sr-only">
            Pick a platform. You approve access on the platform, then come back here.
          </DialogDescription>
        </DialogHeader>

        {/* Scrolls inside the dialog once the grid outgrows the screen. The
            padding keeps the tiles' shadows and focus rings from being
            clipped by the scroll container. */}
        <TooltipProvider delayDuration={150}>
          <ul className="pg-scrollbar pg-scrollbar-secondary -mx-2 mt-4 grid max-h-[min(70vh,40rem)] grid-cols-2 gap-4 overflow-y-auto px-2 pt-1 pb-2 sm:grid-cols-3">
            {ordered.map((provider) => (
              <li key={provider.identifier}>
                {provider.configured ? (
                  <button
                    type="button"
                    className={cn(TILE, AVAILABLE)}
                    onClick={() => {
                      // A full navigation, not a fetch: the consent screen is a
                      // page the user has to see and interact with.
                      window.location.href = channelConnectUrl(provider.identifier);
                    }}
                  >
                    <TileBody provider={provider} />
                  </button>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-disabled="true"
                        data-unconfigured="true"
                        className={cn(TILE, 'cursor-not-allowed opacity-60')}
                        onClick={(event) => event.preventDefault()}
                      >
                        <Info
                          className="absolute top-3 left-3 h-4 w-4"
                          strokeWidth={2.5}
                          aria-hidden="true"
                        />
                        <TileBody provider={provider} />
                        <span className="sr-only">, not set up on this deployment</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Not set up on this deployment yet: it needs API keys for {provider.name}.
                    </TooltipContent>
                  </Tooltip>
                )}
              </li>
            ))}
          </ul>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}
