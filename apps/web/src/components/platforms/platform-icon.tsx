import { Share2 } from 'lucide-react';
import type { IconType } from 'react-icons';
import { FaInstagram, FaLinkedin, FaPinterest, FaTiktok, FaXTwitter, FaYoutube } from 'react-icons/fa6';
import { cn } from '@postgear/ui';

/**
 * The one place a platform's logo is chosen (UI revamp, 2026-10-18). Every
 * screen that names a social platform, or a sign-in provider, draws it through
 * this component so the logos stay consistent.
 *
 * Two sources:
 * - Google and Facebook use the official full-colour artwork in
 *   `public/icon/` (the multicolour "G", the blue Facebook mark).
 * - Every other platform is a Font Awesome 6 Brands glyph from `react-icons`
 *   (code MIT, icons CC BY 4.0), filled with the brand's own colour. X and
 *   TikTok are black marks, so they use `text-ink` and flip with the theme
 *   instead of vanishing on a dark page.
 *
 * Keyed by `Integration.providerIdentifier` (and the onboarding channel
 * slugs, which are the same ids). An unknown id falls back to a neutral share
 * glyph rather than nothing, so a new provider is never silently blank.
 */
type Brand =
  | { kind: 'image'; src: string; label: string }
  | { kind: 'glyph'; Icon: IconType; colorClass: string; label: string };

const BRANDS: Record<string, Brand> = {
  google: { kind: 'image', src: '/icon/google.svg', label: 'Google' },
  facebook: { kind: 'image', src: '/icon/facebook.svg', label: 'Facebook' },
  x: { kind: 'glyph', Icon: FaXTwitter, colorClass: 'text-ink', label: 'X' },
  linkedin: { kind: 'glyph', Icon: FaLinkedin, colorClass: 'text-[#0a66c2]', label: 'LinkedIn' },
  'linkedin-page': {
    kind: 'glyph',
    Icon: FaLinkedin,
    colorClass: 'text-[#0a66c2]',
    label: 'LinkedIn Page',
  },
  instagram: { kind: 'glyph', Icon: FaInstagram, colorClass: 'text-[#e4405f]', label: 'Instagram' },
  youtube: { kind: 'glyph', Icon: FaYoutube, colorClass: 'text-[#ff0000]', label: 'YouTube' },
  tiktok: { kind: 'glyph', Icon: FaTiktok, colorClass: 'text-ink', label: 'TikTok' },
  pinterest: { kind: 'glyph', Icon: FaPinterest, colorClass: 'text-[#e60023]', label: 'Pinterest' },
};

export interface PlatformIconProps {
  /** A provider identifier (`linkedin`, `x`, ...) or `google`. */
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
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true };

  if (!brand) {
    return <Share2 className={cn(size, 'text-ink')} strokeWidth={2.5} {...a11y} />;
  }

  if (brand.kind === 'image') {
    // Plain <img>: tiny static SVGs from /public. next/image would add a
    // loader and size bookkeeping for no gain (SVGs aren't resized).
    // biome-ignore lint/performance/noImgElement: static SVG logo from /public
    return <img src={brand.src} alt={title ?? ''} className={size} draggable={false} />;
  }

  const { Icon } = brand;
  return <Icon className={cn(size, brand.colorClass)} {...a11y} />;
}

/** The display name for a platform id, for places that only have the id. */
export function platformLabel(platform: string): string {
  return BRANDS[platform]?.label ?? platform;
}
