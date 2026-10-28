import { StudioFonts } from '@/components/studio/studio-fonts';

/**
 * Every Studio screen draws slides in the templates' own fonts, which the API
 * serves. Their `@font-face` rules are written here once for all of them; a
 * face is only downloaded when a slide on screen uses it.
 */
export default function StudioLayout({ children }: LayoutProps<'/[orgId]/studio'>) {
  return (
    <>
      <StudioFonts />
      {children}
    </>
  );
}
