import { Heading, Link, Stack, Text } from '@postgear/ui';
import type { Metadata } from 'next';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';

export const metadata: Metadata = {
  title: 'Reset password',
};

export default function ResetPasswordPage() {
  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Heading level="h2">Reset your password</Heading>
        <Text muted>We&apos;ll email you a link to choose a new one.</Text>
      </Stack>

      <ResetPasswordForm />

      <Stack direction="row" gap="xs" justify="center" align="center">
        <Text size="sm" muted>
          Remembered it?
        </Text>
        <Link href="/login" className="text-sm">
          Sign in
        </Link>
      </Stack>
    </Stack>
  );
}
