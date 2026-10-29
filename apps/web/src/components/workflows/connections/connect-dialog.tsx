'use client';

/**
 * Add, reconnect or rename one connection (Sprint 10, Module 04).
 *
 * - **Add**: a name and the app's link (or secret headers), with a folded
 *   "Where do I find this?" list of steps and the app's own docs.
 * - **Reconnect**: new details only. The old ones are never shown, because
 *   the API never sends them.
 * - **Rename**: the name only.
 *
 * The hints are a shortcut; the API judges the link for real and its
 * sentence is shown under the form when it refuses.
 */
import { ChevronDownIcon } from '@animateicons/react/lucide/chevron-down-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import type { ConnectionKind } from '@postgear/automation';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
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
  MotionIcon,
  PasswordInput,
  Stack,
  Text,
} from '@postgear/ui';
import { useEffect, useId, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Connection } from '@/types/workflows';
import { AppIcon } from '../app-icon';
import {
  appIcon,
  appTitle,
  type ConnectionFormErrors,
  type ConnectionFormValues,
  credentialsFrom,
  emptyConnectionForm,
  type FormApp,
  HELP,
  MAX_CONNECTION_NAME_LENGTH,
  MAX_SECRET_HEADERS,
  validateConnectionForm,
} from './connections-view-model';

export type ConnectDialogMode =
  | { kind: 'add'; app: FormApp }
  | { kind: 'reconnect'; connection: Connection }
  | { kind: 'rename'; connection: Connection };

function appOf(mode: ConnectDialogMode): ConnectionKind {
  return mode.kind === 'add' ? mode.app : mode.connection.provider;
}

