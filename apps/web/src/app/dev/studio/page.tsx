import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { parsePlaygroundView } from './playground-model';
import { TemplatePlayground } from './template-playground';

export const metadata: Metadata = { title: 'Template Playground' };

// Internal template playground (Sprint 9, Task 1): every Studio preset in
// every format, for checking by eye. Excluded from production like
// /dev/components, so it never ships as a real route.
//
// The filters, the page and its size are read from the URL here (Sprint 9b),
// so a reload or a shared link opens on the same page, already rendered on
// the server; the island keeps the URL in step from then on.
export default async function TemplatePlaygroundPage({ searchParams }: PageProps<'/dev/studio'>) {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return <TemplatePlayground initialView={parsePlaygroundView(await searchParams)} />;
}
