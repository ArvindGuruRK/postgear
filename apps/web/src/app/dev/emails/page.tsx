import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EmailPreview } from './email-preview';

export const metadata: Metadata = { title: 'Email Preview' };

// Every email PostGear sends (2026-11-12), rendered with sample data by the
// same templates the API uses, so they can be checked by eye without sending
// anything. Excluded from production like /dev/components, so it never ships
// as a real route.
export default function EmailPreviewPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return <EmailPreview />;
}
