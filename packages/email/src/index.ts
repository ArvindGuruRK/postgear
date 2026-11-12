/**
 * @postgear/email: every email PostGear sends, as typed props in and
 * `{ subject, preview, html, text }` out.
 *
 * Pure by design: React and `react-dom/server` only, no Prisma, no Nest, no
 * Node built-ins, so the API renders with it and the web app's `/dev/emails`
 * page renders the same templates in the browser.
 */
export { ASSET_PATHS, COLORS, type Tone } from './brand';
export { EMAIL_SAMPLES, type EmailSample } from './samples';
export { escapeHtml, LIMITS, multiLine, oneLine, safeUrl, truncate } from './safe';
export {
  accountLockedEmail,
  activationEmail,
  duplicateRegistrationEmail,
  duration,
  type EmailContext,
  type EmailSpec,
  type Fact,
  type InvitationProps,
  messageEmail,
  type NotificationEmailProps,
  notificationEmail,
  passwordResetEmail,
  type RenderedEmail,
  workspaceInvitationEmail,
} from './templates';
