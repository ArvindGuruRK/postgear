// Sentry 11 exports the build helper from its own subpath, not the root.
import { withSentryConfig } from '@sentry/nextjs/config';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // packages/ui and packages/social-core ship raw TypeScript source (no build
  // step): Next needs to transpile them itself rather than treating them as
  // pre-built. Only social-core's `composer` entry point is imported here; see
  // the path alias in tsconfig.json for why never its root. design-engine is
  // Studio's renderer (Sprint 9), browser-safe source like the other two.
  // automation is the Workflow Builder's pure engine (Sprint 10).
  transpilePackages: [
    '@postgear/ui',
    '@postgear/social-core',
    '@postgear/design-engine',
    '@postgear/automation',
  ],
  // TODO: Configure remaining Next.js settings
  // - Image optimization domains
  // - Environment variable exposure
};

/**
 * Sentry's build wrapper (Sprint 8) instruments the server and client
 * bundles so `instrumentation.ts` / `instrumentation-client.ts` can report.
 * Source maps are not uploaded: that needs an org, a project and an auth
 * token, none of which exist on the free local setup, and a build must not
 * fail or warn for their absence. Add `org`, `project` and `SENTRY_AUTH_TOKEN`
 * here when a release pipeline exists.
 */
export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: { disable: true },
  telemetry: false,
});
