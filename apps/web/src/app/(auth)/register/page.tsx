import { Heading, Link, Stack, Text } from '@postgear/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { OAuthButtons } from '@/components/auth/oauth-buttons';
import { RegisterForm } from '@/components/auth/register-form';
import { getSession } from '@/lib/session';
import { safeNextPath, withNext } from '../login/safe-next';

export const metadata: Metadata = {
  title: 'Create Account',
};

// Server component for the metadata export; the form is a client island. See
// ../layout.tsx for why this screen is not wrapped in a Card.
//
// `?next=` (2026-10-19) comes from the invitation page. Registering does not
// sign anyone in (the account has to be confirmed by email first), so it is
// not a redirect here: it rides along on the "Sign in" links, so the person
// who confirms and then signs in from this tab lands back on the invitation.
export default async function RegisterPage({ searchParams }: PageProps<'/register'>) {
  const next = safeNextPath((await searchParams).next);

  // See the note in ../login/page.tsx for why this guard is per-page rather
  // than in the group layout.
  if (await getSession()) {
    redirect(next ?? '/');
  }

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Heading level="h2">Create Your Account</Heading>
        <Text muted>Start scheduling across every channel in a few minutes.</Text>
      </Stack>

      <RegisterForm next={next} />

      <OAuthButtons />

      <Stack direction="row" gap="xs" justify="center" align="center">
        <Text size="sm" muted>
          Already have an account?
        </Text>
        <Link href={withNext('/login', next)} className="text-sm">
          Sign in
        </Link>
      </Stack>
    </Stack>
  );
}
