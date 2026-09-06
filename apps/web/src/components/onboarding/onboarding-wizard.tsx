'use client';

import {
  Button,
  FormErrorMessage,
  FormField,
  FormHelperText,
  FormLabel,
  Heading,
  Input,
  OnboardingStepper,
  Stack,
  Text,
} from '@postgear/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import {
  ABOUT_YOU_QUESTIONS,
  CHANNEL_OPTIONS,
  GOALS_QUESTIONS,
  ONBOARDING_STEPS,
  REFERRAL_QUESTION,
} from '@/lib/onboarding-questions';
import { ChoiceGroup, MultiChoiceGroup } from './choice-group';

/**
 * The five-step onboarding wizard.
 *
 * ## Every step writes before it advances
 *
 * There is no "collect everything, submit at the end". Each step posts its own
 * answers and the server bumps `User.onboardingStep`, so closing the tab at
 * step 3 loses nothing — signing back in resumes exactly there. That is what
 * the sprint's "a user who abandons onboarding midway can sign back in without
 * hitting an error page" requirement actually asks for, and it is not
 * achievable with client-only state.
 *
 * The step shown is local state seeded from the server's `initialStep`.
 * Navigating back is a display-only operation: the server's stored step only
 * ever moves forward, so re-reading an earlier answer cannot lose progress.
 */

interface Answers {
  role: string | null;
  teamSize: string | null;
  primaryGoal: string | null;
  postingFrequency: string | null;
  referralSource: string | null;
  interestedChannels: string[];
}

