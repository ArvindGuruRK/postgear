'use client';

import {
  Button,
  FormErrorMessage,
  FormField,
  FormHelperText,
  FormLabel,
  Input,
  Stack,
  Text,
} from '@postgear/ui';
import { type FormEvent, useState } from 'react';
import { ApiError, api } from '@/lib/api';

/**
 * "Send me a reset link".
 *
 * The success state is shown for **every** submission that the server accepts,
 * including addresses with no account behind them. That is not a shortcut — it
 * is the requirement: the response must not reveal whether an address is
 * registered, so the UI cannot branch on something it is deliberately not told.
 *
 * The one case that does show an error is a 429 from the throttle, which says
 * nothing about any account.
 */
export function ResetPasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);

    try {
      await api('/auth/password/reset-request', {
        method: 'POST',
        body: { email: String(form.get('email') ?? '') },
      });
      setSent(true);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Something went wrong. Please try again.',
      );
      setPending(false);
    }
  }

  if (sent) {
    return (
      <Stack gap="sm">
        <Text>If that email is registered, you&apos;ll receive a reset link.</Text>
        <Text size="sm" muted>
          The link expires in one hour and can only be used once.
        </Text>
      </Stack>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack gap="md">
        {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}

        <FormField>
          <FormLabel htmlFor="email" required>
            Email
          </FormLabel>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            required
          />
          <FormHelperText>
            Use the address you signed up with. The link expires in one hour.
          </FormHelperText>
        </FormField>

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? 'Sending…' : 'Send reset link'}
        </Button>
      </Stack>
    </form>
  );
}
