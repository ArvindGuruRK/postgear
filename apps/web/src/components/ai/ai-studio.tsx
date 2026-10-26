'use client';

/**
 * The AI studio: one page, two modes.
 *
 * Generate is a form and a pipeline: a topic in, a researched post out.
 * Copilot is a conversation with an assistant that acts. They share the
 * credits meter in the actions row (beside the mode switch, revamp
 * 2026-10-26) and nothing else, so each is its own island below; the mode
 * lives in the URL (`?mode=copilot`) the way the calendar's
 * view does, so a link lands on the right one.
 *
 * Both panels stay mounted and the inactive one is hidden rather than
 * unmounted: a generation keeps streaming while the person asks the copilot
 * something, and the conversation is still there when they come back.
 *
 * What the page shows for each way the API can answer: an `ErrorState` when
 * `/ai/status` did not answer at all, `AiUnavailable` when no model is
 * configured, and the two modes otherwise. The meter copes with its own
 * missing balance.
 */
import { MessageSquareIcon } from '@animateicons/react/lucide/message-square-icon';
import { SparklesIcon } from '@animateicons/react/lucide/sparkles-icon';
import {
  cn,
  ErrorState,
  MotionIcon,
  PageActions,
  Stack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@postgear/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AiCredits, AiStatus } from '@/types/ai';
import type { Channel, ProviderSummary } from '@/types/channel';
import { useWorkspace } from '../navigation/workspace-provider';
import { SEGMENTED_LIST, SEGMENTED_TRIGGER } from './ai-ui';
import { AiUnavailable } from './ai-unavailable';
import { CopilotChat } from './copilot-chat';
import { CreditsMeter } from './credits-meter';
import { GeneratePanel } from './generate-panel';
import { useCredits } from './use-credits';

export type StudioMode = 'generate' | 'copilot';

export function isStudioMode(value: string | null): value is StudioMode {
  return value === 'generate' || value === 'copilot';
}

export function AiStudio({
  orgId,
  channels,
  providers,
  status,
  credits: initialCredits,
}: {
  orgId: string;
  channels: Channel[];
  providers: ProviderSummary[];
  /** Null when `/ai/status` did not answer. */
  status: AiStatus | null;
  credits: AiCredits | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { organizations, activeOrgId } = useWorkspace();
  const workspaceName =
    organizations.find((organization) => organization.id === activeOrgId)?.name ?? 'your workspace';

  const [mode, setMode] = useState<StudioMode>(() => {
    const requested = searchParams.get('mode');
    return isStudioMode(requested) ? requested : 'generate';
  });

  // Keep the URL in step without a navigation: a navigation would remount
  // the page and with it a generation in progress.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (mode === 'generate') {
      params.delete('mode');
    } else {
      params.set('mode', mode);
    }
    const query = params.toString();
    const next = `${window.location.pathname}${query ? `?${query}` : ''}`;

    if (`${window.location.pathname}${window.location.search}` !== next) {
      window.history.replaceState(null, '', next);
    }
  }, [mode]);

  const meter = useCredits(initialCredits);
  const credits = (
    <CreditsMeter
      credits={meter.credits}
      failed={meter.failed}
      onRetry={() => void meter.refresh()}
      className="w-full sm:w-72"
    />
  );

  if (status === null || !status.configured) {
    return (
      <Stack gap="lg">
        <PageActions>{credits}</PageActions>
        {status === null ? (
          <ErrorState
            title="The AI service didn't answer"
            description="The API could not say whether a model is configured. Check that it is running, then try again."
            action={{ label: 'Try Again', onClick: () => router.refresh() }}
          />
        ) : (
          <AiUnavailable />
        )}
      </Stack>
    );
  }

  return (
    <Tabs
      value={mode}
      onValueChange={(value) => {
        if (isStudioMode(value)) {
          setMode(value);
        }
      }}
    >
      {/* The page's actions row: the mode on the left, the balance both modes spend on the right. */}
      <PageActions className="items-end justify-between gap-4">
        <TabsList aria-label="Mode" className={cn(SEGMENTED_LIST, 'h-12 w-full sm:w-auto')}>
          <TabsTrigger
            value="generate"
            className={cn(SEGMENTED_TRIGGER, 'h-10 flex-1 gap-2 px-5 sm:flex-none')}
          >
            <MotionIcon icon={SparklesIcon} className="h-4 w-4" />
            Generate
          </TabsTrigger>
          <TabsTrigger
            value="copilot"
            className={cn(SEGMENTED_TRIGGER, 'h-10 flex-1 gap-2 px-5 sm:flex-none')}
          >
            <MotionIcon icon={MessageSquareIcon} className="h-4 w-4" />
            Copilot
          </TabsTrigger>
        </TabsList>
        {credits}
      </PageActions>

      <TabsContent value="generate" forceMount className="mt-8 data-[state=inactive]:hidden">
        <GeneratePanel
          orgId={orgId}
          channels={channels}
          providers={providers}
          status={status}
          credits={meter.credits}
          workspaceName={workspaceName}
          onCredits={meter.apply}
        />
      </TabsContent>
      <TabsContent value="copilot" forceMount className="mt-8 data-[state=inactive]:hidden">
        <CopilotChat orgId={orgId} credits={meter.credits} onCredits={meter.apply} />
      </TabsContent>
    </Tabs>
  );
}
