'use client';

/**
 * Create or edit a webhook (Sprint 8).
 *
 * One dialog for both, keyed on whether a hook was handed in. After a
 * create the dialog stays open on the secret panel: closing it is the
 * person's acknowledgement that they have the secret, and nothing else on
 * the page can show it again.
 *
 * Validation here is a hint; the API judges the URL (the SSRF guard) and
 * the channel list for real, and its message is shown verbatim under the
 * form when it refuses.
 */
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormErrorMessage,
  FormField,
  FormHelperText,
  FormLabel,
  Input,
  MultiSelect,
  Stack,
  Text,
} from '@postgear/ui';
import { useEffect, useId, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Channel } from '@/types/channel';
import { WEBHOOK_EVENTS, type WebhookCreated, type WebhookEvent, type WebhookView } from '@/types/webhooks';
import { SecretPanel } from './secret-panel';
import {
  EVENT_LABELS,
  emptyWebhookForm,
  formFromWebhook,
  validateWebhookForm,
  type WebhookFormErrors,
  type WebhookFormValues,
} from './webhooks-view-model';

export function WebhookDialog({
  open,
  webhook,
  channels,
  allowHttp,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  /** The hook being edited, or null to create one. */
  webhook: WebhookView | null;
  channels: Channel[];
  allowHttp: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (webhook: WebhookView) => void;
}) {
  const [values, setValues] = useState<WebhookFormValues>(emptyWebhookForm);
  const [errors, setErrors] = useState<WebhookFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<WebhookCreated | null>(null);
  const formId = useId();

  // Reset on every open so an abandoned edit never leaks into a create.
  useEffect(() => {
    if (open) {
      setValues(webhook ? formFromWebhook(webhook) : emptyWebhookForm());
      setErrors({});
      setServerError(null);
      setCreated(null);
    }
  }, [open, webhook]);

  function toggleEvent(event: WebhookEvent, checked: boolean) {
    setValues((current) => ({
      ...current,
      events: checked
        ? [...new Set([...current.events, event])]
        : current.events.filter((entry) => entry !== event),
    }));
  }

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    const found = validateWebhookForm(values, allowHttp);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }

    setSaving(true);
    setServerError(null);
    const body = {
      name: values.name.trim(),
      url: values.url.trim(),
      events: values.events,
      channelIds: values.channelIds,
    };

    try {
      if (webhook) {
        const result = await api<{ webhook: WebhookView }>(`/webhooks/${webhook.id}`, {
          method: 'PATCH',
          body,
        });
        onSaved(result.webhook);
        onOpenChange(false);
      } else {
        const result = await api<WebhookCreated>('/webhooks', { method: 'POST', body });
        setCreated(result);
        onSaved(result.webhook);
      }
    } catch (cause) {
      setServerError(cause instanceof ApiError ? cause.message : 'We could not save that webhook.');
    } finally {
      setSaving(false);
    }
  }

  const channelOptions = channels.map((channel) => ({ value: channel.id, label: channel.name }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Webhook created</DialogTitle>
              <DialogDescription>
                {created.webhook.name} will receive{' '}
                {created.webhook.events.map((event) => EVENT_LABELS[event].label.toLowerCase()).join(' and ')}{' '}
                events.
              </DialogDescription>
            </DialogHeader>
            <SecretPanel secret={created.secret} />
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)} data-testid="webhook-secret-done">
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form id={formId} onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>{webhook ? 'Edit webhook' : 'Add a webhook'}</DialogTitle>
              <DialogDescription>
                PostGear sends a signed JSON POST to this URL when the chosen events happen.
              </DialogDescription>
            </DialogHeader>

            <Stack gap="md" className="py-4">
              <FormField>
                <FormLabel htmlFor={`${formId}-name`} required>
                  Name
                </FormLabel>
                <Input
                  id={`${formId}-name`}
                  value={values.name}
                  maxLength={60}
                  placeholder="Zapier, my CRM, …"
                  variant={errors.name ? 'error' : undefined}
                  onChange={(event) => setValues({ ...values, name: event.target.value })}
                />
                {errors.name ? <FormErrorMessage>{errors.name}</FormErrorMessage> : null}
              </FormField>

              <FormField>
                <FormLabel htmlFor={`${formId}-url`} required>
                  URL
                </FormLabel>
                <Input
                  id={`${formId}-url`}
                  value={values.url}
                  inputMode="url"
                  placeholder={allowHttp ? 'https://… or http://localhost:4000/…' : 'https://…'}
                  variant={errors.url ? 'error' : undefined}
                  onChange={(event) => setValues({ ...values, url: event.target.value })}
                />
                {errors.url ? (
                  <FormErrorMessage>{errors.url}</FormErrorMessage>
                ) : (
                  <FormHelperText>
                    {allowHttp
                      ? 'Private addresses are allowed on this deployment for local testing.'
                      : 'Public https:// only. Private and internal addresses are refused.'}
                  </FormHelperText>
                )}
              </FormField>

              <fieldset>
                <legend className="font-sans text-sm font-bold text-ink">Events</legend>
                <Stack gap="sm" className="mt-2">
                  {WEBHOOK_EVENTS.map((event) => {
                    const id = `${formId}-${event}`;
                    return (
                      <label key={event} htmlFor={id} className="flex items-start gap-3">
                        <Checkbox
                          id={id}
                          checked={values.events.includes(event)}
                          onCheckedChange={(checked) => toggleEvent(event, checked === true)}
                          className="mt-0.5"
                        />
                        <span className="flex flex-col">
                          <span className="font-sans text-sm font-medium text-ink">
                            {EVENT_LABELS[event].label}
                          </span>
                          <Text size="xs" muted as="span">
                            {EVENT_LABELS[event].hint}
                          </Text>
                        </span>
                      </label>
                    );
                  })}
                </Stack>
                {errors.events ? <FormErrorMessage>{errors.events}</FormErrorMessage> : null}
              </fieldset>

              <FormField>
                <FormLabel>Channels</FormLabel>
                <MultiSelect
                  options={channelOptions}
                  value={values.channelIds}
                  onValueChange={(channelIds) => setValues({ ...values, channelIds })}
                  placeholder="Every channel"
                  searchPlaceholder="Search channels…"
                  emptyText="No channels match."
                />
                <FormHelperText>Leave empty to receive events from every channel.</FormHelperText>
              </FormField>

              {serverError ? <FormErrorMessage>{serverError}</FormErrorMessage> : null}
            </Stack>

            <DialogFooter>
              <Button variant="secondary" type="button" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving} data-testid="webhook-save">
                {saving ? 'Saving…' : webhook ? 'Save changes' : 'Create webhook'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
