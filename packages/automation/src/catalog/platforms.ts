/**
 * Plain data the catalog shares with the web app: the social platforms a
 * Publish step can target, the reasons a publish can fail, and the apps a
 * step can need a connection for.
 *
 * Packages never import each other in this repo, so the provider ids and
 * failure reasons are written out here. They must match
 * `packages/social-core` provider identifiers and `PublishFailureReason` in
 * `@postgear/scheduling`; the worker, which imports both, tests that they do
 * (Module 09).
 */
import type { ConnectionKind, IconKey } from './types';

export interface PublishPlatform {
  id: 'instagram' | 'facebook' | 'x' | 'linkedin' | 'youtube' | 'tiktok' | 'pinterest';
  title: string;
  /** social-core provider identifiers whose channels this card lists. */
  providers: readonly string[];
  icon: IconKey;
}

/** One Social Channels card per platform, in library order. */
export const PUBLISH_PLATFORMS: readonly PublishPlatform[] = [
  { id: 'instagram', title: 'Instagram', providers: ['instagram'], icon: 'instagram' },
  { id: 'facebook', title: 'Facebook', providers: ['facebook'], icon: 'facebook' },
  { id: 'x', title: 'X', providers: ['x'], icon: 'x' },
  // A LinkedIn profile and a LinkedIn Page are separate channels (and picker
  // options) but one platform card.
  { id: 'linkedin', title: 'LinkedIn', providers: ['linkedin', 'linkedin-page'], icon: 'linkedin' },
  { id: 'youtube', title: 'YouTube', providers: ['youtube'], icon: 'youtube' },
  { id: 'tiktok', title: 'TikTok', providers: ['tiktok'], icon: 'tiktok' },
  { id: 'pinterest', title: 'Pinterest', providers: ['pinterest'], icon: 'pinterest' },
];

export type PublishPlatformId = PublishPlatform['id'];

export const PUBLISH_PLATFORM_IDS = PUBLISH_PLATFORMS.map((platform) => platform.id) as [
  PublishPlatformId,
  ...PublishPlatformId[],
];

export function platformById(id: string): PublishPlatform | undefined {
  return PUBLISH_PLATFORMS.find((platform) => platform.id === id);
}

/** Why a publish failed for good, with the words filters and messages show. */
export const PUBLISH_FAILURE_REASONS = [
  { id: 'needs_reconnect', label: 'Channel needs reconnecting' },
  { id: 'needs_permissions', label: 'Channel is missing permissions' },
  { id: 'rejected', label: 'The platform refused the post' },
  { id: 'retries_exhausted', label: 'Gave up after several tries' },
  { id: 'channel_unavailable', label: 'Channel is unavailable' },
  { id: 'interrupted', label: 'Publishing was interrupted' },
  { id: 'unexpected', label: 'Something unexpected went wrong' },
] as const;

export type PublishFailureReasonId = (typeof PUBLISH_FAILURE_REASONS)[number]['id'];

export const PUBLISH_FAILURE_REASON_IDS = PUBLISH_FAILURE_REASONS.map((reason) => reason.id) as [
  PublishFailureReasonId,
  ...PublishFailureReasonId[],
];

export interface ConnectionKindInfo {
  kind: ConnectionKind;
  /** The app's name as the UI shows it. */
  title: string;
  icon: IconKey;
}

/** Mirrors the API's connection providers (Module 04), without anything secret. */
export const CONNECTION_KINDS: readonly ConnectionKindInfo[] = [
  { kind: 'slack', title: 'Slack', icon: 'slack' },
  { kind: 'teams', title: 'Microsoft Teams', icon: 'teams' },
  { kind: 'discord', title: 'Discord', icon: 'discord' },
  { kind: 'google', title: 'Google', icon: 'google-sheets' },
  { kind: 'http', title: 'Secret Headers', icon: 'http' },
];

export function connectionKindInfo(kind: ConnectionKind): ConnectionKindInfo {
  return CONNECTION_KINDS.find((info) => info.kind === kind) ?? { kind, title: kind, icon: 'http' };
}
