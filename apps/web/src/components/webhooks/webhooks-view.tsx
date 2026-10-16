'use client';

/**
 * Outbound webhooks (Sprint 8, PRD 5.10): the list, and every action on it.
 *
 * The list is a restrained `Table` (§15): a name, where it goes, what it
 * listens for, the last delivery's outcome, and a kebab of actions. The
 * chrome around it — the header, the empty state, the dialogs — carries the
 * treatment. Secrets appear in exactly two places, the create dialog and
 * the rotate result, and nowhere else.
 */
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  PageHeader,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  toast,
} from '@postgear/ui';
import { History, MoreHorizontal, Plus, Webhook as WebhookIcon } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Channel } from '@/types/channel';
import type { WebhookCreated, WebhookView } from '@/types/webhooks';
import { ConfirmWebhookDialog, type WebhookConfirmKind } from './confirm-webhook-dialog';
import { DeliveriesSheet } from './deliveries-sheet';
import { SecretPanel } from './secret-panel';
import { WebhookDialog } from './webhook-dialog';
import { EVENT_LABELS, describeLastDelivery, deliveryTone, shortUrl } from './webhooks-view-model';

export interface WebhooksViewProps {
  initialWebhooks: WebhookView[] | null;
  channels: Channel[];
  canManage: boolean;
  /** `WEBHOOK_ALLOW_PRIVATE_URLS` on the API, read from its list response. */
  allowHttp: boolean;
  retryPolicy: { maximumAttempts: number } | null;
}

