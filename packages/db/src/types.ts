/**
 * Re-exported Prisma types, so the rest of the monorepo imports from
 * `@postgear/db` rather than reaching into `@prisma/client` directly.
 *
 * The indirection matters for one practical reason: it keeps `@prisma/client`
 * a dependency of this package alone. Every other workspace depends on
 * `@postgear/db`, so a Prisma major-version bump is a one-package change.
 */

// Model row types.
export type {
  AnalyticsSync,
  Announcement,
  ApiKey,
  BillingEvent,
  BrandKit,
  ChannelMetricSnapshot,
  Comments,
  Credits,
  Customer,
  Design,
  DesignFavourite,
  DesignShare,
  Errors,
  Integration,
  IntegrationsWebhooks,
  Media,
  NotificationCursor,
  Notifications,
  OAuthApp,
  OAuthAuthorization,
  OnboardingResponse,
  Organization,
  Post,
  PostMetricSnapshot,
  SEOAudit,
  Sets,
  Signatures,
  Subscription,
  Tags,
  TagsPosts,
  User,
  UserOrganization,
  WebhookDelivery,
  Webhooks,
} from '@prisma/client';
// Enums are re-exported as values, not just types: call sites need
// `Role.ADMIN`, not only the `Role` union.
// Prisma's own namespace, for input types (`Prisma.PostCreateInput`),
// transaction clients, and `Prisma.PrismaClientKnownRequestError`.
export {
  AnalyticsSyncStatus,
  AnnouncementColor,
  BrandKitSource,
  CreationMethod,
  DesignFormat,
  DesignStatus,
  NotificationEmailStatus,
  OnboardingGoal,
  OnboardingRole,
  OnboardingTeamSize,
  Period,
  PostingFrequency,
  Prisma,
  Provider,
  ReferralSource,
  Role,
  SEOAuditStatus,
  ShortLinkPreference,
  State,
  SubscriptionStatus,
  SubscriptionTier,
  WebhookDeliveryStatus,
} from '@prisma/client';

/**
 * A Prisma client scoped to an interactive transaction. Repository methods that
 * need to participate in a caller's transaction take this instead of the full
 * client: it is the client type minus `$transaction` and the other top-level
 * operations that are illegal inside one.
 */
export type PrismaTransactionClient = Omit<
  import('@prisma/client').PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// 27 of the 48 inherited models were dropped outright across two migrations:
// the GitHub/trending and automation cluster, the eight `mastra_*` tables, and
// the creator-marketplace (`Orders`, `Messages`, `SocialMediaAgency`, …) along
// with its `OrderStatus` / `From` / `APPROVED_SUBMIT_FOR_ORDER` enums. Read the
// "Deliberately removed" section of prisma/SCHEMA_NOTES.md before re-adding
// anything by those names.
