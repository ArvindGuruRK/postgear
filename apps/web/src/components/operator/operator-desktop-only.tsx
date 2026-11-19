'use client';

import { EmptyState } from '@postgear/ui';
import { MonitorIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { OPERATOR_COPY } from './operator-model';

/**
 * The operator screens are desktop only (module 19 section 7), like
 * Workflows, Studio and Clips: below 1366 px they show one centred sentence
 * and nothing else. The switch is the `desk` breakpoint in CSS, so the right
 * state is in the first paint with no flash.
 */
export function OperatorDesktopOnly({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="hidden desk:contents">{children}</div>
      <div className="flex items-center justify-center py-24 desk:hidden">
        <EmptyState icon={MonitorIcon} title={OPERATOR_COPY.bigScreen} />
      </div>
    </>
  );
}
