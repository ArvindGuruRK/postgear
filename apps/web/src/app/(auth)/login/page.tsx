import { Heading, Link, Stack, Text } from '@postgear/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/login-form';
import { OAuthButtons } from '@/components/auth/oauth-buttons';
import { getSession } from '@/lib/session';
import { safeNextPath, withNext } from './safe-next';

export const metadata: Metadata = {
  title: 'Sign In',
};

// The page stays a server component so it can export `metadata`: a client
// component cannot. The interactive parts are two small client islands.
//
// LoginForm reads `useSearchParams` (to surface ?error=oauth from a failed
// handshake), which Next requires to sit inside a Suspense boundary or the
// whole route opts out of static rendering with a build-time error.
//
// `?next=` (2026-10-19) is where to go once signed in, used by the
// invitation page so "Sign in to join" lands back on the invitation. It is
// checked here, once, by `safeNextPath`, and only the checked value is
// handed on to the form and the register link.
export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const next = safeNextPath((await searchParams).next);

  // The inverse of route gate 1: a signed-in visitor who navigates back here
  // is sent to `/`, which routes them on to their workspace or to onboarding
  // (or straight to a checked `next`).
  //
  // This lives on the page rather than in (auth)/layout.tsx on purpose. The
  // same group holds /verify and /reset-password/[token], and a signed-in user
  // clicking a confirmation link from their email must still reach those: a
  // layout-level redirect would bounce them away from their own reset link.
  if (await getSession()) {
    redirect(next ?? '/');
  }

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Heading level="h2">Sign In</Heading>
        <Text muted>Welcome back. Pick up where your queue left off.</Text>
      </Stack>

      <Suspense fallback={null}>
        <LoginForm next={next} />
      </Suspense>

      <OAuthButtons />

      <Stack direction="row" gap="xs" justify="center" align="center">
        <Text size="sm" muted>
          New to PostGear?
        </Text>
        <Link href={withNext('/register', next)} className="text-sm">
          Create an account
        </Link>
      </Stack>
    </Stack>
  );
}
