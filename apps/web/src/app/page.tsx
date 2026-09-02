import { redirect } from 'next/navigation';

// Root route. PostGear has no marketing site yet, so `/` sends visitors to the
// sign-in screen rather than 404ing (which is what it did before Sprint 0
// closed — see the workaround comment in playwright.config.ts).
//
// Sprint 2 replaces this with session-aware routing: an authenticated visitor
// should land on their last-used org's calendar instead, and a marketing
// landing page may take over `/` entirely.
export default function RootPage() {
  redirect('/login');
}
