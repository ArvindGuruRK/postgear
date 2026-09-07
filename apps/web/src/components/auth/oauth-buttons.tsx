'use client';

import { Button, Separator, Stack, Text } from '@postgear/ui';
import { oauthStartUrl } from '@/lib/api';

/**
 * The Google and Facebook buttons, shared by sign-in and sign-up.
 *
 * A full page navigation rather than a `fetch`, because the provider's consent
 * screen is a page the user has to actually see, and the callback must return
 * as a top-level request — the API's session cookie is `sameSite: 'lax'`, which
 * accepts a top-level GET and rejects anything cross-site initiated by script.
 *
 * `window.location.href` rather than a `<Link>`: this leaves the Next router
 * entirely, and letting the client router try to handle an external URL is how
 * you get a blank screen.
 */
export function OAuthButtons() {
  return (
    <>
      <Stack direction="row" align="center" gap="sm">
        <Separator className="flex-1" />
        <Text size="xs" muted>
          OR
        </Text>
        <Separator className="flex-1" />
      </Stack>

      <Stack direction="row" gap="sm">
        <Button
          variant="secondary"
          className="flex-1"
          onClick={() => {
            window.location.href = oauthStartUrl('google');
          }}
        >
          Google
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          onClick={() => {
            window.location.href = oauthStartUrl('facebook');
          }}
        >
          Facebook
        </Button>
      </Stack>
    </>
  );
}
