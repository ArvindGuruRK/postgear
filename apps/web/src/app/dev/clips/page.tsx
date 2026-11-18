import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ClipsTestBench } from './clips-test-bench';

export const metadata: Metadata = { title: 'Clips Test Bench' };

// Internal test bench (Sprint 12, Module 05 section 5): Import Sample, Make A
// 20 Second Clip, Export, then the light copy and the exported file side by
// side. Excluded from production like /dev/components, so it never ships as
// a real route. It calls the real API as the signed-in person, in the
// workspace they last opened; the links only answer under CLIPS_SIMULATION.
export default function ClipsTestBenchPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return <ClipsTestBench />;
}