export function ConnectDialog({
  mode,
  onOpenChange,
  onSaved,
}: {
  /** Null while closed. */
  mode: ConnectDialogMode | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (connection: Connection) => void;
}) {
  const [values, setValues] = useState<ConnectionFormValues>(emptyConnectionForm);
  const [errors, setErrors] = useState<ConnectionFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = useId();

  // Reset on every open, so a half-typed link never carries into another app.
  useEffect(() => {
    if (!mode) return;
    setValues({
      ...emptyConnectionForm(),
      name: mode.kind === 'rename' ? mode.connection.name : '',
    });
    setErrors({});
    setServerError(null);
  }, [mode]);

  if (!mode) return null;
  const app = appOf(mode) as FormApp;
  const title = appTitle(app);
  const help = app === 'http' ? null : HELP[app];
  const showName = mode.kind !== 'reconnect';
  const showDetails = mode.kind !== 'rename';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!mode) return;
    const found = validateConnectionForm(app, values, { details: showDetails, name: showName });
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    setServerError(null);
    try {
      const result =
        mode.kind === 'add'
          ? await api<{ connection: Connection }>('/automation-connections', {
              method: 'POST',
              body: {
                provider: app,
                name: values.name.trim(),
                credentials: credentialsFrom(app, values),
              },
            })
          : await api<{ connection: Connection }>(`/automation-connections/${mode.connection.id}`, {
              method: 'PATCH',
              body:
                mode.kind === 'rename'
                  ? { name: values.name.trim() }
                  : { credentials: credentialsFrom(app, values) },
            });
      onSaved(result.connection);
      onOpenChange(false);
    } catch (cause) {
      setServerError(
        cause instanceof ApiError ? cause.message : 'That could not be saved. Try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  function setHeader(index: number, patch: Partial<ConnectionFormValues['headers'][number]>) {
    setValues((current) => ({
      ...current,
      headers: current.headers.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  }

  const heading =
    mode.kind === 'add'
      ? `Connect ${title}`
      : mode.kind === 'reconnect'
        ? `Reconnect ${mode.connection.name}`
        : 'Rename Connection';

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form id={formId} onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AppIcon icon={appIcon(app)} className="h-5 w-5" />
              {heading}
            </DialogTitle>
            <DialogDescription>
              {mode.kind === 'rename'
                ? 'Workflows keep using it under the new name.'
                : app === 'http'
                  ? 'Headers your HTTP Request steps send, kept encrypted and never shown again.'
                  : `PostGear keeps the link encrypted and shows only its last 4 characters.`}
            </DialogDescription>
          </DialogHeader>

          <Stack gap="md" className="py-4">
            {showName ? (
              <FormField>
                <FormLabel htmlFor={`${formId}-name`} required>
                  Connection name
                </FormLabel>
                <Input
                  id={`${formId}-name`}
                  value={values.name}
                  maxLength={MAX_CONNECTION_NAME_LENGTH}
                  placeholder="Enter your connection name"
                  variant={errors.name ? 'error' : undefined}
                  onChange={(event) => setValues({ ...values, name: event.target.value })}
                  data-testid="connection-name"
                />
                {errors.name ? <FormErrorMessage>{errors.name}</FormErrorMessage> : null}
              </FormField>
            ) : null}

            {showDetails && help ? (
              <FormField>
                <FormLabel htmlFor={`${formId}-link`} required>
                  {help.linkLabel}
                </FormLabel>
                <PasswordInput
                  id={`${formId}-link`}
                  value={values.link}
                  inputMode="url"
                  autoComplete="off"
                  placeholder={`Enter your ${title} link`}
                  variant={errors.link ? 'error' : undefined}
                  onChange={(event) => setValues({ ...values, link: event.target.value })}
                  data-testid="connection-link"
                />
                {errors.link ? <FormErrorMessage>{errors.link}</FormErrorMessage> : null}
              </FormField>
            ) : null}

            {showDetails && app === 'http' ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="type-ui text-sm text-ink">Secret headers</legend>
                {values.headers.map((row, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id until saved
                  <div key={index} className="flex items-start gap-2">
                    <Input
                      aria-label={`Header ${index + 1} name`}
                      value={row.name}
                      placeholder="Enter your header name"
                      onChange={(event) => setHeader(index, { name: event.target.value })}
                      className="w-2/5"
                    />
                    <PasswordInput
                      aria-label={`Header ${index + 1} value`}
                      value={row.value}
                      autoComplete="off"
                      placeholder="Enter your header value"
                      onChange={(event) => setHeader(index, { value: event.target.value })}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      aria-label={`Remove header ${index + 1}`}
                      disabled={values.headers.length === 1}
                      onClick={() =>
                        setValues({
                          ...values,
                          headers: values.headers.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={values.headers.length >= MAX_SECRET_HEADERS}
                    onClick={() =>
                      setValues({
                        ...values,
                        headers: [...values.headers, { name: '', value: '' }],
                      })
                    }
                  >
                    <MotionIcon icon={PlusIcon} className="h-4 w-4" />
                    Add Header
                  </Button>
                </div>
                {errors.headers ? (
                  <FormErrorMessage>{errors.headers}</FormErrorMessage>
                ) : (
                  <FormHelperText>For example Authorization, or X-Api-Key.</FormHelperText>
                )}
              </fieldset>
            ) : null}

            {showDetails && help ? (
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="secondary" size="sm" className="group">
                    Where Do I Find This?
                    <MotionIcon
                      icon={ChevronDownIcon}
                      className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180"
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink">
                    {help.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  {help.note ? (
                    <Text size="sm" muted className="mt-2">
                      {help.note}
                    </Text>
                  ) : null}
                  <a
                    href={help.docs}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-sm font-semibold text-ink underline"
                  >
                    {title} help
                  </a>
                </CollapsibleContent>
              </Collapsible>
            ) : null}

            {serverError ? (
              <FormErrorMessage data-testid="connection-error">{serverError}</FormErrorMessage>
            ) : null}
          </Stack>

          <DialogFooter>
            <Button
              variant="secondary"
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving} data-testid="connection-save">
              {saving
                ? 'Saving...'
                : mode.kind === 'add'
                  ? 'Save Connection'
                  : mode.kind === 'reconnect'
                    ? 'Reconnect'
                    : 'Save Name'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
