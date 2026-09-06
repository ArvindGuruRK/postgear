import { Button, Heading, Link, Stack, Text } from '@postgear/ui';
import type { Metadata } from 'next';
import { serverApi } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Confirm your account',
};

/**
 * The landing page for an emailed activation link.
 *
 * Activation happens **server-side during render**, not from a click. The
 * token is single-use, and a page that only activates on click would be
 * silently consumed by any email client or security scanner that prefetches
 * links — leaving the real user with a dead link and no explanation.
 *
 * The trade is that a prefetch still activates the account. That is the
 * benign direction to fail in: the account is confirmed, which is what the
 * user wanted, and the page they eventually open says so.
 */
export default async function VerifyPage({ searchParams }: PageProps<'/verify'>) {
  const { token } = await searchParams;
  const activated = typeof token === 'string' ? await activate(token) : false;

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Heading level="h2">{activated ? 'Account confirmed' : 'That link did not work'}</Heading>
        <Text muted>
          {activated
            ? 'Your email address is verified. Sign in to finish setting up your workspace.'
            : 'Confirmation links expire after 24 hours and can only be used once.'}
        </Text>
      </Stack>

      {activated ? (
        <Link href="/login">
          <Button size="lg" className="w-full">
            Sign in
          </Button>
        </Link>
      ) : (
        <Stack gap="sm">
          <Text size="sm" muted>
            Try signing in — if your account is already confirmed, it will just work. Otherwise
            register again to get a fresh link.
          </Text>
          <Stack direction="row" gap="sm">
            <Link href="/login" className="flex-1">
              <Button variant="secondary" className="w-full">
                Sign in
              </Button>
            </Link>
            <Link href="/register" className="flex-1">
              <Button variant="secondary" className="w-full">
                Register
              </Button>
            </Link>
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}

async function activate(token: string): Promise<boolean> {
  try {
    await serverApi(`/auth/activate?token=${encodeURIComponent(token)}`);
    return true;
  } catch {
    // Expired, already used, or never existed — all one outcome, matching the
    // API, which does not distinguish them either.
    return false;
  }
}
