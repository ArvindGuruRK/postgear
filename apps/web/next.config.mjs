/** @type {import('next').NextConfig} */
const nextConfig = {
  // packages/ui and packages/social-core ship raw TypeScript source (no build
  // step) — Next needs to transpile them itself rather than treating them as
  // pre-built. Only social-core's `composer` entry point is imported here; see
  // the path alias in tsconfig.json for why never its root.
  transpilePackages: ['@postgear/ui', '@postgear/social-core'],
  // TODO: Configure remaining Next.js settings
  // - Image optimization domains
  // - Environment variable exposure
};

export default nextConfig;
