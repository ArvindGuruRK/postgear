import {
  Button,
  FormField,
  FormLabel,
  Heading,
  Input,
  Link,
  PasswordInput,
  Separator,
  Stack,
  Text,
} from '@postgear/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign in',
};

// Sprint 0's Definition-of-Done smoke test: a complete screen assembled purely
// from @postgear/ui, with no one-off styled markup — only layout utilities.
//
// No <Card> here: the two-panel shell in ../layout.tsx is this form's surface,
// and nesting a bordered card inside a bordered panel frames the same content
// twice. See that file.
//
// The form is deliberately inert. Sprint 2 owns credential auth and the OAuth
// handshake; wiring a fake submit here would be worse than leaving it obviously
// unwired. Note there is no submit button by design — a form that posts to its
// own URL would put a typed password in the query string.
export default function LoginPage() {
  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Heading level="h2">Sign in</Heading>
        <Text muted>Welcome back. Pick up where your queue left off.</Text>
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
            />
          </FormField>

          <Button size="lg" className="w-full">
            Sign in
          </Button>
        </Stack>
      </form>

      <Stack direction="row" align="center" gap="sm">
        <Separator className="flex-1" />
        <Text size="xs" muted>
          OR
        </Text>
        <Separator className="flex-1" />
      </Stack>

      {/* Side by side rather than stacked: the panel is a fixed-width column,
          and two full-width secondary buttons under a full-width primary one
          read as three equal choices instead of one plus two alternates. */}
      <Stack direction="row" gap="sm">
        <Button variant="secondary" className="flex-1">
          Google
        </Button>
        <Button variant="secondary" className="flex-1">
          GitHub
        </Button>
      </Stack>

      <Stack direction="row" gap="xs" justify="center" align="center">
        <Text size="sm" muted>
          New to PostGear?
        </Text>
        <Link href="/register" className="text-sm">
          Create an account
        </Link>
      </Stack>
    </Stack>
  );
}
