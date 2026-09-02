import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  FormField,
  FormHelperText,
  FormLabel,
  Input,
  Link,
  Separator,
  Stack,
  Text,
} from '@postgear/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Create account',
};

// Inert like the sign-in form — Sprint 2 owns account creation. See the note in
// login/page.tsx for why there is no submit button.
export default function RegisterPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>
          Start scheduling across every channel in a few minutes.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form>
          <Stack gap="md">
            <FormField>
              <FormLabel htmlFor="name" required>
                Full name
              </FormLabel>
              <Input id="name" name="name" autoComplete="name" placeholder="Ada Lovelace" />
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
              />
            </FormField>

            <FormField>
              <FormLabel htmlFor="password" required>
                Password
              </FormLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
              />
              <FormHelperText>At least 12 characters, including a number.</FormHelperText>
            </FormField>

            {/* No organization/workspace field here by design — creating the
                workspace belongs to the post-signup onboarding flow, not to
                the signup form. See sprint-01's "Onboarding flow" note and
                sprint-02, which builds it. */}

            {/* No margin nudge on the Checkbox: it is h-5 (20px) and Text
                size="sm" has a 20px line-height, so align="start" lines the
                two up exactly. The mt-0.5 that used to be here pushed the box
                2px down and left the label visibly riding high. align="start"
                rather than "center" so the box stays on the first line if the
                text ever wraps. */}
            <Stack direction="row" gap="sm" align="start">
              <Checkbox id="terms" />
              <Text size="sm" muted>
                I agree to the terms of service and privacy policy.
              </Text>
            </Stack>

            <Button size="lg" className="w-full">
              Create account
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
            Sign up with Google
          </Button>
          <Button variant="secondary" className="w-full">
            Sign up with GitHub
          </Button>
        </Stack>
      </CardContent>

      <CardFooter>
        <Stack direction="row" gap="xs" justify="center" align="center" className="w-full">
          <Text size="sm" muted>
            Already have an account?
          </Text>
          <Link href="/login" className="text-sm">
            Sign in
          </Link>
        </Stack>
      </CardFooter>
    </Card>
  );
}
