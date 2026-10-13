'use client';

/**
 * Generate mode: the form, the run, and the result, wired together.
 *
 * The run is one `streamEvents` call feeding the reducer; an
 * `AbortController` is the Stop button, and also what unmounting pulls. A
 * stream that closes without a terminal event is reported as a failure
 * rather than left spinning — the API always ends with `done` or `error`, so
 * silence means the connection dropped.
 *
 * The form's values live here, not in the form, so "Regenerate" on the
 * result sends the request that produced it even if the form has since been
 * edited.
 */
import { Alert, EmptyState } from '@postgear/ui';
import { Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { streamEvents } from '@/lib/sse';
import type { AiCredits, AiStatus, GenerateRequestBody, GenerateStreamEvent } from '@/types/ai';
import type { Channel, ProviderSummary } from '@/types/channel';
import { GenerateForm } from './generate-form';
import { GenerateProgress } from './generate-progress';
import { GenerateResult } from './generate-result';
import {
  generateReducer,
  hasPartialResult,
  initialGenerateState,
  strictestLimit,
} from './generate-state';

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
  const [values, setValues] = useState<GenerateRequestBody>(() => ({
    ...EMPTY_VALUES,
    // One connected channel is the obvious choice; pre-pick it.
    channelIds:
      channels.filter((channel) => channel.health === 'connected').length === 1
        ? channels.filter((channel) => channel.health === 'connected').map((channel) => channel.id)
        : [],
  }));
  const [state, dispatch] = useReducer(generateReducer, credits, initialGenerateState);
  const controller = useRef<AbortController | null>(null);

  const limit = useMemo(
    () => strictestLimit(state.request?.channelIds ?? values.channelIds, channels, providers),
    [state.request, values.channelIds, channels, providers],
  );
  const formLimit = useMemo(
    () => strictestLimit(values.channelIds, channels, providers),
    [values.channelIds, channels, providers],
  );

  const generate = useCallback(
    async (request: GenerateRequestBody) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      let settled = false;

      dispatch({ type: 'start', request });

      try {
        await streamEvents<GenerateStreamEvent>('/ai/generate', request, {
          signal: current.signal,
          onEvent: (event) => {
            dispatch({ type: 'event', event });
            if (event.type === 'done' || event.type === 'error') {
              settled = true;
              onCredits(event.credits);
            }
          },
        });

        if (!settled) {
          dispatch({
            type: 'fail',
            message: 'The connection closed before the generation finished. Please try again.',
          });
        }
      } catch (cause) {
        if (current.signal.aborted) {
          dispatch({ type: 'abort' });
        } else {
          dispatch({
            type: 'fail',
            message:
              cause instanceof ApiError
                ? cause.message
                : 'The AI service could not be reached. Check your connection and try again.',
            status: cause instanceof ApiError ? cause.status : undefined,
          });
        }
      } finally {
        if (controller.current === current) {
          controller.current = null;
        }
      }
    },
    [onCredits],
  );

  // Leaving the page stops the run; the API aborts the engine on disconnect.
  useEffect(() => () => controller.current?.abort(), []);

  const stop = useCallback(() => controller.current?.abort(), []);
  const regenerate = useCallback(() => {
    void generate(state.request ?? values);
  }, [generate, state.request, values]);

  const showResult = hasPartialResult(state) || state.phase === 'running';

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
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
        {state.error?.beforeStream ? <Alert variant="danger">{state.error.message}</Alert> : null}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {state.phase === 'idle' ? (
          <EmptyState
            icon={Sparkles}
            title="Your post will appear here"
            description="Pick a topic, a voice and the channels. Each stage shows up as it runs — research, a hook, the post, an image."
            className="rounded-lg border-4 border-dashed border-outline"
          />
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
