import { Card, CardContent } from '@postgear/ui';
import type { ReactNode } from 'react';

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-3xl tracking-wide text-ink">{title}</h2>
        <p className="mt-1 max-w-2xl font-sans text-sm text-ink opacity-70">{description}</p>
      </div>
      <Card>
        <CardContent className="flex flex-col gap-6 pt-6">{children}</CardContent>
      </Card>
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="font-sans text-sm font-bold text-ink">{label}</span>
      <div className="flex flex-wrap items-center gap-4">{children}</div>
    </div>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="font-display text-lg tracking-wide text-ink">{children}</h3>;
}

/**
 * Dev-only annotation: prints the exact Tailwind utility classes (and, by
 * extension, the design tokens they resolve to — --font-display/--font-sans,
 * --color-ink, etc.) backing the specimen it sits under. Lets the one
 * developer on this project point at any sample in /dev and know which
 * class to reach for.
 */
export function Spec({ children }: { children: ReactNode }) {
  return (
    <code className="w-fit rounded bg-ink/5 px-1.5 py-0.5 font-mono text-[11px] leading-none text-ink opacity-60">
      {children}
    </code>
  );
}
