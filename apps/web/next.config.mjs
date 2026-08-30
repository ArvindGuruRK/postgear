/** @type {import('next').NextConfig} */
const nextConfig = {
  // packages/ui ships raw .tsx source (no build step) — Next needs to
  // transpile it itself rather than treating it as pre-built.
  transpilePackages: ['@postgear/ui'],
  // TODO: Configure remaining Next.js settings
  // - Image optimization domains
  // - Environment variable exposure
};

export default nextConfig;