export function OnboardingWizard({
  initialStep,
  initialAnswers,
  initialWorkspaceName,
}: {
  initialStep: number;
  initialAnswers: Answers;
  initialWorkspaceName: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState(initialStep);
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [workspaceName, setWorkspaceName] = useState(initialWorkspaceName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function set<K extends keyof Answers>(key: K, value: Answers[K]) {
    setAnswers((current) => ({ ...current, [key]: value }));
  }

  /**
   * Wraps every step's submit with the same pending/error handling.
   *
   * `advance` is passed rather than inferred so a step that the server moves
   * differently (step 4 always lands on 5, however many channels were picked)
   * stays in step with the persisted value.
   */
  async function submit(action: () => Promise<void>, advance: number) {
    setError(null);
    setPending(true);

    try {
      await action();
      setStep(advance);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setPending(false);
    }
  }

  async function finish() {
    setError(null);
    setPending(true);

    try {
      // Save Q5 first, then mark complete — two calls rather than one so the
      // answer is durable even if the completion call fails.
      if (answers.referralSource) {
        await api('/onboarding/answers', {
          method: 'POST',
          body: { referralSource: answers.referralSource },
        });
      }

      const { organizationId } = await api<{ organizationId: string }>('/onboarding/complete', {
        method: 'POST',
      });

      // `refresh()` before navigating so the layouts re-read the session and
      // see `onboardingCompletedAt` set — without it, route gate 2 still holds
      // the stale value and bounces the user straight back to /onboarding.
      router.refresh();
      router.replace(`/${organizationId}/calendar`);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Something went wrong. Please try again.',
      );
      setPending(false);
    }
  }

  return (
    <Stack gap="lg">
      {/* Presentational only — it does not navigate. currentStep is 1-based. */}
      <OnboardingStepper steps={ONBOARDING_STEPS} currentStep={step} />

      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}

      {step === 1 ? (
        <Stack gap="md">
          <Stack gap="xs">
            <Heading level="h3">Name your workspace</Heading>
            <Text muted>
              This is where your channels, posts and team live. You can rename it later.
            </Text>
          </Stack>

          <FormField>
            <FormLabel htmlFor="workspace" required>
              Workspace name
            </FormLabel>
            <Input
              id="workspace"
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              placeholder="Acme Media"
              autoComplete="organization"
            />
            <FormHelperText>Usually your company, brand or client name.</FormHelperText>
          </FormField>

          <Button
            size="lg"
            disabled={pending || workspaceName.trim().length === 0}
            onClick={() =>
              submit(async () => {
                await api('/onboarding/workspace', {
                  method: 'POST',
                  body: { name: workspaceName.trim() },
                });
              }, 2)
            }
          >
            {pending ? 'Creating…' : 'Create workspace'}
          </Button>
        </Stack>
      ) : null}

      {step === 2 ? (
        <Stack gap="lg">
          <Stack gap="xs">
            <Heading level="h3">About you</Heading>
            <Text muted>Two quick questions so we can set sensible defaults.</Text>
          </Stack>

          <ChoiceGroup
            question={ABOUT_YOU_QUESTIONS[0]}
            value={answers.role}
            onChange={(value) => set('role', value)}
          />
          <ChoiceGroup
            question={ABOUT_YOU_QUESTIONS[1]}
            value={answers.teamSize}
            onChange={(value) => set('teamSize', value)}
          />

          <StepActions
            pending={pending}
            canContinue={Boolean(answers.role && answers.teamSize)}
            onContinue={() =>
              submit(async () => {
                await api('/onboarding/answers', {
                  method: 'POST',
                  body: { role: answers.role, teamSize: answers.teamSize },
                });
              }, 3)
            }
          />
        </Stack>
      ) : null}

      {step === 3 ? (
        <Stack gap="lg">
          <Stack gap="xs">
            <Heading level="h3">What are you here to do?</Heading>
            <Text muted>This shapes what we show you first.</Text>
          </Stack>

          <ChoiceGroup
            question={GOALS_QUESTIONS[0]}
            value={answers.primaryGoal}
            onChange={(value) => set('primaryGoal', value)}
          />
          <ChoiceGroup
            question={GOALS_QUESTIONS[1]}
            value={answers.postingFrequency}
            onChange={(value) => set('postingFrequency', value)}
          />

          <StepActions
            pending={pending}
            canContinue={Boolean(answers.primaryGoal && answers.postingFrequency)}
            onBack={() => setStep(2)}
            onContinue={() =>
              submit(async () => {
                await api('/onboarding/answers', {
                  method: 'POST',
                  body: {
                    primaryGoal: answers.primaryGoal,
                    postingFrequency: answers.postingFrequency,
                  },
                });
              }, 4)
            }
          />
        </Stack>
      ) : null}

      {step === 4 ? (
        <Stack gap="lg">
          <Stack gap="xs">
            <Heading level="h3">Where do you post?</Heading>
            <Text muted>
              Tell us which channels matter to you. Connecting them comes next — and it is not
              required to start.
            </Text>
          </Stack>

          <MultiChoiceGroup
            prompt="Which platforms do you plan to use?"
            options={CHANNEL_OPTIONS}
            values={answers.interestedChannels}
            onToggle={(value) =>
              set(
                'interestedChannels',
                answers.interestedChannels.includes(value)
                  ? answers.interestedChannels.filter((entry) => entry !== value)
                  : [...answers.interestedChannels, value],
              )
            }
          />

          {/* Connecting a channel is Sprint 3's work. The affordance is shown
              disabled rather than hidden so the flow reads as complete, and
              "Continue" is always live beside it — the sprint requires that a
              user who cannot finish an OAuth handshake still reaches the app. */}
          <Stack gap="sm">
            <Button variant="secondary" disabled>
              Connect a channel — coming in Sprint 3
            </Button>
            <Text size="sm" muted>
              You can connect accounts any time from the Channels page.
            </Text>
          </Stack>

          <StepActions
            pending={pending}
            canContinue
            continueLabel={answers.interestedChannels.length === 0 ? 'Skip for now' : 'Continue'}
            onBack={() => setStep(3)}
            onContinue={() =>
              submit(async () => {
                await api('/onboarding/channels', {
                  method: 'POST',
                  body: { interestedChannels: answers.interestedChannels },
                });
              }, 5)
            }
          />
        </Stack>
      ) : null}

      {step === 5 ? (
        <Stack gap="lg">
          <Stack gap="xs">
            <Heading level="h3">One last thing</Heading>
            <Text muted>Then you are in.</Text>
          </Stack>

          <ChoiceGroup
            question={REFERRAL_QUESTION}
            value={answers.referralSource}
            onChange={(value) => set('referralSource', value)}
          />

          <StepActions
            pending={pending}
            canContinue={Boolean(answers.referralSource)}
            continueLabel="Finish setup"
            onBack={() => setStep(4)}
            onContinue={finish}
          />
        </Stack>
      ) : null}
    </Stack>
  );
}

function StepActions({
  pending,
  canContinue,
  continueLabel = 'Continue',
  onBack,
  onContinue,
}: {
  pending: boolean;
  canContinue: boolean;
  continueLabel?: string;
  onBack?: () => void;
  onContinue: () => void;
}) {
  return (
    <Stack direction="row" gap="sm" justify="between" align="center">
      {onBack ? (
        <Button variant="secondary" onClick={onBack} disabled={pending}>
          Back
        </Button>
      ) : (
        <span />
      )}

      <Button size="lg" onClick={onContinue} disabled={pending || !canContinue}>
        {pending ? 'Saving…' : continueLabel}
      </Button>
    </Stack>
  );
}
