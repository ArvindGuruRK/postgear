import {
  Button,
  FormField,
  FormHelperText,
  FormLabel,
  Heading,
  Input,
  Link,
  Stack,
  Text,
} from '@postgear/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Reset password',
};

// Inert like the other auth forms — Sprint 2 owns the reset-token flow, which
// is also where the "check your email" confirmation state belongs. See
// ../layout.tsx for why this screen is no longer wrapped in a Card.
export default function ResetPasswordPage() {
  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Heading level="h2">Reset your password</Heading>
        <Text muted>We&apos;ll email you a link to choose a new one.</Text>
      </Stack>

      <form>
        <Stack gap="md">
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
            />
            <FormHelperText>
              Use the address you signed up with. The link expires in one hour.
            </FormHelperText>
          </FormField>

          <Button size="lg" className="w-full">
            Send reset link
          </Button>
        </Stack>
      </form>

      <Stack direction="row" gap="xs" justify="center" align="center">
        <Text size="sm" muted>
          Remembered it?
        </Text>
        <Link href="/login" className="text-sm">
          Back to sign in
        </Link>
      </Stack>
    </Stack>
  );
}
