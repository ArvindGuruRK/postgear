import { notFound } from 'next/navigation';
import { ComponentsShowcase } from './components-showcase';

// Internal design-system playground (Sprint 0 DoD) — excluded from
// production so it never ships as a real route.
export default function ComponentsPlaygroundPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return <ComponentsShowcase />;
}
