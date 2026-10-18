import { Sora } from 'next/font/google';

/**
 * The platform's single typeface, loaded once and shared by layout.tsx and
 * global-error.tsx (a font definitions file, per the Next.js font docs: each
 * loader call is its own hosted instance, so it must live in one place).
 *
 * Sora is the locked brand typeface (product decision, 2026-10-15), chosen
 * on the live app over Bricolage Grotesque, Space Grotesk and Archivo. Its
 * weights and tracking are tuned in globals.css ("Typography"); no component
 * names a font or a role weight.
 *
 * Variable font, so no `weight` list: every weight 100–800 is one file.
 */
export const brandFont = Sora({
  subsets: ['latin'],
  variable: '--font-brand',
  display: 'swap',
});
