/**
 * Every PostGear email, as typed props in and `{ subject, preview, html, text }`
 * out. Headings and button labels are Title Case, sentences are sentence case
 * (CLAUDE.md). Anything that came from a person or a platform is cut to a
 * known length and kept on one line where it is a name; React escapes it.
 */
import type { Tone } from './brand';
import type { Fact } from './components';
import { type EmailContext, type EmailSpec, type RenderedEmail, renderEmail } from './render';
import { LIMITS, multiLine, oneLine, safeUrl, truncate } from './safe';

export type { EmailContext, RenderedEmail } from './render';
export type { Fact } from './components';
export type { Tone } from './brand';

/** "1 hour", "30 minutes", "24 hours". */
export function duration(minutes: number): string {
  const whole = Math.max(1, Math.round(minutes));
  if (whole % 60 === 0) {
    const hours = whole / 60;
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  return whole === 1 ? '1 minute' : `${whole} minutes`;
}

function link(path: string, webUrl: string): string {
  return `${webUrl.replace(/\/+$/, '')}${path}`;
}

/* ───────────────────────── account and security ───────────────────────── */

export function activationEmail(
  context: EmailContext,
  props: { link: string; expiresInMinutes?: number },
): RenderedEmail {
  const expires = duration(props.expiresInMinutes ?? 24 * 60);
  return renderEmail(context, {
    subject: 'Confirm your PostGear account',
    preview: 'One click and your account is ready to use.',
    tone: 'brand',
    badge: 'Welcome',
    heading: 'Confirm Your Email',
    intro: [
      'Welcome to PostGear! Confirm this is your email address and your account is ready to use.',
    ],
    action: { label: 'Confirm Email', url: props.link },
    after: [`This link expires in ${expires}.`],
    note: "Didn't sign up for PostGear? You can safely ignore this email. The account stays inactive until the address is confirmed.",
    footer: {
      reason: 'You got this email because someone signed up for PostGear with this address.',
    },
  });
}

export function duplicateRegistrationEmail(context: EmailContext): RenderedEmail {
  return renderEmail(context, {
    subject: 'Someone tried to sign up with your email',
    preview: 'You already have a PostGear account, so nothing changed.',
    tone: 'warning',
    badge: 'Security',
    heading: 'You Already Have An Account',
    intro: [
      'Someone just tried to create a PostGear account with this email address. You already have one, so nothing changed.',
      'If it was you, login with your existing account instead.',
    ],
    action: { label: 'Login', url: link('/login', context.webUrl) },
    after: [`Forgot your password? Reset it here:\n${link('/reset-password', context.webUrl)}`],
    note: "If this wasn't you, no action is needed. The attempt didn't reveal anything about your account.",
    footer: {
      reason: 'You got this email because this address was used on the PostGear sign-up page.',
    },
  });
}

export function passwordResetEmail(
  context: EmailContext,
  props: { link: string; expiresInMinutes?: number },
): RenderedEmail {
  const expires = duration(props.expiresInMinutes ?? 60);
  return renderEmail(context, {
    subject: 'Reset your PostGear password',
    preview: `Choose a new password. The link expires in ${expires}.`,
    tone: 'brand',
    badge: 'Security',
    heading: 'Reset Your Password',
    intro: [
      'Someone asked to reset the password for your PostGear account. Choose a new one with the button below.',
    ],
    action: { label: 'Reset Password', url: props.link },
    after: [`This link expires in ${expires} and works once.`],
    note: "Didn't ask for this? You can ignore this email. Your password hasn't changed.",
    footer: {
      reason: 'You got this email because a password reset was asked for on this address.',
    },
  });
}

export function accountLockedEmail(
  context: EmailContext,
  props: { minutes: number; resetLink: string; resetExpiresInMinutes?: number },
): RenderedEmail {
  const locked = duration(props.minutes);
  const expires = duration(props.resetExpiresInMinutes ?? 60);
  return renderEmail(context, {
    subject: 'Your PostGear account is temporarily locked',
    preview: `Too many failed logins. It unlocks by itself in ${locked}.`,
    tone: 'danger',
    badge: 'Security',
    heading: `Account Locked For ${titleDuration(locked)}`,
    intro: [
      `There were several failed login attempts on your account, so it is locked for ${locked}.`,
      'If that was you, wait and try again, or reset your password now to login straight away.',
    ],
    action: { label: 'Reset Password', url: props.resetLink },
    after: [`The reset link expires in ${expires}.`],
    note: "If it wasn't you, someone may be guessing your password. Resetting it is the quickest way to stay safe.",
    footer: {
      reason: 'You got this email because of failed login attempts on your PostGear account.',
    },
  });
}

/** "15 minutes" to "15 Minutes", for the heading. */
function titleDuration(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/* ───────────────────────── workspace ───────────────────────── */

export interface InvitationProps {
  workspaceName: string;
  inviterName: string;
  role: 'ADMIN' | 'USER';
  link: string;
  expiresAt: Date;
}

export function workspaceInvitationEmail(
  context: EmailContext,
  props: InvitationProps,
): RenderedEmail {
  const workspace = oneLine(props.workspaceName, LIMITS.name) || 'a workspace';
  const inviter = oneLine(props.inviterName, LIMITS.name) || 'Someone';
  const roleName = props.role === 'ADMIN' ? 'Admin' : 'Member';
  const article = props.role === 'ADMIN' ? 'an admin' : 'a member';
  const expires = props.expiresAt.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return renderEmail(context, {
    subject: `${inviter} invited you to ${workspace} on PostGear`,
    preview: `Join ${workspace} as ${article}. The invitation expires on ${expires}.`,
    tone: 'brand',
    badge: 'Invitation',
    heading: "You're Invited",
    intro: [`${inviter} invited you to join ${workspace} on PostGear as ${article}.`],
    facts: [
      { label: 'Workspace', value: workspace },
      { label: 'Invited By', value: inviter },
      { label: 'Role', value: roleName, badge: true },
      { label: 'Expires', value: `${expires} (UTC)` },
    ],
    action: { label: 'Accept Invitation', url: props.link },
    after: ['You can login or create an account from there. The link works once.'],
    note: "Weren't expecting this? You can ignore this email.",
    footer: {
      reason: 'You got this email because a PostGear workspace admin invited this address.',
    },
  });
}

/* ───────────────────────── notifications ───────────────────────── */

export interface NotificationEmailProps {
  subject: string;
  preview?: string;
  tone: Tone;
  /** Title Case label on the band ("Post Failed"). */
  badge: string;
  heading: string;
  /** The notification's own one-line message. */
  message: string;
  facts?: Fact[];
  bullets?: string[];
  quote?: { label: string; text: string };
  action?: { label: string; url: string };
  /** Why this person got it, as a sentence. */
  reason: string;
  /** Where they can turn this kind of email off. */
  settingsUrl?: string;
}

/** A notification (post, channel, billing, webhook, workflow, Discover) as a summary card. */
export function notificationEmail(
  context: EmailContext,
  props: NotificationEmailProps,
): RenderedEmail {
  const message = oneLine(props.message, LIMITS.paragraph);
  const heading = oneLine(props.heading, 120) || 'Notification';
  const facts = (props.facts ?? [])
    .map((fact) => ({
      label: oneLine(fact.label, 40),
      value: oneLine(fact.value, LIMITS.fact),
      badge: fact.badge,
    }))
    .filter((fact) => fact.label && fact.value)
    .slice(0, 10);
  const bullets = (props.bullets ?? [])
    .map((item) => oneLine(item, LIMITS.bullet))
    .filter(Boolean)
    .slice(0, 12);
  const quote = props.quote
    ? { label: oneLine(props.quote.label, 60), text: multiLine(props.quote.text, LIMITS.quote) }
    : undefined;

  return renderEmail(context, {
    subject: props.subject,
    preview: props.preview ?? message,
    tone: props.tone,
    badge: oneLine(props.badge, 30),
    heading,
    intro: message ? [message] : [],
    facts,
    bullets,
    quote: quote?.text ? quote : undefined,
    action: props.action
      ? { label: oneLine(props.action.label, 40), url: props.action.url }
      : undefined,
    footer: {
      reason: oneLine(props.reason, 200),
      settings: props.settingsUrl
        ? { label: 'Notification Settings', url: props.settingsUrl }
        : undefined,
    },
  });
}

/* ───────────────────────── a message someone wrote ───────────────────────── */

/**
 * A message assembled from lines (a workflow's Email step, or any caller of
 * `MailService.sendPlain`). Blank lines split paragraphs; a line that is only
 * a link becomes a link. The subject is the heading.
 */
export function messageEmail(
  context: EmailContext,
  props: { subject: string; lines: string[]; reason?: string },
): RenderedEmail {
  const body = multiLine(props.lines.join('\n'), LIMITS.message);
  const paragraphs = body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, 60);
  const first = paragraphs[0] ?? '';
  const heading = oneLine(props.subject.replace(/^\[PostGear\]\s*/, ''), 120) || 'Message';

  return renderEmail(context, {
    subject: props.subject,
    preview: truncate(first.replace(/\s+/g, ' '), LIMITS.preview),
    tone: 'brand',
    badge: 'Message',
    heading,
    intro: paragraphs,
    footer: {
      reason: oneLine(props.reason ?? 'You got this email through PostGear.', 200),
    },
  });
}

/** Re-exported so callers can check a link before handing it over. */
export { safeUrl };
export type { EmailSpec };
