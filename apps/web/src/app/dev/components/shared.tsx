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
