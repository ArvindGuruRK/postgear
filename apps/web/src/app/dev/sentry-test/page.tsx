import { notFound } from 'next/navigation';
import { SentryTest } from './sentry-test';

// The Sentry wiring check (Sprint 8): excluded from production like the
// design-system playground, so it never ships as a real route.
export default function SentryTestPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return (
    <main className="min-h-screen bg-primary p-6">
      <SentryTest dsnConfigured={Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN?.trim())} />
    </main>
  );
}
