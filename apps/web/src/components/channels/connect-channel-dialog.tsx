'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Stack,
  Text,
} from '@postgear/ui';
import { channelConnectUrl } from '@/lib/api';
import type { ProviderSummary } from '@/types/channel';

interface ConnectChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: ProviderSummary[];
}

/**
 * The provider picker.
 *
 * A plain grid rather than a searchable, categorised list: with eight platforms
 * a search box is chrome that costs a keystroke and saves none. That calculus
 * changes past a couple of dozen, which is where the reference implementation
 * sits — and it still has no search, which is its problem, not a precedent.
 *
 * **Unconfigured providers are shown disabled, with the reason.** Hiding them
 * would be tidier and worse: a self-hoster who has not set `TIKTOK_CLIENT_KEY`
 * would conclude PostGear does not support TikTok, rather than that their
 * deployment is missing a key.
 */
export function ConnectChannelDialog({ open, onOpenChange, providers }: ConnectChannelDialogProps) {
  const configured = providers.filter((provider) => provider.configured);
  const unconfigured = providers.filter((provider) => !provider.configured);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Connect a channel</DialogTitle>
          <DialogDescription>
            You will be sent to the platform to approve access, then brought back here.
          </DialogDescription>
        </DialogHeader>

        <Stack gap="lg">
          {configured.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {configured.map((provider) => (
                <Button
                  key={provider.identifier}
                  variant="secondary"
                  className="h-auto flex-col items-start gap-1 py-4 text-start"
                  onClick={() => {
                    // A full navigation, not a fetch: the consent screen is a
                    // page the user has to see and interact with.
                    window.location.href = channelConnectUrl(provider.identifier);
                  }}
                >
                  <span>{provider.name}</span>
                  {provider.requiresEntitySelection ? (
                    <span className="font-sans text-xs font-medium normal-case opacity-70">
                      Pick an account after
                    </span>
                  ) : null}
                </Button>
              ))}
            </div>
          ) : (
            <Text muted>
              No platforms are configured on this PostGear instance yet. Add the client id and
              secret for a platform to your environment, then restart the API.
            </Text>
          )}

          {unconfigured.length > 0 ? (
            <Stack gap="sm">
              <Text size="sm" weight="bold">
                Not set up on this instance
              </Text>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {unconfigured.map((provider) => (
                  <Button
                    key={provider.identifier}
                    variant="secondary"
                    disabled
                    className="h-auto flex-col items-start gap-1 py-4 text-start"
                    // Says which specific thing is missing, so the fix is
                    // obvious to whoever runs the deployment.
                    title={`Missing API credentials for ${provider.name}`}
                  >
                    <span>{provider.name}</span>
                    <span className="font-sans text-xs font-medium normal-case opacity-70">
                      Needs API keys
                    </span>
                  </Button>
                ))}
              </div>
              <Text size="sm" muted>
                These platforms are supported, but this deployment has no API credentials for them
                yet.
              </Text>
            </Stack>
          ) : null}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
