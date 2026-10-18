'use client';

/**
 * Two buttons, two deliberate errors: one thrown in the browser during an
 * event handler, one thrown inside a server function. With a DSN set both
 * appear in Sentry within a minute; without one the page says so, and the
 * browser error is still visible in the console, which is how the wiring
 * is checked locally.
 */
import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent, Stack, Text } from '@postgear/ui';
import { useState, useTransition } from 'react';
import { throwOnServer } from './actions';

export function SentryTest({ dsnConfigured }: { dsnConfigured: boolean }) {
  const [serverOutcome, setServerOutcome] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function throwInBrowser() {
    throw new Error(`Sentry test error from apps/web (browser, ${new Date().toISOString()})`);
  }

  function throwViaServer() {
    startTransition(async () => {
      try {
        await throwOnServer();
        setServerOutcome('The server did not throw, and that is the bug.');
      } catch (error) {
        setServerOutcome(
          `The server threw as intended${error instanceof Error && error.message ? `: ${error.message}` : ''}.`,
        );
      }
    });
  }

  return (
    <Stack gap="lg" className="mx-auto max-w-2xl">
      <h1 className="type-heading text-4xl text-ink">Sentry test</h1>
      <Alert variant={dsnConfigured ? 'success' : 'warning'} data-testid="sentry-dsn-state">
        <AlertTitle>{dsnConfigured ? 'A DSN is configured' : 'No DSN configured'}</AlertTitle>
        <AlertDescription>
          {dsnConfigured
            ? 'Both errors below are sent to Sentry. Allow a minute for them to appear.'
            : 'Set NEXT_PUBLIC_SENTRY_DSN (and SENTRY_DSN for the API) and restart to send these errors to Sentry. Without one, the browser error still shows in the console.'}
        </AlertDescription>
      </Alert>
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <Button variant="danger" onClick={throwInBrowser} data-testid="sentry-throw-browser">
            Throw in the browser
          </Button>
          <Button variant="danger" onClick={throwViaServer} disabled={pending} data-testid="sentry-throw-server">
            {pending ? 'Calling the server…' : 'Throw on the server'}
          </Button>
          {serverOutcome ? (
            <Text size="sm" data-testid="sentry-server-outcome">
              {serverOutcome}
            </Text>
          ) : null}
          <Text size="sm" muted>
            The API's own test is <code className="font-mono text-xs">GET /health/sentry-test</code>,
            as a superadmin.
          </Text>
        </CardContent>
      </Card>
    </Stack>
  );
}
