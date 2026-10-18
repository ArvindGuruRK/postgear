'use client';

import { BellIcon } from '@animateicons/react/lucide/bell-icon';
import { CreditCardIcon } from '@animateicons/react/lucide/credit-card-icon';
import { KeyRoundIcon } from '@animateicons/react/lucide/key-round-icon';
import { PaletteIcon } from '@animateicons/react/lucide/palette-icon';
import { UsersIcon } from '@animateicons/react/lucide/users-icon';
import { WebhookIcon } from '@animateicons/react/lucide/webhook-icon';
import { SettingsNav } from '@postgear/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * The two-column settings layout: the section nav on the left, the page on
 * the right. One component, so every settings page gets the same nav and
 * the same gutter without repeating it, and so adding a section is one line.
 *
 * `usePathname` picks the active entry, which is why this is a client
 * component while `settings/layout.tsx` stays a server one.
 */
const SECTIONS = [
  { segment: 'team', label: 'Team', icon: UsersIcon },
  { segment: 'billing', label: 'Billing', icon: CreditCardIcon },
  { segment: 'api-keys', label: 'API keys', icon: KeyRoundIcon },
  { segment: 'webhooks', label: 'Webhooks', icon: WebhookIcon },
  { segment: 'notifications', label: 'Notifications', icon: BellIcon },
  // Per user, like Notifications: the mode and light theme follow the person
  // into every workspace.
  { segment: 'appearance', label: 'Appearance', icon: PaletteIcon },
] as const;

export function SettingsShell({ orgId, children }: { orgId: string; children: ReactNode }) {
  const pathname = usePathname();
  const base = `/${orgId}/settings`;

  const items = SECTIONS.map((section) => ({
    label: section.label,
    href: `${base}/${section.segment}`,
    animatedIcon: section.icon,
  }));

  const active = items.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );

  return (
    <div className="flex flex-col gap-6 md:flex-row md:gap-8">
      <SettingsNav
        aria-label="Settings sections"
        className="w-full shrink-0 md:w-52"
        items={items}
        activeHref={active?.href ?? ''}
        linkComponent={Link}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
