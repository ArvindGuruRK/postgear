import { buttonVariants, cn, Heading, Stack, Text } from '@postgear/ui';
import type { Metadata } from 'next';
import NextLink from 'next/link';
import { roleWithArticle } from '@/components/settings/team-view-model';
import { ApiError, serverApi } from '@/lib/api';
import { getSession, getSessionCookieHeader } from '@/lib/session';
import type { InvitePreview } from '@/types/team';
import { withNext } from '../../login/safe-next';
import { InviteActions } from './invite-actions';

export const metadata: Metadata = {
  title: 'Join A Workspace',
};

/**
 * Where an invitation link lands (Settings > Team, 2026-10-19).
 *
 * In the (auth) group for its shell: the same split screen as sign-in, and
 * like /verify it is open to signed-in visitors too (the group's layout has
 * no "already signed in" redirect, on purpose).
 *
 * The preview is read server-side with the visitor's cookies forwarded, so
 * the first paint already says which workspace invited them and, when they
 * are signed in, whether they are in it. Nothing is accepted on render: a
 * mail scanner that prefetches the link must not use up a single-use
 * invitation, so joining is a click (unlike /verify, where a prefetch
 * confirming the account is the benign direction to fail in).
 *
 * - **Signed out**: "Sign in to join" and "Create an account", both carrying
 *   `?next=` back to this page.
 * - **Signed in**: one button, "Join <workspace>", or a way to switch
 *   accounts when the link was sent to another address.
 * - **Not usable** (invalid, expired, used): the API's message, as written.
 */
export default async function InvitePage({ params }: PageProps<'/invite/[token]'>) {
  const { token } = await params;
  const cookie = await getSessionCookieHeader();
  const [loaded, session] = await Promise.all([loadPreview(token, cookie), getSession()]);
  const here = `/invite/${encodeURIComponent(token)}`;

  if (!loaded.ok) {
    return (
      <Stack gap="lg" data-testid="invite-unusable">
        <Stack gap="xs">
          <Heading level="h2">We can&apos;t open this invitation</Heading>
          <Text muted>{loaded.message}</Text>
        </Stack>
        <NextLink
          href={session ? '/' : '/login'}
          className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }), 'w-full')}
        >
          {session ? 'Go to PostGear' : 'Sign in'}
        </NextLink>
      </Stack>
    );
  }

  const { preview } = loaded;
  const expires = new Date(preview.expiresAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <Stack gap="lg" data-testid="invite">
      <Stack gap="xs">
        <Heading level="h2" className="break-words">
          {preview.alreadyMember
            ? `You're already in ${preview.workspaceName}`
            : `Join ${preview.workspaceName}`}
        </Heading>
        {/* A member is not joining, so what the link offers is beside the point. */}
        {preview.alreadyMember ? null : (
          <Text muted>
            You&apos;ve been invited as {roleWithArticle(preview.role)}. The link works once and
            expires on {expires}.
            {preview.email ? (
              <>
                {' '}
                It was sent to <span className="break-words">{preview.email}</span>.
              </>
            ) : null}
          </Text>
        )}
      </Stack>

      {session ? (
        <InviteActions
          token={token}
          workspaceName={preview.workspaceName}
          signedInAs={session.email}
          invitedEmail={preview.email ?? null}
          alreadyMember={preview.alreadyMember === true}
        />
      ) : (
        <Stack gap="sm">
          <NextLink
            href={withNext('/login', here)}
            className={cn(buttonVariants({ size: 'lg' }), 'w-full')}
          >
            Sign in to join
          </NextLink>
          <NextLink
            href={withNext('/register', here)}
            className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }), 'w-full')}
          >
            Create an account
          </NextLink>
        </Stack>
      )}
    </Stack>
  );
}

type Loaded = { ok: true; preview: InvitePreview } | { ok: false; message: string };

async function loadPreview(token: string, cookie: string): Promise<Loaded> {
  try {
    const preview = await serverApi<InvitePreview>(`/orgs/invites/${encodeURIComponent(token)}`, {
      cookie,
    });
    return { ok: true, preview };
  } catch (cause) {
    // The API's 404 / 410 messages are written for this page ("expired, ask
    // for a new one"); anything else is the API being away.
    return {
      ok: false,
      message:
        cause instanceof ApiError && cause.status >= 400 && cause.status < 500
          ? cause.message
          : "We couldn't reach PostGear just now. Reload the page in a moment.",
    };
  }
}
