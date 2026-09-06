'use client';

import {
  Button,
  FormErrorMessage,
  FormField,
  FormHelperText,
  FormLabel,
  PasswordInput,
  Stack,
  Text,
} from '@postgear/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { ApiError, api } from '@/lib/api';

const PASSWORD_MIN = 12;

/**
 * "Choose a new password", reached from the emailed link.
 *
 * The token comes from the URL segment rather than a hidden field, so a user
 * who reloads the page keeps it. Completing this also clears any active
 * lockout server-side — which is why the lockout notification email links
 * here: it is the escape hatch for someone who cannot wait fifteen minutes.
 */
export function NewPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const confirm = String(form.get('confirm') ?? '');

    if (password.length < PASSWORD_MIN || !/[0-9]/.test(password)) {
      setError(`Your password needs at least ${PASSWORD_MIN} characters and a number.`);
      return;
    }

    // Confirmation is a client-only concern: the server has no use for a
    // second copy of the same value, and sending it would only be one more
    // place a password exists.
    if (password !== confirm) {
      setError('Those passwords do not match.');
      return;
    }

    setPending(true);

    try {
      await api('/auth/password/reset', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Something went wrong. Please try again.',
      );
      setPending(false);
    }
  }

  if (done) {
    return (
      <Stack gap="sm">
        <Text>Your password has been changed.</Text>
        <Button size="lg" className="w-full" onClick={() => router.push('/login')}>
          Sign in
        </Button>
      </Stack>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack gap="md">
        {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}

        <FormField>
          <FormLabel htmlFor="password" required>
            New password
          </FormLabel>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            placeholder="Enter a new password"
            required
          />
          <FormHelperText>At least 12 characters, including a number.</FormHelperText>
        </FormField>

        <FormField>
          <FormLabel htmlFor="confirm" required>
            Confirm password
          </FormLabel>
          <PasswordInput
            id="confirm"
            name="confirm"
            autoComplete="new-password"
            placeholder="Type it again"
            required
          />
        </FormField>

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? 'Saving…' : 'Set new password'}
        </Button>

        <Text size="sm" muted className="text-center">
          Link expired? <Link href="/reset-password">Request a new one</Link>
        </Text>
      </Stack>
    </form>
  );
}
