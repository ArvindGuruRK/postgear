/**
 * The five onboarding questions, as data.
 *
 * Defined once here and rendered by the step components, so adding an option
 * is a one-line change in one place rather than an edit to JSX. The values
 * must match the Prisma enums in `packages/db/prisma/schema.prisma`
 * (`OnboardingRole`, `OnboardingTeamSize`, `OnboardingGoal`,
 * `PostingFrequency`, `ReferralSource`): the API validates against those with
 * `z.nativeEnum`, so a typo here surfaces immediately as a rejected answer
 * rather than as silently missing data.
 *
 * They are written as plain string unions rather than imported from
 * `@postgear/db` because that package pulls in `@prisma/client`, which has no
 * business in a browser bundle.
 *
 * Each question is one screen of the wizard (Buffer's onboarding, 2026-10-19):
 * its `prompt` is that screen's heading. The icons each option shows are the
 * wizard's business and live there, keyed by these values.
 */

export interface QuestionOption {
  value: string;
  label: string;
  description?: string;
}

export interface Question {
  /** Matches the column name on `OnboardingResponse`. */
  field: 'role' | 'teamSize' | 'primaryGoal' | 'postingFrequency' | 'referralSource';
  prompt: string;
  options: QuestionOption[];
}

/**
 * Q1, step 2. Eight answers (2026-10-20), in the reference's order, so the
 * two-column grid fills four even rows with Other last. Labels say enough on
 * their own, so no second line, as in the reference.
 */
export const ROLE_QUESTION: Question = {
  field: 'role',
  prompt: 'How would you describe yourself?',
  options: [
    { value: 'SOLO_CREATOR', label: 'Solo creator' },
    { value: 'SMALL_BUSINESS', label: 'Small business owner' },
    { value: 'IN_HOUSE_TEAM', label: 'Part of a company marketing team' },
    { value: 'FREELANCER', label: 'Freelancer or consultant' },
    { value: 'AGENCY', label: 'Marketing agency' },
    { value: 'NONPROFIT', label: 'Non-profit organization' },
    { value: 'FOUNDER', label: 'Founder or personal brand' },
    { value: 'OTHER', label: 'Other' },
  ],
};

/** Q2, step 2. */
export const TEAM_SIZE_QUESTION: Question = {
  field: 'teamSize',
  prompt: 'How big is your team?',
  options: [
    { value: 'JUST_ME', label: 'Just me' },
    { value: 'SIZE_2_10', label: '2–10 people' },
    { value: 'SIZE_11_50', label: '11–50 people' },
    { value: 'SIZE_51_200', label: '51–200 people' },
    { value: 'SIZE_200_PLUS', label: '200+ people' },
  ],
};

/** Q3, step 3. */
export const GOAL_QUESTION: Question = {
  field: 'primaryGoal',
  prompt: 'What do you most want from PostGear?',
  options: [
    { value: 'GROW_AUDIENCE', label: 'Grow my audience' },
    { value: 'SAVE_TIME', label: 'Save time scheduling' },
    { value: 'BETTER_CONTENT', label: 'Write better content with AI' },
    { value: 'TRACK_PERFORMANCE', label: 'Track what performs' },
    { value: 'TEAM_COLLAB', label: 'Collaborate with my team' },
    { value: 'DRIVE_SALES', label: 'Drive traffic and sales' },
  ],
};

/** Q4, step 3. */
export const FREQUENCY_QUESTION: Question = {
  field: 'postingFrequency',
  // "today" read as "on this day"; this says what is meant (2026-10-20).
  prompt: 'How often do you post on social media?',
  options: [
    { value: 'DAILY', label: 'Every day' },
    { value: 'FEW_TIMES_WEEK', label: 'A few times a week' },
    { value: 'WEEKLY', label: 'About weekly' },
    { value: 'MONTHLY', label: 'Monthly or less' },
    { value: 'NOT_YET', label: "I haven't started yet" },
  ],
};

/** Q5, step 5. */
export const REFERRAL_QUESTION: Question = {
  field: 'referralSource',
  prompt: 'How did you hear about PostGear?',
  options: [
    { value: 'SEARCH', label: 'Search engine' },
    { value: 'SOCIAL', label: 'Social media' },
    { value: 'FRIEND', label: 'A friend or colleague' },
    { value: 'NEWSLETTER', label: 'A blog or newsletter' },
    { value: 'OTHER', label: 'Somewhere else' },
  ],
};

/** Step 4's heading: the channel picker, a multi-select. */
export const CHANNELS_PROMPT = 'Where do you plan to post?';

/**
 * The channels offered on step 4.
 *
 * Slugs, matching the `^[a-z0-9-]{1,32}$` pattern the API validates. Sprint 3
 * owns the real channel registry; this list only has to survive until then,
 * which is why it lives here rather than being fetched.
 */
// Most used first (2026-10-18), the same order as the Connect a channel picker.
export const CHANNEL_OPTIONS: QuestionOption[] = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'x', label: 'Twitter / X' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'tiktok', label: 'TikTok' },
];

/** The step every path ends on: name and avatar. Matches the API's `PROFILE_STEP`. */
export const PROFILE_STEP = 6;
