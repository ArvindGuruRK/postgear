'use client';

import {
  Button,
  FormErrorMessage,
  FormField,
  FormLabel,
  Input,
  Link,
  PasswordInput,
  Stack,
} from '@postgear/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { ApiError, api } from '@/lib/api';

/**
 * The sign-in form.
 *
 * The markup is the inert Sprint 0 form, wired up — same components, same
 * layout, same copy. Two things it has to get right that the static version
 * did not have to think about:
 *
 * - `type="submit"` on the button. `Button` defaults to `type="button"`, so
 *   without this the form never submits and Enter does nothing.
 * - The error is rendered once, above the fields, not per field. The API
 *   returns a single generic message for every failure cause (wrong email,
 *   wrong password, unactivated, locked), so there is no per-field information
 *   to render — and inventing one would undo the property that makes the API
 *   useless for account enumeration.
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(
    // The OAuth callback redirects here with ?error=oauth when a handshake
    // fails, since it cannot render a message into a page it is redirecting to.
    searchParams.get('error') === 'oauth' ? 'We could not complete that sign-in' : null,
  );
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);

    try {
      await api('/auth/login', {
        method: 'POST',
        body: {
          email: String(form.get('email') ?? ''),
          password: String(form.get('password') ?? ''),
        },
      });

      // Send them to the root and let the two route gates decide: dashboard if
      // onboarded, /onboarding if not. Deciding here would put that logic in a
      // second place, where it can drift.
      router.replace('/');
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Something went wrong. Please try again.',
      );
      setPending(false);
    }
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
        </FormField>

        <FormField>
          <Stack direction="row" justify="between" align="center" gap="sm">
            <FormLabel htmlFor="password" required>
              Password
            </FormLabel>
            <Link href="/reset-password" className="text-xs">
              Forgot password?
            </Link>
          </Stack>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            required
          />
        </FormField>

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </Stack>
    </form>
  );
}
