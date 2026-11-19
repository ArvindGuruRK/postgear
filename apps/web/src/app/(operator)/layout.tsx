import type { ReactNode } from 'react';
import { AppearanceSync } from '@/components/appearance/appearance-sync';
import { OperatorDesktopOnly } from '@/components/operator/operator-desktop-only';
import { OperatorTopBar } from '@/components/operator/operator-top-bar';
import { requireOperator } from '@/components/operator/require-operator';

/**
 * The operator screens' frame (Sprint 12, Module 19 section 7): the whole
 * window, like a workflow or a design, with no workspace rail and a back
 * button of its own. The top bar names the page ("Operator"). Desktop only:
 * below 1366 px it shows one sentence and nothing else.
 *
 * The gate runs before anything is drawn: signed out goes to the login page,
 * anyone who is not a platform operator gets the app's 404 page.
 */
export default async function OperatorLayout({ children }: { children: ReactNode }) {
  const session = await requireOperator();

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-primary p-3">
      <AppearanceSync stored={session.appearance} />
      <OperatorTopBar />
      <main className="min-h-0 flex-1 overflow-y-auto px-1 pt-2 pb-6 pg-scrollbar pg-scrollbar-primary">
        <OperatorDesktopOnly>{children}</OperatorDesktopOnly>
      </main>
    </div>
  );
}
