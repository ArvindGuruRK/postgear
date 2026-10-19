'use client';

import { AtSignIcon } from '@animateicons/react/lucide/at-sign-icon';
import { BriefcaseIcon } from '@animateicons/react/lucide/briefcase-icon';
import { Building2Icon } from '@animateicons/react/lucide/building-2-icon';
import { ChartLineIcon } from '@animateicons/react/lucide/chart-line-icon';
import { ClockIcon } from '@animateicons/react/lucide/clock-icon';
import { EllipsisIcon } from '@animateicons/react/lucide/ellipsis-icon';
import { HandshakeIcon } from '@animateicons/react/lucide/handshake-icon';
import { HeartIcon } from '@animateicons/react/lucide/heart-icon';
import { MailIcon } from '@animateicons/react/lucide/mail-icon';
import { RocketIcon } from '@animateicons/react/lucide/rocket-icon';
import { SearchIcon } from '@animateicons/react/lucide/search-icon';
import { ShoppingCartIcon } from '@animateicons/react/lucide/shopping-cart-icon';
import { SparklesIcon } from '@animateicons/react/lucide/sparkles-icon';
import { StoreIcon } from '@animateicons/react/lucide/store-icon';
import { TrendingUpIcon } from '@animateicons/react/lucide/trending-up-icon';
import { UserRoundIcon } from '@animateicons/react/lucide/user-round-icon';
import { UsersIcon } from '@animateicons/react/lucide/users-icon';
import { UsersRoundIcon } from '@animateicons/react/lucide/users-round-icon';
import { type AnimatedIcon, FormHelperText, Input } from '@postgear/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { PlatformIcon } from '@/components/platforms/platform-icon';
import { AvatarPicker } from '@/components/profile/avatar-picker';
import { ApiError, api } from '@/lib/api';
import {
  CHANNEL_OPTIONS,
  CHANNELS_PROMPT,
  FREQUENCY_QUESTION,
  GOAL_QUESTION,
  type Question,
  REFERRAL_QUESTION,
  ROLE_QUESTION,
  TEAM_SIZE_QUESTION,
} from '@/lib/onboarding-questions';
import type { SessionAvatar } from '@/lib/session';
import { ChoiceGroup, type ChoiceOption, MultiChoiceGroup } from './choice-group';
import { OnboardingHeader, QuestionScreen } from './onboarding-chrome';
import { WelcomeScreen } from './welcome-screen';

/**
 * The onboarding wizard, laid out after Buffer's (docs/screenshots 20 to 23,
 * 2026-10-19): a welcome screen with one "Let's start" button, then one
 * question per screen, each a heading over a grid of answer cards with a wide
 * Continue and a quiet Skip under it.
 *
 * ## Screens and the server's steps
 *
 * The server counts six steps (`User.onboardingStep`, see the table in
 * `apps/api/src/modules/onboarding/onboarding.service.ts`); the wizard shows
 * nine screens. Steps 2 and 3 each hold two questions, which here are two
 * screens:
 *
 * | Screen | Step | Continue | Skip |
 * |---|---|---|---|
 * | welcome | 1 | "Let's start" | (none) |
 * | workspace | 1 | creates it, to 2 | (required) |
 * | role | 2 | saves it, stays on 2 | moves on, no call |
 * | teamSize | 2 | saves it, to 3 | `skip { step: 2 }`, to 3 |
 * | goal | 3 | saves it, stays on 3 | moves on, no call |
 * | frequency | 3 | saves it, to 4 | `skip { step: 3 }`, to 4 |
 * | channels | 4 | saves them, to 5 | `skip { step: 4 }`, to 5 |
 * | referral | 5 | saves it, to 6 | `skip { step: 5 }`, to 6 |
 * | profile | 6 | finishes onboarding | (required) |
 *
 * ## Every screen writes before it advances
 *
 * There is no "collect everything, submit at the end". Each answer is posted
 * as it is given and the server moves its step forward, so closing the tab
 * loses nothing: signing back in resumes on the first unanswered screen
 * (`resumeScreen`). Going back is display only: the server's step only ever
 * moves forward, so re-reading an earlier answer cannot lose progress.
 */

