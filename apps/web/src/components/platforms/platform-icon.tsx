import { Share2 } from 'lucide-react';
import { cn } from '@postgear/ui';

/**
 * The one place a platform's logo is chosen (UI revamp, 2026-10-18). Every
 * screen that names a social platform, or a sign-in provider, draws it through
 * this component so the logos stay consistent.
 *
 * Every logo is the product's own artwork in `public/icon/` (chosen by the
 * owner over a generic icon library), drawn as a plain `<img>`:
 * - Sign-in uses the round marks: `google.svg` and `facebook.svg`.
 * - Channels use the tile versions: `facebookplatform.svg` for Facebook,
 *   `linkedin.svg` for both LinkedIn profiles and Pages, and so on.
 * - X has a black tile for light mode and a white one (`twitterlight.svg`)
 *   for dark mode, swapped by the `dark:` variant, so it never sinks into a
 *   dark page.
 *
 * Keyed by `Integration.providerIdentifier` (the onboarding channel slugs are
 * the same ids), plus `google` and `facebook-signin` for the sign-in buttons.
 * An unknown id falls back to a neutral share glyph rather than nothing, so a
 * new provider is never silently blank.
 */
interface Brand {
  label: string;
  src: string;
  /** Shown instead of `src` in dark mode, when the light artwork would vanish. */
  darkSrc?: string;
}

const BRANDS: Record<string, Brand> = {
  google: { label: 'Google', src: '/icon/google.svg' },
  'facebook-signin': { label: 'Facebook', src: '/icon/facebook.svg' },
  facebook: { label: 'Facebook', src: '/icon/facebookplatform.svg' },
  x: { label: 'Twitter / X', src: '/icon/twitter.svg', darkSrc: '/icon/twitterlight.svg' },
  linkedin: { label: 'LinkedIn', src: '/icon/linkedin.svg' },
  'linkedin-page': { label: 'LinkedIn Page', src: '/icon/linkedin.svg' },
  instagram: { label: 'Instagram', src: '/icon/instagram.svg' },
  youtube: { label: 'YouTube', src: '/icon/youtube.svg' },
  tiktok: { label: 'TikTok', src: '/icon/tiktok.svg' },
  pinterest: { label: 'Pinterest', src: '/icon/pinterest.svg' },
};

export interface PlatformIconProps {
  /** A provider identifier (`linkedin`, `x`, ...), `google` or `facebook-signin`. */
  platform: string;
  /** Size utilities; defaults to 16px. */
  className?: string;
  /**
   * Accessible name. Omit when the platform's name is already written next to
   * the icon (the usual case), so screen readers don't hear it twice.
   */
  title?: string;
}

export function PlatformIcon({ platform, className, title }: PlatformIconProps) {
  const brand = BRANDS[platform];
  const size = cn('h-4 w-4 shrink-0', className);

  if (!brand) {
    return title ? (
      <Share2 className={cn(size, 'text-ink')} strokeWidth={2.5} role="img" aria-label={title} />
    ) : (
      <Share2 className={cn(size, 'text-ink')} strokeWidth={2.5} aria-hidden="true" />
    );
  }

  // Plain <img>: tiny static SVGs from /public. next/image would add a loader
  // and size bookkeeping for no gain (SVGs aren't resized).
  if (!brand.darkSrc) {
    // biome-ignore lint/performance/noImgElement: static SVG logo from /public
    return <img src={brand.src} alt={title ?? ''} className={size} draggable={false} />;
  }

  // Two images, one per scheme. Only the visible one carries the name.
  return (
    <>
      {/* biome-ignore lint/performance/noImgElement: static SVG logo from /public */}
      <img
        src={brand.src}
        alt={title ?? ''}
        className={cn(size, 'dark:hidden')}
        draggable={false}
      />
      {/* biome-ignore lint/performance/noImgElement: static SVG logo from /public */}
      <img
        src={brand.darkSrc}
        alt={title ?? ''}
        // `block`, as preflight makes the light one: an inline-block image
        // sits on a text line, which grew the sticker behind it into a dark
        // band above the white X tile.
        className={cn(size, 'hidden dark:block')}
        draggable={false}
      />
    </>
  );
}

/** The display name for a platform id, for places that only have the id. */
export function platformLabel(platform: string): string {
  return BRANDS[platform]?.label ?? platform;
}
