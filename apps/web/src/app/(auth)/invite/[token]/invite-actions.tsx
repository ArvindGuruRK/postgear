'use client';

/**
 * The signed-in half of the invitation page: join, or switch accounts.
 *
 * Joining calls `POST /orgs/invites/accept`, which also makes the workspace
 * the active one, then opens its Home page. Someone who has not finished
 * onboarding is sent on to it by the dashboard's own gate, already past
 * "Name your workspace" (the API moved them on when they joined).
 *
 * When the link names another address the API would refuse with 403, so the
 * page says so before anyone clicks and offers the one useful thing: sign
 * out and back in as the right person, landing here again. Someone already
 * in the workspace just gets "Open", whoever the link was for.
 */
import { Button, FormErrorMessage, Stack, Text } from '@postgear/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { withNext } from '../../login/safe-next';

interface InviteActionsProps {
  token: string;
  workspaceName: string;
  signedInAs: string;
  invitedEmail: string | null;
  alreadyMember: boolean;
}

export function InviteActions({
  token,
  workspaceName,
  signedInAs,
  invitedEmail,
  alreadyMember,
}: InviteActionsProps) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A member is let through whatever address the link names (the API checks
  // membership first), so only someone joining can be on the wrong account.
  const wrongAccount =
    !alreadyMember &&
    invitedEmail !== null &&
    invitedEmail.toLowerCase() !== signedInAs.trim().toLowerCase();

  async function join() {
    if (working) {
      return;
    }

    setWorking(true);
    setError(null);

    try {
      const { organization } = await api<{ organization: { id: string } }>('/orgs/invites/accept', {
        method: 'POST',
        body: { token },
      });
      router.replace(`/${organization.id}/home`);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'Something went wrong. Please try again.',
      );
      setWorking(false);
    }
  }

  async function switchAccount() {
    setWorking(true);

    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      // As in the account menu: navigate even if the request failed, and
      // refresh so the server re-reads the (now absent) session.
      router.replace(withNext('/login', `/invite/${encodeURIComponent(token)}`));
      router.refresh();
    }
  }

  if (wrongAccount) {
    return (
      <Stack gap="md">
        {/* The address it was sent to is in the paragraph above. */}
        <Text>
          You&apos;re signed in as <span className="break-words">{signedInAs}</span>, not as the
          address this invitation was sent to.
        </Text>
        <Button size="lg" className="w-full" onClick={switchAccount} disabled={working}>
          {working ? 'Signing out…' : 'Sign in with another account'}
        </Button>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      <Button
        size="lg"
        className="w-full"
        onClick={join}
        disabled={working}
        data-testid="invite-join"
      >
        <span className="min-w-0 truncate">
          {working ? 'Joining…' : alreadyMember ? `Open ${workspaceName}` : `Join ${workspaceName}`}
        </span>
      </Button>
      <Text size="sm" muted className="text-center">
        Signed in as <span className="break-words">{signedInAs}</span>
      </Text>
    </Stack>
  );
}