interface Answers {
  role: string | null;
  teamSize: string | null;
  primaryGoal: string | null;
  postingFrequency: string | null;
  referralSource: string | null;
  interestedChannels: string[];
}

type Screen =
  | 'welcome'
  | 'workspace'
  | 'role'
  | 'teamSize'
  | 'goal'
  | 'frequency'
  | 'channels'
  | 'referral'
  | 'profile';

/** The screens after the welcome, in order: one progress dot each. */
const SCREENS: Exclude<Screen, 'welcome'>[] = [
  'workspace',
  'role',
  'teamSize',
  'goal',
  'frequency',
  'channels',
  'referral',
  'profile',
];

interface Look {
  icon: AnimatedIcon;
  fill: string;
}

/** The single-answer screens: their question, icons, and what Skip posts. */
const QUESTION_SCREENS: Record<
  'role' | 'teamSize' | 'goal' | 'frequency' | 'referral',
  {
    question: Question;
    look?: Record<string, Look>;
    /** The step Skip moves past; `null` for the first question of a pair. */
    skipStep: number | null;
  }
> = {
  role: {
    question: ROLE_QUESTION,
    look: {
      SOLO_CREATOR: { icon: UserRoundIcon, fill: 'bg-avatar1 text-onAvatar1' },
      SMALL_BUSINESS: { icon: StoreIcon, fill: 'bg-avatar4 text-onAvatar4' },
      IN_HOUSE_TEAM: { icon: UsersRoundIcon, fill: 'bg-avatar3 text-onAvatar3' },
      FREELANCER: { icon: BriefcaseIcon, fill: 'bg-avatar7 text-onAvatar7' },
      AGENCY: { icon: Building2Icon, fill: 'bg-avatar2 text-onAvatar2' },
      NONPROFIT: { icon: HeartIcon, fill: 'bg-avatar6 text-onAvatar6' },
      FOUNDER: { icon: RocketIcon, fill: 'bg-avatar5 text-onAvatar5' },
      OTHER: { icon: EllipsisIcon, fill: 'bg-avatar1 text-onAvatar1' },
    },
    skipStep: null,
  },
  // Plain cards, like the reference's "how many accounts" screen: the answers
  // are short and read best as text alone.
  teamSize: { question: TEAM_SIZE_QUESTION, skipStep: 2 },
  goal: {
    question: GOAL_QUESTION,
    look: {
      GROW_AUDIENCE: { icon: TrendingUpIcon, fill: 'bg-avatar3 text-onAvatar3' },
      SAVE_TIME: { icon: ClockIcon, fill: 'bg-avatar2 text-onAvatar2' },
      BETTER_CONTENT: { icon: SparklesIcon, fill: 'bg-avatar6 text-onAvatar6' },
      TRACK_PERFORMANCE: { icon: ChartLineIcon, fill: 'bg-avatar4 text-onAvatar4' },
      TEAM_COLLAB: { icon: HandshakeIcon, fill: 'bg-avatar1 text-onAvatar1' },
      DRIVE_SALES: { icon: ShoppingCartIcon, fill: 'bg-avatar7 text-onAvatar7' },
    },
    skipStep: null,
  },
  frequency: { question: FREQUENCY_QUESTION, skipStep: 3 },
  referral: {
    question: REFERRAL_QUESTION,
    look: {
      SEARCH: { icon: SearchIcon, fill: 'bg-avatar2 text-onAvatar2' },
      SOCIAL: { icon: AtSignIcon, fill: 'bg-avatar6 text-onAvatar6' },
      FRIEND: { icon: UsersIcon, fill: 'bg-avatar3 text-onAvatar3' },
      NEWSLETTER: { icon: MailIcon, fill: 'bg-avatar4 text-onAvatar4' },
      OTHER: { icon: EllipsisIcon, fill: 'bg-avatar5 text-onAvatar5' },
    },
    skipStep: 5,
  },
};

const CHANNEL_CHOICES: ChoiceOption[] = CHANNEL_OPTIONS.map((option) => ({
  ...option,
  media: <PlatformIcon platform={option.value} className="h-9 w-9" />,
}));

