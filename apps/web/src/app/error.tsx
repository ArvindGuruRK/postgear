'use client';

import { Button, Card, CardContent, Container, ErrorState } from '@postgear/ui';
import { TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';

// Route-level error boundary. Must be a client component — React needs to
// attach it as an error boundary, and `reset` re-renders the segment.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Sprint 8 wires real error reporting; until then the console is the
    // only place a digest would otherwise be lost.
    console.error('Unhandled route error:', error);
  }, [error]);

  return (
    <Container size="sm" className="flex min-h-screen items-center py-16">
      <Card className="w-full">
        <CardContent>
          <ErrorState
            icon={TriangleAlert}
            title="Something broke on our end"
            description="The page couldn't finish loading. Trying again often clears it — if it doesn't, the error has been logged."
            className="py-8"
          />
          <div className="flex justify-center gap-3 pb-8">
            <Button onClick={reset}>Try again</Button>
            <Button variant="secondary" onClick={() => window.location.assign('/login')}>
              Back to sign in
            </Button>
          </div>
          {error.digest ? (
            <p className="pb-6 text-center font-sans text-xs text-ink opacity-60">
              Reference: {error.digest}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </Container>
  );
}
