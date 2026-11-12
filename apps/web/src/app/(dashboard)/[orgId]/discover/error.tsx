'use client';

/**
 * Discover's own error boundary (Module 10). A failure inside the page stays
 * inside the page: the rail and the top bar keep working, and Try Again
 * renders the segment again (Next 16's `retry`, which re-fetches the server
 * page as well) instead of reloading the whole app.
 *
 * A source that fails is never this: the page shows the last copy with a
 * note, or a sentence for that tab. This is only for the page itself
 * breaking, which should not happen, so the reference is shown for support.
 */
import { Button, ErrorState } from '@postgear/ui';
import { Compass } from 'lucide-react';
import { useEffect } from 'react';

const DISCOVER_BROKE_TITLE = 'Discover could not load';
const DISCOVER_BROKE_HINT =
  'Something went wrong while drawing this page. Trying again usually clears it.';

export default function DiscoverError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error('Discover page error:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-4 py-12">
      <ErrorState icon={Compass} title={DISCOVER_BROKE_TITLE} description={DISCOVER_BROKE_HINT} />
      <Button variant="secondary" onClick={() => retry()}>
        Try Again
      </Button>
      {error.digest ? (
        <p className="m-0 font-sans text-xs text-ink type-muted">Reference: {error.digest}</p>
      ) : null}
    </div>
  );
}
