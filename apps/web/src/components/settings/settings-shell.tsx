'use client';

import { BellIcon } from '@animateicons/react/lucide/bell-icon';
import { CreditCardIcon } from '@animateicons/react/lucide/credit-card-icon';
import { KeyRoundIcon } from '@animateicons/react/lucide/key-round-icon';
import { PaletteIcon } from '@animateicons/react/lucide/palette-icon';
import { PlugIcon } from '@animateicons/react/lucide/plug-icon';
import { SignatureIcon } from '@animateicons/react/lucide/signature-icon';
import { UsersIcon } from '@animateicons/react/lucide/users-icon';
import { WebhookIcon } from '@animateicons/react/lucide/webhook-icon';
import { SettingsNav } from '@postgear/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useRef } from 'react';

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
  { segment: 'api-keys', label: 'API Keys', icon: KeyRoundIcon },
  { segment: 'webhooks', label: 'Webhooks', icon: WebhookIcon },
  // The apps workflows use (Sprint 10); the page lives under Workflows and
  // this entry redirects there.
  { segment: 'connections', label: 'Connections', icon: PlugIcon },
  // The workspace's saved sign-offs (2026-10-19), which the composer inserts.
  { segment: 'signatures', label: 'Signatures', icon: SignatureIcon },
  { segment: 'notifications', label: 'Notifications', icon: BellIcon },
  // Per user, like Notifications: the mode and light theme follow the person
  // into every workspace.
  { segment: 'appearance', label: 'Appearance', icon: PaletteIcon },
] as const;

/** Pixels left beside the active tab when the phone strip scrolls to it. */
const STRIP_PEEK = 16;

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
  const activeHref = active?.href ?? '';
  const frame = useRef<HTMLDivElement>(null);

  // On a phone the nav is a sideways strip and the later sections (Webhooks,
  // Notifications, Appearance) start past its right edge, so the page you are
  // on could be named by a tab you cannot see. Bring the active tab into the
  // strip when the page opens and on every section change. Only the strip's
  // own scrollLeft moves: `scrollIntoView` would also scroll the page to it.
  // On wider screens the nav is a column that never overflows, so this does
  // nothing there.
  useEffect(() => {
    const nav = frame.current?.querySelector('nav');
    const link = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!activeHref || !nav || !link || nav.scrollWidth <= nav.clientWidth) {
      return;
    }

    const navBox = nav.getBoundingClientRect();
    const linkBox = link.getBoundingClientRect();
    const start = linkBox.left - navBox.left + nav.scrollLeft;
    const end = start + linkBox.width;

    // "Nearest", with a little room so the tab's border is not on the edge.
    if (start < nav.scrollLeft) {
      nav.scrollTo({ left: start - STRIP_PEEK });
    } else if (end > nav.scrollLeft + nav.clientWidth) {
      nav.scrollTo({ left: end - nav.clientWidth + STRIP_PEEK });
    }
  }, [activeHref]);

  return (
    <div ref={frame} className="flex flex-col gap-4 md:flex-row md:gap-8">
      <SettingsNav
        aria-label="Settings sections"
        // On a phone, a row that scrolls sideways: as a column the six
        // sections pushed every settings page below the fold.
        className="w-full shrink-0 flex-row overflow-x-auto pb-1 pg-scrollbar pg-scrollbar-primary md:w-52 md:flex-col md:overflow-visible md:pb-0 [&>*]:shrink-0"
        items={items}
        activeHref={activeHref}
        linkComponent={Link}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
