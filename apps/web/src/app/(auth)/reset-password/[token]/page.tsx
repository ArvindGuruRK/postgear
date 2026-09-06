import { Heading, Stack, Text } from '@postgear/ui';
import type { Metadata } from 'next';
import { NewPasswordForm } from '@/components/auth/new-password-form';

export const metadata: Metadata = {
  title: 'Choose a new password',
};

/**
 * The landing page for an emailed reset link.
 *
 * The token is not validated here. Doing so would need a second endpoint whose
 * only job is to answer "is this token real?" — a free oracle for probing
 * tokens without spending them. The form posts it, and the API decides.
 */
export default async function NewPasswordPage({ params }: PageProps<'/reset-password/[token]'>) {
  const { token } = await params;

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Heading level="h2">Choose a new password</Heading>
        <Text muted>Pick something you have not used here before.</Text>
      </Stack>

      <NewPasswordForm token={token} />
    </Stack>
  );
}
