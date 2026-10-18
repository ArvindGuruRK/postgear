'use client';

/**
 * The delivery history of one hook, in a side sheet (Sprint 8).
 *
 * Refetched every 3 s while open, because the thing a person opens it for 
 * ("did my test arrive?") is being decided by the worker as they watch. A
 * `Timeline`-style list would over-dress twenty rows of status; it is a
 * restrained list with a badge per row (design-system-rules §15).
 */
import {
  Badge,
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Stack,
  Text,
} from '@postgear/ui';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { DeliveryView, WebhookView } from '@/types/webhooks';
import { useMounted } from '../posts/use-mounted';
import { deliveryLabel, deliveryTone, describeDeliveryAttempt, formatRelative } from './webhooks-view-model';

const REFRESH_MS = 3_000;

export function DeliveriesSheet({
  webhook,
  onOpenChange,
}: {
  webhook: WebhookView | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [deliveries, setDeliveries] = useState<DeliveryView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const mounted = useMounted();
  const webhookId = webhook?.id ?? null;

  const load = useCallback(async () => {
    if (!webhookId) {
      return;
    }
    try {
      const result = await api<{ deliveries: DeliveryView[] }>(`/webhooks/${webhookId}/deliveries`);
      setDeliveries(result.deliveries);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [webhookId]);

  useEffect(() => {
    if (!webhookId) {
      setDeliveries(null);
      setFailed(false);
      return;
    }
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [webhookId, load]);

  return (
    <Sheet open={webhook !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Deliveries</SheetTitle>
          <SheetDescription>
            {webhook ? `The last ${deliveries?.length ?? ''} deliveries to ${webhook.name}.` : ''}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4" data-testid="webhook-deliveries">
          {deliveries === null && !failed ? (
            <Stack gap="sm">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </Stack>
          ) : failed && deliveries === null ? (
            <Stack gap="sm">
              <Text size="sm" muted>
                The history couldn't be loaded.
              </Text>
              <Button variant="secondary" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </Stack>
          ) : deliveries && deliveries.length === 0 ? (
            <Text size="sm" muted>
              Nothing has been sent to this webhook yet. Send a test to see one here.
            </Text>
          ) : (
            <ul className="flex flex-col gap-2">
              {deliveries?.map((delivery) => (
                <li
                  key={delivery.id}
                  data-testid="webhook-delivery"
                  data-status={delivery.status}
                  data-event={delivery.event}
                  className="rounded-md border-2 border-outline bg-secondary p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-sans text-sm font-semibold text-ink">{delivery.event}</span>
                    <Badge variant={deliveryTone(delivery.status)}>{deliveryLabel(delivery.status)}</Badge>
                  </div>
                  <Text size="xs" muted>
                    {describeDeliveryAttempt(delivery)}
                  </Text>
                  <Text size="xs" muted>
                    {mounted
                      ? formatRelative(delivery.lastAttemptAt ?? delivery.createdAt)
                      : ''}
                  </Text>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
