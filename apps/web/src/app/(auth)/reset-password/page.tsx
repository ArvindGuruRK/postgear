import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  FormField,
  FormHelperText,
  FormLabel,
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
// is also where the "check your email" confirmation state belongs.
export default function ResetPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>
          We&apos;ll email you a link to choose a new one.
        </CardDescription>
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
              <FormHelperText>
                Use the address you signed up with. The link expires in one hour.
              </FormHelperText>
            </FormField>

            <Button size="lg" className="w-full">
              Send reset link
            </Button>
          </Stack>
        </form>
      </CardContent>

      <CardFooter>
        <Stack direction="row" gap="xs" justify="center" align="center" className="w-full">
          <Text size="sm" muted>
            Remembered it?
          </Text>
          <Link href="/login" className="text-sm">
            Back to sign in
          </Link>
        </Stack>
      </CardFooter>
    </Card>
  );
}
