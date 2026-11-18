'use client';

/**
 * Clips is desktop only (UX blueprint section 12), like Workflows and Studio:
 * nobody trims a clip or drags a crop box on a phone.
 *
 * Below 1366 px every Clips route shows one centred sentence and nothing
 * else. The switch is the `desk` breakpoint in CSS, not a measured width, so
 * the right state is in the first paint with no flash. Both branches are in
 * the markup; the hidden one costs nothing to draw, and the editor routes
 * that wrap a heavy canvas mount it only where it shows (`desk:contents`).
 *
 * A client component only because `EmptyState` takes an icon component,
 * which a server component cannot hand across; it holds no state, and the
 * pages' own content still renders on the server as its children.
 */
import { EmptyState } from '@postgear/ui';
import { MonitorIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { BIGGER_SCREEN_SENTENCE } from './clips-model';

export function ClipsDesktopOnly({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="hidden desk:contents">{children}</div>
      <div className="flex items-center justify-center py-24 desk:hidden">
        <EmptyState icon={MonitorIcon} title={BIGGER_SCREEN_SENTENCE} />
      </div>
    </>
  );
}
