'use client';

/**
 * The operator page (Sprint 12, Module 19 Part B): six tabs on one page,
 * Plans, Workspace Overrides, Usage, Costs (Sprint 13, Module 15), Change Log
 * and Library. The open tab is
 * kept in `?tab=` so a reload or a shared address opens the same one; the
 * address changes through the history API, so switching tabs never asks the
 * server for the page again. Workspace Overrides and Usage share the picked
 * workspace: an operator looking at one workspace's overrides usually wants
 * its usage next.
 */
import { Tabs, TabsContent, TabsList, TabsTrigger, toast } from '@postgear/ui';
import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import type { EndingOverride, OperatorTab, PlansView, WorkspaceSummary } from '@/types/operator';
import { ChangeLogTab } from './change-log-tab';
import { CostsTab } from './costs-tab';
import { LibraryTab } from './library-tab';
import { errorSentence } from './operator-fields';
import { OPERATOR_TAB_NAMES, OPERATOR_TABS } from './operator-model';
import { OverridesTab } from './overrides-tab';
import { PlansTab } from './plans-tab';
import { UsageTab } from './usage-tab';

export function OperatorView({
  initialPlans,
  initialTab,
}: {
  initialPlans: PlansView | null;
  initialTab: OperatorTab;
}) {
  const [tab, setTab] = useState<OperatorTab>(initialTab);
  const [plans, setPlans] = useState<PlansView | null>(initialPlans);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const open = useCallback((next: OperatorTab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'plans') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
  }, []);

  const reloadPlans = useCallback(async () => {
    setPlans(await api<PlansView>('/operator/entitlements/plans'));
  }, []);

  const openOverride = useCallback(
    async (ending: EndingOverride | null) => {
      if (!ending) {
        setFocusKey(null);
        open('overrides');
        return;
      }
      try {
        const found = await api<{ workspaces: WorkspaceSummary[] }>(
          `/operator/workspaces?q=${encodeURIComponent(ending.organizationId)}`,
        );
        const match = found.workspaces.find((item) => item.id === ending.organizationId) ?? null;
        setWorkspace(match);
        setFocusKey(ending.key);
        open('overrides');
      } catch (caught) {
        toast({ title: errorSentence(caught) });
      }
    },
    [open],
  );

  const pickWorkspace = useCallback((next: WorkspaceSummary | null) => {
    setWorkspace(next);
    setFocusKey(null);
  }, []);

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => open(value as OperatorTab)}
      className="flex flex-col gap-5"
    >
      <TabsList aria-label="Operator tabs" className="self-start">
        {OPERATOR_TABS.map((value) => (
          <TabsTrigger key={value} value={value}>
            {OPERATOR_TAB_NAMES[value]}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="plans" className="mt-0">
        <PlansTab
          plans={plans}
          onPlansChange={setPlans}
          onReload={reloadPlans}
          onOpenOverride={openOverride}
        />
      </TabsContent>

      <TabsContent value="overrides" className="mt-0">
        <OverridesTab workspace={workspace} onWorkspace={pickWorkspace} focusKey={focusKey} />
      </TabsContent>

      <TabsContent value="usage" className="mt-0">
        <UsageTab workspace={workspace} onWorkspace={pickWorkspace} />
      </TabsContent>

      <TabsContent value="costs" className="mt-0">
        <CostsTab />
      </TabsContent>

      <TabsContent value="changes" className="mt-0">
        <ChangeLogTab />
      </TabsContent>

      <TabsContent value="library" className="mt-0">
        <LibraryTab />
      </TabsContent>
    </Tabs>
  );
}
