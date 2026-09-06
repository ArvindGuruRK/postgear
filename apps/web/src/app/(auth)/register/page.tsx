import { Heading, Link, Stack, Text } from '@postgear/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { OAuthButtons } from '@/components/auth/oauth-buttons';
import { RegisterForm } from '@/components/auth/register-form';
import { getSession } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Create account',
};

// Server component for the metadata export; the form is a client island. See
// ../layout.tsx for why this screen is not wrapped in a Card.
export default async function RegisterPage() {
  // See the note in ../login/page.tsx for why this guard is per-page rather
  // than in the group layout.
  if (await getSession()) {
    redirect('/');
  }

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Heading level="h2">Create your account</Heading>
        <Text muted>Start scheduling across every channel in a few minutes.</Text>
      </Stack>

      <RegisterForm />

      <OAuthButtons />

      <Stack direction="row" gap="xs" justify="center" align="center">
        <Text size="sm" muted>
          Already have an account?
        </Text>
        <Link href="/login" className="text-sm">
          Sign in
        </Link>
      </Stack>
    </Stack>
  );
}
