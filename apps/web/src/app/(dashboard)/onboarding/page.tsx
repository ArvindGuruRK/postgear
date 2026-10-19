import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard';
import { serverApi } from '@/lib/api';
import { getSession, getSessionCookieHeader } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Welcome',
};

interface OnboardingState {
  step: number;
  completedAt: string | null;
  hasWorkspace: boolean;
  organizationId: string | null;
  answers: {
    role: string | null;
    teamSize: string | null;
    primaryGoal: string | null;
    postingFrequency: string | null;
    referralSource: string | null;
    interestedChannels: string[];
  } | null;
}

/**
 * The onboarding wizard's host page.
 *
 * Lives at `(dashboard)/onboarding`, a **sibling** of `[orgId]`, so it passes
 * through route gate 1 (must be signed in) and never reaches gate 2 (must be
 * onboarded), which would otherwise redirect this page to itself forever.
 *
 * State is fetched server-side and handed to the wizard as initial props, so
 * a resumed flow renders on the correct step immediately with no flash of
 * step 1.
 */
export default async function OnboardingPage() {
  const session = await getSession();

  if (!session) {
    redirect('/login');
  }

  const cookie = await getSessionCookieHeader();
  const state = await serverApi<OnboardingState>('/onboarding/state', { cookie });

  // Already finished. Sending them to `/` rather than straight to the calendar
  // keeps the destination decision in one place.
  if (state.completedAt) {
    redirect('/');
  }

  // The wizard draws the whole screen (its own header, safe-area padding and
  // all), after Buffer's onboarding: see docs/screenshots 20 to 23.
  return (
    <OnboardingWizard
      initialStep={state.step}
      initialHasWorkspace={state.hasWorkspace}
      firstName={session.name?.trim().split(/\s+/)[0] || null}
      initialName={session.name}
      initialAvatar={session.avatar}
      initialAnswers={{
        role: state.answers?.role ?? null,
        teamSize: state.answers?.teamSize ?? null,
        primaryGoal: state.answers?.primaryGoal ?? null,
        postingFrequency: state.answers?.postingFrequency ?? null,
        referralSource: state.answers?.referralSource ?? null,
        interestedChannels: state.answers?.interestedChannels ?? [],
      }}
    />
  );
}
