/**
 * User-facing strings for connections (Sprint 10, Module 04). The UI says
 * "link", not "webhook URL" (blueprint section 12). Sentence case, plain
 * words, and never a pasted value.
 */
export const CONNECTION_MESSAGES = {
  NOT_FOUND: 'Connection not found',
  DELETED: 'Connection deleted',
  UNKNOWN_APP: 'PostGear cannot connect that app.',
  NAME_TAKEN: (app: string, name: string) => `You already have a ${app} connection called ${name}.`,
  LIMIT: (max: number) => `A workspace can have at most ${max} connections.`,
  NOTHING_TO_CHANGE: 'Change the name or the details, then save.',
  OAUTH_ONLY: (app: string) => `${app} is connected by signing in, not with a form.`,
  IN_USE: (names: string) => `Pause these workflows first: ${names}.`,
  UNREADABLE: 'The saved details could not be read. Reconnect this connection.',

  // Check Connection.
  CHECK_SEND: (app: string) =>
    `Saved, not checked. ${app} links can only be checked by sending a message: use Test Step.`,
  CHECK_NONE: 'Secret headers have nothing to check: they are sent with each HTTP Request step.',
  CHECK_LATER: (app: string) => `Checking ${app} connections arrives with the ${app} steps.`,

  // Links.
  LINK_MISSING: (app: string) => `Enter your ${app} link.`,
  LINK_TOO_LONG: 'That link is too long. Links can be at most 2,048 characters.',
  LINK_INVALID: 'That is not a valid link.',
  LINK_HTTPS: 'Use a link that starts with https://.',
  LINK_CREDENTIALS: 'Links with a username or password are not allowed.',
  LINK_OTHER_APP: (app: string) => `This is a ${app} link. Add it as a ${app} connection instead.`,
  LINK_WRONG_APP: {
    slack: 'This is not a Slack link. Slack links start with https://hooks.slack.com/services/.',
    discord:
      'This is not a Discord link. Discord links start with https://discord.com/api/webhooks/.',
    teams:
      'This is not a Teams Workflows link. Copy the link the Workflows app shows when you finish its steps.',
  },
  TEAMS_OLD_LINK: 'This is an old Teams connector link. Create a new one with the Workflows app.',

  // Secret headers.
  HEADERS_INVALID: 'Add each secret header as a name and a value.',
  HEADERS_NONE: 'Add at least one secret header.',
  HEADERS_TOO_MANY: (max: number) => `You can add at most ${max} secret headers.`,
  HEADER_NAME_INVALID: 'Header names use letters, digits and dashes only.',
  HEADER_RESERVED: (name: string) => `${name} is set by PostGear and cannot be a secret header.`,
  HEADER_TWICE: (name: string) => `${name} is listed twice.`,
  HEADER_VALUE_MISSING: (name: string) => `Enter a value for ${name}.`,
  HEADER_VALUE_INVALID: (name: string) =>
    `The value for ${name} is too long or has a line break in it.`,

  GOOGLE_INVALID: 'Google did not send the details PostGear needs. Try connecting again.',

  // OAuth.
  RETURN_TO: 'The page to come back to must be a workflow page in this workspace.',
} as const;

/** Reasons the OAuth callback sends back in `?connectError=`; the web app words them. */
export const OAUTH_ERRORS = ['cancelled', 'not_admin', 'failed', 'unavailable', 'expired'] as const;
export type OAuthErrorCode = (typeof OAUTH_ERRORS)[number];
