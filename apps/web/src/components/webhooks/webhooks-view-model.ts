/**
 * Pure helpers for the webhooks page: how a delivery's state reads, how a
 * URL is shown, and the form's validation. Kept out of the components so each
 * rule is a one-line test.
 */
import type { DeliveryView, WebhookDeliveryStatus, WebhookEvent, WebhookView } from '@/types/webhooks';

export type BadgeTone = 'success' | 'danger' | 'accent' | 'outline' | 'primary';

export const EVENT_LABELS: Record<WebhookEvent, { label: string; hint: string }> = {
  'post.published': { label: 'Post published', hint: 'When a post goes out on a channel.' },
  'post.failed': { label: 'Post failed', hint: 'When PostGear gives up publishing a post.' },
};

export function deliveryTone(status: WebhookDeliveryStatus): BadgeTone {
  switch (status) {
    case 'DELIVERED':
      return 'success';
    case 'FAILED':
      return 'danger';
    case 'PENDING':
      return 'accent';
  }
}

export function deliveryLabel(status: WebhookDeliveryStatus): string {
  switch (status) {
    case 'DELIVERED':
      return 'Delivered';
    case 'FAILED':
      return 'Failed';
    case 'PENDING':
      return 'Pending';
  }
}

/** "Delivered (200)" / "Failed (404)" / "Pending" for the list's status column. */
export function describeLastDelivery(webhook: WebhookView): string {
  if (!webhook.lastDelivery) {
    return 'No deliveries yet';
  }
  const code = webhook.lastDelivery.statusCode;
  const label = deliveryLabel(webhook.lastDelivery.status);
  return code === null ? label : `${label} (${code})`;
}

/** The host and path, with a long path cut, for the list. */
export function shortUrl(url: string, max = 48): string {
  try {
    const parsed = new URL(url);
    const shown = `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`;
    return shown.length <= max ? shown : `${shown.slice(0, max - 1)}…`;
  } catch {
    return url.length <= max ? url : `${url.slice(0, max - 1)}…`;
  }
}

export function describeDeliveryAttempt(delivery: DeliveryView): string {
  if (delivery.status === 'DELIVERED') {
    return `Delivered on attempt ${delivery.attempts}${
      delivery.lastStatusCode !== null ? ` (${delivery.lastStatusCode})` : ''
    }`;
  }
  if (delivery.status === 'FAILED') {
    return `Failed after ${delivery.attempts} attempt${delivery.attempts === 1 ? '' : 's'}${
      delivery.lastError ? `: ${delivery.lastError}` : ''
    }`;
  }
  return delivery.attempts === 0
    ? 'Waiting for the first attempt'
    : `Attempt ${delivery.attempts} failed${delivery.lastError ? `: ${delivery.lastError}` : ''}; retrying`;
}

export interface WebhookFormValues {
  name: string;
  url: string;
  events: WebhookEvent[];
  channelIds: string[];
}

export interface WebhookFormErrors {
  name?: string;
  url?: string;
  events?: string;
}

/** Client-side hints only; the API judges the URL for real. */
export function validateWebhookForm(values: WebhookFormValues, allowHttp: boolean): WebhookFormErrors {
  const errors: WebhookFormErrors = {};

  if (values.name.trim().length === 0) {
    errors.name = 'Give the webhook a name.';
  } else if (values.name.trim().length > 60) {
    errors.name = 'Keep the name under 60 characters.';
  }

  const url = values.url.trim();
  if (url.length === 0) {
    errors.url = 'Enter the URL to send events to.';
  } else if (!/^https:\/\//i.test(url) && !(allowHttp && /^http:\/\//i.test(url))) {
    errors.url = allowHttp ? 'The URL must start with http:// or https://' : 'The URL must start with https://';
  } else {
    try {
      new URL(url);
    } catch {
      errors.url = 'That is not a valid URL.';
    }
  }

  if (values.events.length === 0) {
    errors.events = 'Choose at least one event.';
  }

  return errors;
}

export function emptyWebhookForm(): WebhookFormValues {
  return { name: '', url: '', events: ['post.published', 'post.failed'], channelIds: [] };
}

export function formFromWebhook(webhook: WebhookView): WebhookFormValues {
  return {
    name: webhook.name,
    url: webhook.url,
    events: [...webhook.events],
    channelIds: [...webhook.channelIds],
  };
}

export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return '';
  }
  const seconds = Math.round((now.getTime() - then) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
