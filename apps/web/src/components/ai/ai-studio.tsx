'use client';

/**
 * The AI studio: one page, two modes.
 *
 * Generate is a form and a pipeline — a topic in, a researched post out.
 * Copilot is a conversation with an assistant that acts. They share the
 * credits meter in the header and nothing else, so each is its own island
 * below; the mode lives in the URL (`?mode=copilot`) the way the calendar's
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
import {
  ErrorState,
  PageHeader,
  Stack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@postgear/ui';
import { MessageSquare, Sparkles } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AiCredits, AiStatus } from '@/types/ai';
import type { Channel, ProviderSummary } from '@/types/channel';
import { useWorkspace } from '../navigation/workspace-provider';
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

  // Keep the URL in step without a navigation — a navigation would remount
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

  return (
    <Stack gap="lg">
      <PageHeader
        title="AI Copilot"
        description="Research-backed posts from a topic, and an assistant that acts in your workspace. Every call is metered in credits."
        actions={
          <CreditsMeter
            credits={meter.credits}
            failed={meter.failed}
            onRetry={() => void meter.refresh()}
            className="w-full sm:w-72"
          />
        }
      />

      {status === null ? (
        <ErrorState
          title="The AI service didn't answer"
          description="The API could not say whether a model is configured. Check that it is running, then try again."
          action={{ label: 'Try again', onClick: () => router.refresh() }}
        />
      ) : !status.configured ? (
        <AiUnavailable />
      ) : (
        <Tabs
          value={mode}
          onValueChange={(value) => {
            if (isStudioMode(value)) {
              setMode(value);
            }
          }}
        >
          <TabsList aria-label="Mode">
            <TabsTrigger value="generate" className="gap-2">
              <Sparkles className="h-4 w-4" strokeWidth={2.5} />
              Generate
            </TabsTrigger>
            <TabsTrigger value="copilot" className="gap-2">
              <MessageSquare className="h-4 w-4" strokeWidth={2.5} />
              Copilot
            </TabsTrigger>
          </TabsList>

          <TabsContent value="generate" forceMount className="data-[state=inactive]:hidden">
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
          <TabsContent value="copilot" forceMount className="data-[state=inactive]:hidden">
            <CopilotChat orgId={orgId} credits={meter.credits} onCredits={meter.apply} />
          </TabsContent>
        </Tabs>
      )}
    </Stack>
  );
}
