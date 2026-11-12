/**
 * Every template with example data, for the `/dev/emails` preview page and
 * the tests. Never used to send anything: the values are made up.
 */
import {
  accountLockedEmail,
  activationEmail,
  duplicateRegistrationEmail,
  type EmailContext,
  messageEmail,
  notificationEmail,
  passwordResetEmail,
  type RenderedEmail,
  workspaceInvitationEmail,
} from './templates';

export interface EmailSample {
  id: string;
  /** Title Case, for the preview page's list. */
  name: string;
  /** What sends it, in a few words. */
  sentBy: string;
  render: (context: EmailContext) => RenderedEmail;
}

const TOKEN = 'sample-token-not-real';

export const EMAIL_SAMPLES: EmailSample[] = [
  {
    id: 'activation',
    name: 'Account Activation',
    sentBy: 'Sign up',
    render: (context) =>
      activationEmail(context, { link: `${context.webUrl}/verify?token=${TOKEN}` }),
  },
  {
    id: 'duplicate-registration',
    name: 'Duplicate Sign Up',
    sentBy: 'Sign up with a taken address',
    render: (context) => duplicateRegistrationEmail(context),
  },
  {
    id: 'password-reset',
    name: 'Password Reset',
    sentBy: 'Forgot password',
    render: (context) =>
      passwordResetEmail(context, { link: `${context.webUrl}/reset-password/${TOKEN}` }),
  },
  {
    id: 'account-locked',
    name: 'Account Locked',
    sentBy: 'Too many failed logins',
    render: (context) =>
      accountLockedEmail(context, {
        minutes: 15,
        resetLink: `${context.webUrl}/reset-password/${TOKEN}`,
      }),
  },
  {
    id: 'workspace-invitation',
    name: 'Workspace Invitation',
    sentBy: 'Settings, Team',
    render: (context) =>
      workspaceInvitationEmail(context, {
        workspaceName: 'Northwind Studio',
        inviterName: 'Priya Raman',
        role: 'ADMIN',
        link: `${context.webUrl}/invite/${TOKEN}`,
        expiresAt: new Date('2026-11-19T12:00:00Z'),
      }),
  },
  {
    id: 'post-failed',
    name: 'Post Failed',
    sentBy: 'Notifications',
    render: (context) =>
      notificationEmail(context, {
        subject: '[PostGear] Could not publish to Northwind on LinkedIn',
        tone: 'danger',
        badge: 'Post Failed',
        heading: 'Post Failed',
        message: 'Your post could not be published after 3 tries.',
        facts: [
          {
            label: 'Post',
            value: 'Our autumn collection is live. Swipe through the new colours...',
          },
          { label: 'Channel', value: 'Northwind on LinkedIn' },
          { label: 'Reason', value: 'The platform kept failing and every retry was used' },
          { label: 'Details', value: 'LinkedIn answered 503 Service Unavailable' },
          { label: 'Attempts', value: '3' },
        ],
        action: { label: 'Open The Queue', url: `${context.webUrl}/org/queue` },
        reason: 'You got this email because failure emails are on in your notification settings.',
        settingsUrl: `${context.webUrl}/org/settings/notifications`,
      }),
  },
  {
    id: 'post-published',
    name: 'Post Published',
    sentBy: 'Notifications',
    render: (context) =>
      notificationEmail(context, {
        subject: '[PostGear] Published to Northwind on Instagram',
        tone: 'success',
        badge: 'Published',
        heading: 'Post Published',
        message: 'Your post is live.',
        facts: [
          { label: 'Post', value: 'Behind the scenes of our studio shoot' },
          { label: 'Channel', value: 'Northwind on Instagram' },
        ],
        action: { label: 'See The Post', url: 'https://www.instagram.com/' },
        reason: 'You got this email because success emails are on in your notification settings.',
        settingsUrl: `${context.webUrl}/org/settings/notifications`,
      }),
  },
  {
    id: 'billing-activated',
    name: 'Plan Active',
    sentBy: 'Billing',
    render: (context) =>
      notificationEmail(context, {
        subject: '[PostGear] Your Pro plan is active',
        tone: 'success',
        badge: 'Billing',
        heading: 'Subscription Active',
        message: 'Thanks for upgrading. Your new plan is ready to use.',
        facts: [
          { label: 'Plan', value: 'Pro', badge: true },
          { label: 'Amount', value: '$29.00' },
          { label: 'Date', value: '12 November 2026' },
        ],
        action: { label: 'Manage Billing', url: `${context.webUrl}/org/settings/billing` },
        reason: 'You got this email because you are an admin of this PostGear workspace.',
      }),
  },
  {
    id: 'discover-digest',
    name: 'Discover Digest',
    sentBy: 'Notifications',
    render: (context) =>
      notificationEmail(context, {
        subject: '[PostGear] What is trending in Chennai this week',
        tone: 'brand',
        badge: 'Discover',
        heading: 'Your Discover Week',
        message: 'Here is what people near you are talking about.',
        bullets: [
          'Monsoon travel tips are up 40% in searches',
          'Local cafes are posting more short videos',
          'A new metro line opens on Friday',
        ],
        action: { label: 'Open Discover', url: `${context.webUrl}/org/discover` },
        reason: 'You got this email because the weekly digest is on in your notification settings.',
        settingsUrl: `${context.webUrl}/org/settings/notifications`,
      }),
  },
  {
    id: 'cancellation-feedback',
    name: 'Cancellation Feedback',
    sentBy: 'Billing, to the owner',
    render: (context) =>
      notificationEmail(context, {
        subject: 'Cancellation feedback from Northwind Studio',
        tone: 'warning',
        badge: 'Cancellation',
        heading: 'A Plan Was Canceled',
        message: 'A workspace scheduled its PostGear plan to end.',
        facts: [
          { label: 'Workspace', value: 'Northwind Studio (org_123)' },
          { label: 'Plan', value: 'Pro, billed monthly' },
          { label: 'Reason', value: 'Too expensive' },
        ],
        quote: { label: 'Their Feedback', text: 'Great product, wrong budget for us this year.' },
        reason: 'You got this email because this address is the PostGear owner address.',
      }),
  },
  {
    id: 'workflow-message',
    name: 'Workflow Email',
    sentBy: 'A workflow Email step',
    render: (context) =>
      messageEmail(context, {
        subject: 'Weekly report',
        lines: [
          'Hi team,',
          '',
          'This week we published 12 posts and reached 4,200 people.',
          '',
          'The full numbers are here:',
          `${context.webUrl}/org/analytics`,
          '',
          'Sent by the workflow Weekly Report in PostGear.',
        ],
      }),
  },
];
