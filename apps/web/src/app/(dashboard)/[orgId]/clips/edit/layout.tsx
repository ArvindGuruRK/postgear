import { StudioFonts } from '@/components/studio/studio-fonts';

/**
 * The clip editor draws text in the same shipped fonts as Studio (Module 11).
 * Their `@font-face` rules are written here once; a face is only downloaded
 * when a text on the clip uses it.
 */
export default function ClipEditLayout({ children }: LayoutProps<'/[orgId]/clips/edit'>) {
  return (
    <>
      <StudioFonts />
      {children}
    </>
  );
}
