'use client';

import {
  Button,
  Checkbox,
  FormErrorMessage,
  FormField,
  FormHelperText,
  FormLabel,
  Input,
  PasswordInput,
  Stack,
  Text,
} from '@postgear/ui';
import { type FormEvent, useState } from 'react';
import { ApiError, api } from '@/lib/api';

/** Mirrors the server's rule in `apps/api/src/modules/auth/dto/common.schema.ts`. */
const PASSWORD_MIN = 12;

/**
 * The sign-up form.
 *
 * ## Client-side validation exists, and is not trusted
 *
 * The length and digit checks below duplicate the server's. That duplication
 * is deliberate and is the resolution of a genuine tension in the
 * requirements: the server must return a single generic "Invalid input" that
 * names no field, but a signup form that says only that is close to unusable —
 * the user has no idea which of four fields to fix.
 *
 * So the client keeps its own field-level hints for the common case of an
 * honest mistake, and the server re-validates everything and refuses to say
 * anything specific. An attacker probing the API directly learns nothing; a
 * user who typo'd their email still gets told which box to look at.
 *
 * ## Success does not sign you in
 *
 * Registration returns the same "check your email" message whether or not the
 * address was already taken — so the form cannot know whether an account was
 * created, and must not pretend to. It shows the confirmation state and stops.
 */
export function RegisterForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');

    // Local hints only — see the note above. The server re-checks all of this.
    if (!name) {
      setError('Enter your name.');
      return;
    }
    if (!email.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < PASSWORD_MIN || !/[0-9]/.test(password)) {
      setError(`Your password needs at least ${PASSWORD_MIN} characters and a number.`);
      return;
    }
    if (!form.get('terms')) {
      setError('Please accept the terms to continue.');
      return;
    }

    setPending(true);

    try {
      await api('/auth/register', { method: 'POST', body: { email, password, name } });
      setSubmitted(true);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Something went wrong. Please try again.',
      );
      setPending(false);
    }
  }

  if (submitted) {
    return (
      <Stack gap="sm">
        <Text>Check your email to confirm your account.</Text>
        <Text size="sm" muted>
          We have sent a confirmation link. It expires in 24 hours. If nothing arrives, check your
          spam folder.
        </Text>
      </Stack>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack gap="md">
        {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}

        <FormField>
          <FormLabel htmlFor="name" required>
            Full name
          </FormLabel>
          <Input id="name" name="name" autoComplete="name" placeholder="Ada Lovelace" required />
        </FormField>

        <FormField>
          <FormLabel htmlFor="email" required>
            Work email
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
          <FormLabel htmlFor="password" required>
            Password
          </FormLabel>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            placeholder="Enter your password"
            required
          />
          <FormHelperText>At least 12 characters, including a number.</FormHelperText>
        </FormField>

        {/* No organization/workspace field here by design — creating the
            workspace belongs to the post-signup onboarding flow, not to
            the signup form. Sprint 2 builds that flow at /onboarding. */}

        {/* No margin nudge on the Checkbox: it is h-5 (20px) and Text
            size="sm" has a 20px line-height, so align="start" lines the
            two up exactly. align="start" rather than "center" so the box
            stays on the first line if the text ever wraps. */}
        <Stack direction="row" gap="sm" align="start">
          <Checkbox id="terms" name="terms" />
          <Text size="sm" muted>
            I agree to the terms of service and privacy policy.
          </Text>
        </Stack>

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? 'Creating account…' : 'Create account'}
        </Button>
      </Stack>
    </form>
  );
}
