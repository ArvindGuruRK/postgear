import { SettingsShell } from '@/components/settings/settings-shell';

/**
 * Every settings page shares the section nav (Sprint 8). The org id comes
 * from the segment, which `[orgId]/layout.tsx` has already verified the
 * caller belongs to.
 */
export default async function SettingsLayout({
  children,
  params,
}: LayoutProps<'/[orgId]/settings'>) {
  const { orgId } = await params;

  return <SettingsShell orgId={orgId}>{children}</SettingsShell>;
}
