/**
 * Channel shapes shared between server components and client islands.
 *
 * Declared here rather than imported from `@postgear/db` or
 * `@postgear/social-core`, for the same reason `workspace.ts` gives: the db
 * package pulls in `@prisma/client`, which must never reach a browser bundle.
 * These mirror what `GET /channels` and `GET /channels/providers` return.
 *
 * Note what is absent: there is no `token` field, and there never should be.
 * The API's channel list is selected without the credential columns, so this
 * type has nothing to leave out.
 */
import type { ProviderRules } from '@postgear/social-core/composer';

/**
 * A channel's state, in the order the user needs to act on it.
 *
 * `needs_setup` and `needs_reconnect` are deliberately separate values rather
 * than one "broken" flag. They look similar — both mean the channel cannot
 * publish — but they need different actions: one resumes an unfinished
 * connection, the other re-authorizes an expired one. Collapsing them into a
 * single badge (as the reference implementation does) leaves the user unable to
 * tell which is which without clicking.
 */
export type ChannelHealth =
  | 'connected'
  | 'needs_reconnect'
  | 'needs_setup'
  | 'expiring'
  | 'disabled';

export interface PostingTime {
  /** Minutes since midnight. 540 is 09:00. */
  time: number;
}

export interface Channel {
  id: string;
  providerIdentifier: string;
  providerName: string;
  name: string;
  /** The platform handle, without the @. Null for platforms that have none. */
  profile: string | null;
  picture: string | null;
  health: ChannelHealth;
  disabled: boolean;
  refreshNeeded: boolean;
  inBetweenSteps: boolean;
  tokenExpiration: string | null;
  postingTimes: PostingTime[];
  createdAt: string;
}

export interface ProviderSummary {
  identifier: string;
  name: string;
  /**
   * False when the deployment has no client id for this platform.
   *
   * Rendered as a disabled tile with a reason rather than hidden — a missing
   * environment variable is a setup gap, and silently omitting the platform
   * makes it look unsupported instead.
   */
  configured: boolean;
  requiresEntitySelection: boolean;
  /**
   * What the provider can publish (Sprint 4) — the same object its
   * `checkValidity` enforces, so the composer never hardcodes a platform rule.
   */
  rules: ProviderRules;
}

/** One page, organization, YouTube channel or board to point a channel at. */
export interface ProviderEntity {
  id: string;
  name: string;
  picture?: string;
  username?: string;
  /**
   * A disambiguating line — follower count, board size, "via Acme Page".
   *
   * Not decoration: with five similarly-named Facebook pages, this is what
   * makes the choice possible.
   */
  detail?: string;
}
