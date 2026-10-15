import type { DeliveryView, WebhookView } from '@/types/webhooks';
import {
  deliveryTone,
  describeDeliveryAttempt,
  describeLastDelivery,
  formatRelative,
  shortUrl,
  validateWebhookForm,
} from './webhooks-view-model';

const hook = (lastDelivery: WebhookView['lastDelivery']): WebhookView => ({
  id: 'h1',
  name: 'Zapier',
  url: 'https://hooks.zapier.com/hooks/catch/1/2',
  events: ['post.published'],
  channelIds: [],
  disabled: false,
  createdAt: '2026-10-16T10:00:00.000Z',
  lastDelivery,
});

const delivery = (overrides: Partial<DeliveryView>): DeliveryView => ({
  id: 'd1',
  event: 'post.published',
  status: 'PENDING',
  attempts: 0,
  lastStatusCode: null,
  lastError: null,
  lastAttemptAt: null,
  deliveredAt: null,
  createdAt: '2026-10-16T10:00:00.000Z',
  ...overrides,
});

describe('webhooks view model', () => {
  it('maps delivery states onto the Sprint 5 tone vocabulary', () => {
    expect(deliveryTone('DELIVERED')).toBe('success');
    expect(deliveryTone('FAILED')).toBe('danger');
    expect(deliveryTone('PENDING')).toBe('accent');
  });

  it('describes the last delivery with its status code when there is one', () => {
    expect(describeLastDelivery(hook(null))).toBe('No deliveries yet');
    expect(describeLastDelivery(hook({ status: 'DELIVERED', at: 'x', statusCode: 200 }))).toBe(
      'Delivered · 200',
    );
    expect(describeLastDelivery(hook({ status: 'PENDING', at: 'x', statusCode: null }))).toBe('Pending');
  });

  it('shortens a URL to its host and path', () => {
    expect(shortUrl('https://hooks.zapier.com/hooks/catch/1/2')).toBe('hooks.zapier.com/hooks/catch/1/2');
    expect(shortUrl('https://example.com/')).toBe('example.com');
    expect(shortUrl(`https://example.com/${'a'.repeat(80)}`)).toHaveLength(48);
  });

  it('narrates an attempt', () => {
    expect(describeDeliveryAttempt(delivery({}))).toBe('Waiting for the first attempt');
    expect(
      describeDeliveryAttempt(delivery({ attempts: 2, lastError: 'Connection refused' })),
    ).toBe('Attempt 2 failed: Connection refused; retrying');
    expect(
      describeDeliveryAttempt(delivery({ status: 'DELIVERED', attempts: 3, lastStatusCode: 204 })),
    ).toBe('Delivered on attempt 3 (204)');
    expect(
      describeDeliveryAttempt(delivery({ status: 'FAILED', attempts: 1, lastError: 'Receiver answered 404' })),
    ).toBe('Failed after 1 attempt: Receiver answered 404');
  });

  it('validates the form the way the API will, as hints', () => {
    const base = { name: 'Zapier', url: 'https://hooks.example.com/in', events: ['post.failed' as const], channelIds: [] };
    expect(validateWebhookForm(base, false)).toEqual({});
    expect(validateWebhookForm({ ...base, name: ' ' }, false).name).toBeDefined();
    expect(validateWebhookForm({ ...base, url: 'http://hooks.example.com' }, false).url).toMatch(/https/);
    expect(validateWebhookForm({ ...base, url: 'http://localhost:4000/in' }, true)).toEqual({});
    expect(validateWebhookForm({ ...base, url: 'https://' }, false).url).toBeDefined();
    expect(validateWebhookForm({ ...base, events: [] }, false).events).toBeDefined();
  });

  it('formats a relative time', () => {
    const now = new Date('2026-10-16T12:00:00Z');
    expect(formatRelative('2026-10-16T11:59:50Z', now)).toBe('just now');
    expect(formatRelative('2026-10-16T11:30:00Z', now)).toBe('30 min ago');
    expect(formatRelative('2026-10-16T09:00:00Z', now)).toBe('3 h ago');
    expect(formatRelative('2026-10-14T12:00:00Z', now)).toBe('2 d ago');
    expect(formatRelative('nonsense', now)).toBe('');
  });
});
