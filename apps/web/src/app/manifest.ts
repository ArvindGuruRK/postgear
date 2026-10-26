import type { MetadataRoute } from 'next';

// The web app manifest: the name and icons a browser uses when PostGear is
// installed or pinned to a home screen. The icons are the logo's Cog Badge on
// white, written by apps/web/scripts/generate-brand.mjs; the tab icon itself
// is app/favicon.ico and app/icon.svg. The launch screen is white to match
// the icons; theme_color is the Classic light page (--color-primary). Both
// are literal for the same reason as the theme-color meta in layout.tsx: the
// browser reads this before any stylesheet.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PostGear',
    short_name: 'PostGear',
    description: 'AI-Powered Social Media Management & SEO Platform',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#fff8e7',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/brand/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
