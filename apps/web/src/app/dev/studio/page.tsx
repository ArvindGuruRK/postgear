import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TemplatePlayground } from './template-playground';

export const metadata: Metadata = { title: 'Template Playground' };

// Internal template playground (Sprint 9, Task 1): every Studio preset in
// every format, for checking by eye. Excluded from production like
// /dev/components, so it never ships as a real route.
export default function TemplatePlaygroundPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return <TemplatePlayground />;
}