/**
 * Where a returning user picks up: the first screen of their stored step,
 * or, inside a two-question step, the second screen once the first is saved.
 * A brand-new account (step 1) starts on the welcome.
 */
function resumeScreen(step: number, answers: Answers): Screen {
  switch (step) {
    case 1:
      return 'welcome';
    case 2:
      return answers.role ? 'teamSize' : 'role';
    case 3:
      return answers.primaryGoal ? 'frequency' : 'goal';
    case 4:
      return 'channels';
    case 5:
      return 'referral';
    default:
      return 'profile';
  }
}

/** Mirrors the API's `PROFILE_NAME_MAX`. */
const PROFILE_NAME_MAX = 50;

const TITLE_ID = 'onboarding-question';

export function OnboardingWizard({
  initialStep,
  initialAnswers,
  initialHasWorkspace,
  firstName,
  initialName,
  initialAvatar,
}: {
  initialStep: number;
  initialAnswers: Answers;
  /** An invited user arrives with a workspace already, and never names one. */
  initialHasWorkspace: boolean;
  /** For the welcome's "Hey there, <name>". */
  firstName: string | null;
  /** `User.name`, from signup or the OAuth profile, to pre-fill the profile screen. */
  initialName: string | null;
  /** A Google/Facebook signup arrives with its provider photo already set. */
  initialAvatar: SessionAvatar;
}) {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>(() => resumeScreen(initialStep, initialAnswers));
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [hasWorkspace, setHasWorkspace] = useState(initialHasWorkspace);
  const [workspaceName, setWorkspaceName] = useState('');
  const [name, setName] = useState(initialName ?? '');
  const [avatar, setAvatar] = useState<SessionAvatar>(initialAvatar);
  const [avatarPending, setAvatarPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const titleRef = useRef<HTMLHeadingElement>(null);
  const shownScreen = useRef(screen);

  const trimmedName = name.trim();
  const nameValid = trimmedName.length >= 1 && trimmedName.length <= PROFILE_NAME_MAX;

  // A new screen starts at the top with focus on its question, so a screen
  // reader reads the new heading instead of sitting on a button that is gone.
  // Not on the first render: the page has only just loaded.
  useEffect(() => {
    if (shownScreen.current === screen) return;
    shownScreen.current = screen;
    window.scrollTo({ top: 0 });
    titleRef.current?.focus();
  }, [screen]);

  function go(next: Screen) {
    setError(null);
    setScreen(next);
  }

  function nextOf(current: Exclude<Screen, 'welcome'>): Screen {
    return SCREENS[SCREENS.indexOf(current) + 1] ?? 'profile';
  }

  function previousOf(current: Exclude<Screen, 'welcome'>): Screen {
    // The workspace cannot be named twice, so once it exists the first
    // question leads back to the welcome rather than to its form.
    if (current === 'workspace' || (current === 'role' && hasWorkspace)) {
      return 'welcome';
    }
    return SCREENS[SCREENS.indexOf(current) - 1] ?? 'welcome';
  }

  /** Wraps every screen's call with the same pending and error handling. */
  async function run(action: () => Promise<unknown>, next: Screen) {
    setError(null);
    setPending(true);

    try {
      await action();
      go(next);
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
      // Saves the name and marks onboarding complete in one call. The avatar
      // is already saved: the picker writes it the moment it is chosen.
      const { organizationId } = await api<{ organizationId: string }>('/onboarding/profile', {
        method: 'POST',
        body: { name: trimmedName },
      });

      // `refresh()` before navigating so the layouts re-read the session and
      // see `onboardingCompletedAt` set: without it, route gate 2 still holds
      // the stale value and bounces the user straight back to /onboarding.
      router.refresh();
      router.replace(`/${organizationId}/home`);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Something went wrong. Please try again.',
      );
      setPending(false);
    }
  }

  if (screen === 'welcome') {
    return (
      <WelcomeScreen
        firstName={firstName}
        titleRef={titleRef}
        onStart={() => go(hasWorkspace ? 'role' : 'workspace')}
      />
    );
  }

  const current = screen;
  const shared = { titleId: TITLE_ID, titleRef, error, pending };

  let singleQuestion: ReactNode = null;

  if (
    current === 'role' ||
    current === 'teamSize' ||
    current === 'goal' ||
    current === 'frequency' ||
    current === 'referral'
  ) {
    const { question, look, skipStep } = QUESTION_SCREENS[current];
    const field = question.field;
    const next = nextOf(current);

    singleQuestion = (
      <QuestionScreen
        {...shared}
        key={current}
        title={question.prompt}
        canContinue={Boolean(answers[field])}
        onContinue={() =>
          run(
            () => api('/onboarding/answers', { method: 'POST', body: { [field]: answers[field] } }),
            next,
          )
        }
        onSkip={() =>
          skipStep === null
            ? go(next)
            : run(() => api('/onboarding/skip', { method: 'POST', body: { step: skipStep } }), next)
        }
      >
        <ChoiceGroup
          name={field}
          labelledBy={TITLE_ID}
          value={answers[field]}
          onChange={(value) => setAnswers((all) => ({ ...all, [field]: value }))}
          options={question.options.map((option) => ({ ...option, ...look?.[option.value] }))}
        />
      </QuestionScreen>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <OnboardingHeader
        onBack={() => go(previousOf(current))}
        backDisabled={pending}
        progress={{ current: SCREENS.indexOf(current) + 1, total: SCREENS.length }}
      />

      {current === 'workspace' ? (
        <QuestionScreen
          {...shared}
          key="workspace"
          width="form"
          title="Name your workspace"
          canContinue={workspaceName.trim().length > 0}
          onContinue={() =>
            run(async () => {
              await api('/onboarding/workspace', {
                method: 'POST',
                body: { name: workspaceName.trim() },
              });
              setHasWorkspace(true);
            }, 'role')
          }
        >
          <Input
            id="workspace"
            size="lg"
            aria-label="Workspace name"
            value={workspaceName}
            onChange={(event) => setWorkspaceName(event.target.value)}
            placeholder="Enter your workspace name"
            autoComplete="organization"
          />
        </QuestionScreen>
      ) : null}

      {singleQuestion}

      {current === 'channels' ? (
        <QuestionScreen
          {...shared}
          key="channels"
          title={CHANNELS_PROMPT}
          canContinue={answers.interestedChannels.length > 0}
          onContinue={() =>
            run(
              () =>
                api('/onboarding/channels', {
                  method: 'POST',
                  body: { interestedChannels: answers.interestedChannels },
                }),
              'referral',
            )
          }
          onSkip={() =>
            run(() => api('/onboarding/skip', { method: 'POST', body: { step: 4 } }), 'referral')
          }
        >
          <MultiChoiceGroup
            name="channel"
            labelledBy={TITLE_ID}
            options={CHANNEL_CHOICES}
            values={answers.interestedChannels}
            onToggle={(value) =>
              setAnswers((all) => ({
                ...all,
                interestedChannels: all.interestedChannels.includes(value)
                  ? all.interestedChannels.filter((entry) => entry !== value)
                  : [...all.interestedChannels, value],
              }))
            }
          />
        </QuestionScreen>
      ) : null}

      {/* Where every path ends: the name to be called by, and an avatar. */}
      {current === 'profile' ? (
        <QuestionScreen
          {...shared}
          key="profile"
          // Room for nine avatars to a row at full size.
          width="wide"
          title="What should we call you?"
          canContinue={nameValid && !avatarPending}
          continueLabel="Finish setup"
          onContinue={finish}
        >
          <div className="flex w-full flex-col gap-8">
            {/* A name field at form width, centred over the wide grid. */}
            <div className="mx-auto flex w-full max-w-md flex-col gap-2">
              <Input
                id="profile-name"
                size="lg"
                aria-label="Your name"
                aria-describedby="profile-name-help"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Enter your name"
                autoComplete="name"
                maxLength={PROFILE_NAME_MAX}
              />
              <FormHelperText id="profile-name-help" className="text-center">
                How PostGear and its AI will address you. A first name is fine.
              </FormHelperText>
            </div>

            <AvatarPicker
              centered
              name={trimmedName || 'You'}
              value={avatar}
              onChange={setAvatar}
              onPendingChange={setAvatarPending}
            />
          </div>
        </QuestionScreen>
      ) : null}
    </div>
  );
}
