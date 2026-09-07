'use client';

import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
  Stack,
  Text,
} from '@postgear/ui';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Channel, ProviderEntity } from '@/types/channel';

interface FinishSetupDialogProps {
  channel: Channel | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

/**
 * Picks the page, account, channel or board a connection will publish to.
 *
 * ## One surface, two entry points
 *
 * This runs both immediately after OAuth (the callback redirects with
 * `?setup=<id>`) and later from the channel list, for anyone who closed the tab
 * mid-setup. The reference implementation has two separate components for these
 * — one inline on the return page, one modal on the calendar — with different
 * titles, different endpoints, and two copies of the same mock object. Building
 * it once means the resume path cannot drift from the fresh one.
 *
 * ## Why the metadata line matters
 *
 * Each option shows a disambiguating detail — follower count, board size, the
 * Page an Instagram account sits behind. With five similarly-named Facebook
 * pages, the name alone makes the choice impossible.
 */
export function FinishSetupDialog({ channel, onOpenChange, onDone }: FinishSetupDialogProps) {
  const [entities, setEntities] = useState<ProviderEntity[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const channelId = channel?.id ?? null;

  useEffect(() => {
    if (!channelId) {
      setEntities(null);
      setSelected(null);
      setError(null);
      return;
    }

    // Guards against a slow response landing after the dialog moved to another
    // channel, which would show one account's pages under another's name.
    let cancelled = false;

    setEntities(null);
    setError(null);

    api<{ entities: ProviderEntity[] }>(`/channels/${channelId}/entities`)
      .then((response) => {
        if (!cancelled) {
          setEntities(response.entities);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof ApiError ? cause.message : 'We could not load your accounts.');
          setEntities([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const save = useCallback(async () => {
    if (!channelId || !selected) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await api(`/channels/${channelId}/entities`, {
        method: 'POST',
        body: { entityId: selected },
      });
      onDone();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'We could not save that choice.');
    } finally {
      setSaving(false);
    }
  }, [channelId, selected, onDone]);

  return (
    <Dialog open={channel !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Finish setting up {channel?.providerName}</DialogTitle>
          <DialogDescription>
            Choose which account this channel should publish to.
          </DialogDescription>
        </DialogHeader>

        {entities === null ? (
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        ) : entities.length === 0 ? (
          /* The empty state names the cause, the fix, and the way out — a bare
             "nothing found" leaves the user with no next move, and this is the
             single most common place a Meta connection stalls. */
          <Stack gap="sm">
            <Text weight="bold">We could not find anything to connect.</Text>
            <Text size="sm" muted>
              This usually means the account you approved does not manage any pages, or that a page
              was not selected on the platform&apos;s permission screen.
            </Text>
            <Text size="sm" muted>
              Disconnect this channel, then connect again and approve every page you want PostGear
              to post to.
            </Text>
          </Stack>
        ) : (
          <Stack gap="sm" className="max-h-[50vh] overflow-y-auto">
            {entities.map((entity) => {
              const isSelected = selected === entity.id;

              return (
                <Card
                  key={entity.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  onClick={() => setSelected(entity.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelected(entity.id);
                    }
                  }}
                  className={isSelected ? 'cursor-pointer border-actionPrimary' : 'cursor-pointer'}
                >
                  <CardContent className="flex items-center gap-3 p-4">
                    <Stack gap="none" className="min-w-0 flex-1">
                      <Text weight="bold" className="truncate">
                        {entity.name}
                      </Text>
                      {entity.username ? (
                        <Text size="sm" muted className="truncate">
                          @{entity.username}
                        </Text>
                      ) : null}
                      {entity.detail ? (
                        <Text size="sm" muted className="truncate">
                          {entity.detail}
                        </Text>
                      ) : null}
                    </Stack>
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
        )}

        {error ? (
          <Text size="sm" className="text-actionDanger">
            {error}
          </Text>
        ) : null}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!selected || saving}>
            {saving ? 'Saving…' : 'Use this account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
