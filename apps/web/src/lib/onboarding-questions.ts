/**
 * The five onboarding questions, as data.
 *
 * Defined once here and rendered by the step components, so adding an option
 * is a one-line change in one place rather than an edit to JSX. The values
 * must match the Prisma enums in `packages/db/prisma/schema.prisma`
 * (`OnboardingRole`, `OnboardingTeamSize`, `OnboardingGoal`,
 * `PostingFrequency`, `ReferralSource`) — the API validates against those with
 * `z.nativeEnum`, so a typo here surfaces immediately as a rejected answer
 * rather than as silently missing data.
 *
 * They are written as plain string unions rather than imported from
 * `@postgear/db` because that package pulls in `@prisma/client`, which has no
 * business in a browser bundle.
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

/** Q1 + Q2 — step 2, "About you". */
export const ABOUT_YOU_QUESTIONS: Question[] = [
  {
    field: 'role',
    prompt: 'What best describes you?',
    options: [
      { value: 'SOLO_CREATOR', label: 'Solo creator', description: 'Building my own audience' },
      { value: 'AGENCY', label: 'Agency', description: 'Posting on behalf of clients' },
      { value: 'IN_HOUSE_TEAM', label: 'In-house team', description: 'Marketing for one brand' },
      { value: 'SMALL_BUSINESS', label: 'Small business', description: 'Running my own shop' },
      { value: 'OTHER', label: 'Something else' },
    ],
  },
  {
    field: 'teamSize',
    prompt: 'How big is your team?',
    options: [
      { value: 'JUST_ME', label: 'Just me' },
      { value: 'SIZE_2_10', label: '2–10 people' },
      { value: 'SIZE_11_50', label: '11–50 people' },
      { value: 'SIZE_51_200', label: '51–200 people' },
      { value: 'SIZE_200_PLUS', label: '200+ people' },
    ],
  },
];

/** Q3 + Q4 — step 3, "Your goals". */
export const GOALS_QUESTIONS: Question[] = [
  {
    field: 'primaryGoal',
    prompt: 'What do you most want from PostGear?',
    options: [
      { value: 'GROW_AUDIENCE', label: 'Grow my audience' },
      { value: 'SAVE_TIME', label: 'Save time scheduling' },
      { value: 'BETTER_CONTENT', label: 'Write better content with AI' },
      { value: 'TRACK_PERFORMANCE', label: 'Track what performs' },
      { value: 'TEAM_COLLAB', label: 'Collaborate with my team' },
    ],
  },
  {
    field: 'postingFrequency',
    prompt: 'How often do you post today?',
    options: [
      { value: 'DAILY', label: 'Every day' },
      { value: 'FEW_TIMES_WEEK', label: 'A few times a week' },
      { value: 'WEEKLY', label: 'About weekly' },
      { value: 'MONTHLY', label: 'Monthly or less' },
      { value: 'NOT_YET', label: "I haven't started yet" },
    ],
  },
];

/** Q5 — step 5, "Finish". */
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

/**
 * The channels offered on step 4.
 *
 * Slugs, matching the `^[a-z0-9-]{1,32}$` pattern the API validates. Sprint 3
 * owns the real channel registry; this list only has to survive until then,
 * which is why it lives here rather than being fetched.
 */
export const CHANNEL_OPTIONS: QuestionOption[] = [
  { value: 'x', label: 'X' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'tiktok', label: 'TikTok' },
];

/** Labels for `OnboardingStepper`. Five steps, 1-based `currentStep`. */
export const ONBOARDING_STEPS = [
  { label: 'Workspace', description: 'Name it' },
  { label: 'About you', description: 'Two questions' },
  { label: 'Goals', description: 'Two questions' },
  { label: 'Channels', description: 'Optional' },
  { label: 'Finish', description: 'Last one' },
];