export function WebhooksView({ initialWebhooks, channels, canManage, allowHttp, retryPolicy }: WebhooksViewProps) {
  const [webhooks, setWebhooks] = useState<WebhookView[] | null>(initialWebhooks);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WebhookView | null>(null);
  const [confirm, setConfirm] = useState<{ webhook: WebhookView; kind: WebhookConfirmKind } | null>(null);
  const [history, setHistory] = useState<WebhookView | null>(null);
  const [rotated, setRotated] = useState<WebhookCreated | null>(null);
  const [busy, setBusy] = useState(false);

  const channelName = (id: string) => channels.find((channel) => channel.id === id)?.name ?? 'a removed channel';

  async function reload() {
    try {
      const result = await api<{ webhooks: WebhookView[] }>('/webhooks');
      setWebhooks(result.webhooks);
    } catch {
      // The list on screen stays; the next action refreshes it.
    }
  }

  function upsert(webhook: WebhookView) {
    setWebhooks((current) => {
      const list = current ?? [];
      return list.some((entry) => entry.id === webhook.id)
        ? list.map((entry) => (entry.id === webhook.id ? webhook : entry))
        : [...list, webhook];
    });
  }

  async function runConfirm() {
    if (!confirm) {
      return;
    }
    setBusy(true);
    try {
      if (confirm.kind === 'delete') {
        await api(`/webhooks/${confirm.webhook.id}`, { method: 'DELETE' });
        setWebhooks((current) => (current ?? []).filter((entry) => entry.id !== confirm.webhook.id));
        toast({ title: 'Webhook deleted' });
      } else {
        const result = await api<WebhookCreated>(`/webhooks/${confirm.webhook.id}/rotate-secret`, {
          method: 'POST',
        });
        upsert(result.webhook);
        setRotated(result);
      }
      setConfirm(null);
    } catch (cause) {
      toast({
        title: cause instanceof ApiError ? cause.message : 'That did not work. Please try again.',
        variant: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }

  async function sendTest(webhook: WebhookView) {
    try {
      const result = await api<{ scheduled: boolean; message: string }>(`/webhooks/${webhook.id}/test`, {
        method: 'POST',
      });
      toast({ title: result.message, variant: result.scheduled ? 'default' : 'danger' });
      setHistory(webhook);
    } catch (cause) {
      toast({
        title: cause instanceof ApiError ? cause.message : 'The test could not be queued.',
        variant: 'danger',
      });
    }
  }

  async function toggleDisabled(webhook: WebhookView) {
    try {
      const result = await api<{ webhook: WebhookView }>(`/webhooks/${webhook.id}`, {
        method: 'PATCH',
        body: { disabled: !webhook.disabled },
      });
      upsert(result.webhook);
      toast({ title: result.webhook.disabled ? 'Webhook paused' : 'Webhook resumed' });
    } catch (cause) {
      toast({
        title: cause instanceof ApiError ? cause.message : 'That did not work. Please try again.',
        variant: 'danger',
      });
    }
  }

  return (
    <Stack gap="lg">
      <PageHeader
        title="Webhooks"
        description="Send a signed POST to your own systems when a post is published or fails."
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
              data-testid="webhook-add"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              Add webhook
            </Button>
          ) : undefined
        }
      />

      {rotated ? (
        <Stack gap="sm">
          <SecretPanel
            secret={rotated.secret}
            title={`New signing secret for ${rotated.webhook.name}`}
            description="The old secret has stopped verifying. Copy this one now; it will not be shown again."
            testId="webhook-rotated-secret"
          />
          <div>
            <Button variant="secondary" size="sm" onClick={() => setRotated(null)}>
              I have copied it
            </Button>
          </div>
        </Stack>
      ) : null}

      {webhooks === null ? (
        <Alert variant="danger">
          The webhooks couldn't be loaded.{' '}
          <Button variant="secondary" size="sm" onClick={reload}>
            Retry
          </Button>
        </Alert>
      ) : webhooks.length === 0 ? (
        <EmptyState
          icon={WebhookIcon}
          title="No webhooks yet"
          description="Add one to be told, in your own systems, the moment a post goes out or fails. Every delivery is signed with a secret only you and PostGear know."
          {...(canManage
            ? {
                action: {
                  label: 'Add webhook',
                  onClick: () => {
                    setEditing(null);
                    setDialogOpen(true);
                  },
                },
              }
            : {})}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Last delivery</TableHead>
                  {/* `relative`: the sr-only label is absolutely positioned and must stay inside the cell. */}
                  <TableHead className="relative w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooks.map((webhook) => (
                  <TableRow
                    key={webhook.id}
                    data-testid="webhook-row"
                    data-webhook-id={webhook.id}
                    data-disabled={webhook.disabled}
                  >
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="font-semibold">{webhook.name}</span>
                        <span className="flex flex-wrap gap-1">
                          {webhook.disabled ? <Badge variant="outline">Paused</Badge> : null}
                          {webhook.channelIds.length > 0 ? (
                            <Text size="xs" muted as="span">
                              {webhook.channelIds.map(channelName).join(', ')}
                            </Text>
                          ) : (
                            <Text size="xs" muted as="span">
                              Every channel
                            </Text>
                          )}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs" title={webhook.url}>
                        {shortUrl(webhook.url)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        {webhook.events.map((event) => (
                          <Badge key={event} variant="outline">
                            {EVENT_LABELS[event].label}
                          </Badge>
                        ))}
                      </span>
                    </TableCell>
                    <TableCell>
                      {webhook.lastDelivery ? (
                        <Badge variant={deliveryTone(webhook.lastDelivery.status)}>
                          {describeLastDelivery(webhook)}
                        </Badge>
                      ) : (
                        <Text size="xs" muted as="span">
                          {describeLastDelivery(webhook)}
                        </Text>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="secondary" size="sm" aria-label={`Actions for ${webhook.name}`}>
                            <MoreHorizontal className="h-4 w-4" strokeWidth={2.5} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setHistory(webhook)}>
                            <History className="h-4 w-4" strokeWidth={2.5} />
                            Deliveries
                          </DropdownMenuItem>
                          {canManage ? (
                            <>
                              <DropdownMenuItem onSelect={() => void sendTest(webhook)}>Send test</DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  setEditing(webhook);
                                  setDialogOpen(true);
                                }}
                              >
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => void toggleDisabled(webhook)}>
                                {webhook.disabled ? 'Resume' : 'Pause'}
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setConfirm({ webhook, kind: 'rotate' })}>
                                Rotate secret
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-actionDanger"
                                onSelect={() => setConfirm({ webhook, kind: 'delete' })}
                              >
                                Delete
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Text size="sm" muted>
        Deliveries carry <code className="font-mono text-xs">X-PostGear-Signature</code> (HMAC-SHA256 of
        the timestamp and body with your secret)
        {retryPolicy
          ? `, and a failed delivery is retried up to ${retryPolicy.maximumAttempts} times with growing delays.`
          : '.'}
        {!canManage ? ' Only workspace admins can add or change webhooks.' : ''}
      </Text>

      <WebhookDialog
        open={dialogOpen}
        webhook={editing}
        channels={channels}
        allowHttp={allowHttp}
        onOpenChange={setDialogOpen}
        onSaved={upsert}
      />
      <ConfirmWebhookDialog
        webhook={confirm?.webhook ?? null}
        kind={confirm?.kind ?? 'delete'}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        onConfirm={() => void runConfirm()}
      />
      <DeliveriesSheet
        webhook={history}
        onOpenChange={(open) => {
          if (!open) setHistory(null);
        }}
      />
    </Stack>
  );
}
