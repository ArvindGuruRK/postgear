import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  FormField,
  FormLabel,
  Input,
  Link,
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
// The form is deliberately inert. Sprint 2 owns credential auth and the OAuth
// handshake; wiring a fake submit here would be worse than leaving it obviously
// unwired. Note there is no submit button by design — a form that posts to its
// own URL would put a typed password in the query string.
export default function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Welcome back. Pick up where your queue left off.</CardDescription>
      </CardHeader>

      <CardContent>
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
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
              />
            </FormField>

            <Button size="lg" className="w-full">
              Sign in
            </Button>
          </Stack>
        </form>

        <Stack direction="row" align="center" gap="sm" className="py-6">
          <Separator className="flex-1" />
          <Text size="xs" muted>
            OR
          </Text>
          <Separator className="flex-1" />
        </Stack>

        <Stack gap="sm">
          <Button variant="secondary" className="w-full">
            Continue with Google
          </Button>
          <Button variant="secondary" className="w-full">
            Continue with GitHub
          </Button>
        </Stack>
      </CardContent>

      <CardFooter>
        <Stack direction="row" gap="xs" justify="center" align="center" className="w-full">
          <Text size="sm" muted>
            New to PostGear?
          </Text>
          <Link href="/register" className="text-sm">
            Create an account
          </Link>
        </Stack>
      </CardFooter>
    </Card>
  );
}
