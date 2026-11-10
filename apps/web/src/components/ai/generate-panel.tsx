'use client';

/**
 * Generate mode: the form, the run, and the result, wired together.
 *
 * The run is `useGenerateRun`: one `streamEvents` call feeding the reducer,
 * with Stop, and a dropped connection reported as a failure. Discover's
 * Create Post sheet (Sprint 11) runs the same hook.
 *
 * The form's values live here, not in the form, so "Regenerate" on the
 * result sends the request that produced it even if the form has since been
 * edited.
 */
import { Alert } from '@postgear/ui';
import { useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import type { AiCredits, AiStatus, GenerateRequestBody } from '@/types/ai';
import type { Channel, ProviderSummary } from '@/types/channel';
import { AiPanel } from './ai-ui';
import { GenerateForm, TOPIC_MAX } from './generate-form';
import { GeneratePreview } from './generate-preview';
import { GenerateProgress } from './generate-progress';
import { GenerateResult } from './generate-result';
import { hasPartialResult, strictestLimit } from './generate-state';
import { useGenerateRun } from './use-generate-run';

const EMPTY_VALUES: GenerateRequestBody = {
  topic: '',
  tone: 'personal',
  format: 'one_short',
  withImage: false,
  channelIds: [],
};

export function GeneratePanel({
  orgId,
  channels,
  providers,
  status,
  credits,
  workspaceName,
  onCredits,
}: {
  orgId: string;
  channels: Channel[];
  providers: ProviderSummary[];
  status: AiStatus;
  credits: AiCredits | null;
  workspaceName: string;
  onCredits: (credits: AiCredits) => void;
}) {
  const searchParams = useSearchParams();
  const [values, setValues] = useState<GenerateRequestBody>(() => ({
    ...EMPTY_VALUES,
    // Sprint 7: the analytics leaderboard's "Create similar" lands here with
    // the post it wants more of as `?topic=`. Bounded to what the API accepts.
    topic: (searchParams.get('topic') ?? '').slice(0, TOPIC_MAX),
    // One connected channel is the obvious choice; pre-pick it.
    channelIds:
      channels.filter((channel) => channel.health === 'connected').length === 1
        ? channels.filter((channel) => channel.health === 'connected').map((channel) => channel.id)
        : [],
  }));
  const { state, generate, stop } = useGenerateRun(credits, onCredits);

  const limit = useMemo(
    () => strictestLimit(state.request?.channelIds ?? values.channelIds, channels, providers),
    [state.request, values.channelIds, channels, providers],
  );
  const formLimit = useMemo(
    () => strictestLimit(values.channelIds, channels, providers),
    [values.channelIds, channels, providers],
  );

  const regenerate = useCallback(() => {
    void generate(state.request ?? values);
  }, [generate, state.request, values]);

  const showResult = hasPartialResult(state) || state.phase === 'running';

  return (
    // The brief is a narrow column and the post being made gets the room: what
    // comes out is what the person came for. The brief sits in a panel, the
    // output straight on the page ground (the owner's calls, 2026-10-26).
    <div className="grid gap-8 xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] xl:items-start xl:gap-10">
      <div className="flex min-w-0 flex-col gap-4">
        <AiPanel className="p-4 md:p-5">
          <GenerateForm
            orgId={orgId}
            channels={channels}
            status={status}
            credits={credits}
            workspaceName={workspaceName}
            values={values}
            limit={formLimit}
            running={state.phase === 'running'}
            onChange={setValues}
            onGenerate={(request) => void generate(request)}
            onStop={stop}
          />
        </AiPanel>
        {state.error?.beforeStream ? <Alert variant="danger">{state.error.message}</Alert> : null}
      </div>

      {/* Dropped by the panel's padding, so the two columns' first headings line up. */}
      <div className="flex min-w-0 flex-col gap-10 xl:pt-5">
        {state.phase === 'idle' ? (
          <GeneratePreview status={status} />
        ) : (
          <>
            <GenerateProgress state={state} onRetry={regenerate} />
            {showResult ? (
              <GenerateResult orgId={orgId} state={state} limit={limit} onRegenerate={regenerate} />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
