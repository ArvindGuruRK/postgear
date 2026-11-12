'use client';

/**
 * The email preview (2026-11-12): every email PostGear sends, drawn by
 * `@postgear/email` with sample data, in a frame the size of an inbox.
 * The design-system playground's pattern: dev only (see page.tsx), in the
 * app shell, and no session needed.
 *
 * - **Email**: which template.
 * - **View**: Desktop (the 600 px email in a wide frame), Phone (375 px, where
 *   the small-screen rules apply) or Plain Text (the text part every email
 *   also carries, for clients that show no HTML).
 * - **Scheme**: Light, or Dark, which renders the frame with a dark colour
 *   scheme so the email's `prefers-color-scheme` rules apply, as in Apple
 *   Mail. Gmail's app recolours on its own and cannot be imitated here.
 *
 * The logos load from this app's /email folder, as they do from WEB_URL in a
 * real email. The frame is sandboxed without scripts.
 */
import { ComponentIcon } from '@animateicons/react/lucide/component-icon';
import { MailIcon } from '@animateicons/react/lucide/mail-icon';
import { PaletteIcon } from '@animateicons/react/lucide/palette-icon';
import { EMAIL_SAMPLES } from '@postgear/email';
import {
  Card,
  PageActions,
  Segmented,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@postgear/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '@/components/navigation/app-shell';
import type { SidebarItem } from '@/components/navigation/sidebar';

const NAV_ITEMS: SidebarItem[] = [
  { label: 'Design System', href: '/dev/components', animatedIcon: ComponentIcon },
  { label: 'Templates', href: '/dev/studio', animatedIcon: PaletteIcon },
  { label: 'Emails', href: '/dev/emails', animatedIcon: MailIcon, active: true },
];

type View = 'desktop' | 'phone' | 'text';
type Scheme = 'light' | 'dark';

const VIEWS = [
  { value: 'desktop', label: 'Desktop' },
  { value: 'phone', label: 'Phone' },
  { value: 'text', label: 'Plain Text' },
] as const;

const SCHEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

export function EmailPreview() {
  const [id, setId] = useState(EMAIL_SAMPLES[0].id);
  const [view, setView] = useState<View>('desktop');
  const [scheme, setScheme] = useState<Scheme>('light');
  // The page's own address, so the logos load from here. Known only in the browser.
  const [origin, setOrigin] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const sample = EMAIL_SAMPLES.find((item) => item.id === id) ?? EMAIL_SAMPLES[0];
  const email = useMemo(
    () => (origin ? sample.render({ webUrl: origin }) : null),
    [sample, origin],
  );
  const size = email ? new Blob([email.html]).size : 0;

  return (
    <AppShell navItems={NAV_ITEMS} pageTitle="Email Preview" saveThemeToAccount={false}>
      <div className="flex flex-col gap-6 pb-16">
        <PageActions className="flex-wrap items-center justify-between gap-3">
          <div className="w-full sm:w-72">
            <Select value={id} onValueChange={setId}>
              <SelectTrigger aria-label="Email">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMAIL_SAMPLES.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented label="View" options={VIEWS} value={view} onValueChange={setView} />
            <Segmented
              label="Scheme"
              options={SCHEMES}
              value={scheme}
              onValueChange={setScheme}
              disabled={view === 'text'}
            />
          </div>
        </PageActions>

        <Card className="flex flex-col gap-4 p-4 sm:p-6">
          <dl className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <Detail label="Subject" value={email?.subject ?? ''} />
            <Detail label="Preview Text" value={email?.preview ?? ''} />
            <Detail label="Sent By" value={sample.sentBy} />
            <Detail
              label="Size"
              value={email ? `${(size / 1024).toFixed(1)} KB of HTML (Gmail clips at 102 KB)` : ''}
            />
          </dl>

          <div className="overflow-x-auto rounded-md border-2 border-outline bg-inset p-3 sm:p-6">
            {email && view === 'text' ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-sm text-ink">
                {email.text}
              </pre>
            ) : email ? (
              <EmailFrame
                html={email.html}
                title={`${sample.name} email`}
                width={view === 'phone' ? 375 : 760}
                scheme={scheme}
              />
            ) : null}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="type-label muted-tone text-sm text-ink">{label}</dt>
      <dd className="min-w-0 break-words font-sans text-sm text-ink">{value}</dd>
    </>
  );
}

/**
 * The email in a sandboxed frame, grown to its full height after each load
 * so the page scrolls rather than the frame. `allow-same-origin` (without
 * scripts) is what lets this page read that height.
 */
function EmailFrame({
  html,
  title,
  width,
  scheme,
}: {
  html: string;
  title: string;
  width: number;
  scheme: Scheme;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(900);

  const fit = () => {
    const document = frame.current?.contentDocument;
    if (document) setHeight(document.documentElement.scrollHeight);
  };

  return (
    <iframe
      // A new frame per scheme: a frame reads its colour scheme when it loads.
      key={`${scheme}-${width}`}
      ref={frame}
      title={title}
      srcDoc={html}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      onLoad={fit}
      className="mx-auto block max-w-full border-0"
      style={{ width, height, colorScheme: scheme }}
    />
  );
}
