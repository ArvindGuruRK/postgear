'use client';

/**
 * The SEO analyzer: a URL in, a scored audit out, and every audit kept
 * (Sprint 7, user stories 7.1–7.3).
 *
 * ## One island, three concerns
 *
 * The form, the run, and the history are wired together here and nowhere
 * else. The run is one `streamEvents` call feeding the reducer, with an
 * `AbortController` as the Stop button and what unmounting pulls; a stream
 * that closes without a terminal event is reported as a failure rather than
 * left spinning, since the API always ends with `done` or `error`. The
 * history is the list the server sent plus whatever this session produced,
 * prepended as each run's terminal event names it, so the sidebar never
 * waits on a refetch to show the audit that just finished.
 *
 * ## The URL names the audit
 *
 * `?audit=<id>` is set when an audit is shown (a finished run, a history
 * row) through `router.replace` with `scroll: false`, so a reload or a
 * shared link lands on the same audit (the server page loads it) and the
 * page does not jump to the top each time. The replace re-renders the server
 * component, which is harmless: this island keeps its state, and a run in
 * progress keeps streaming.
 *
 * ## What the page shows for each way the API can answer
 *
 * `/seo/status` unanswered is an `ErrorState` with a retry: nothing else can
 * be trusted without it. AI off still analyzes (advice is rule-based, and
 * the form says so). A refusal about the URL (400, 422) goes on the field;
 * every other refusal before the stream (429 busy, 402 out of credits, 503)
 * is an alert under the form, with the reset date when credits are the
 * reason. Mid-stream errors are the progress section's to show.
 */
import { Alert, EmptyState, ErrorState, PageActions, Stack, useToast } from '@postgear/ui';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { streamEvents } from '@/lib/sse';
import type { AiCredits } from '@/types/ai';
import type { SeoAuditDetail, SeoAuditSummary, SeoStatus, SeoStreamEvent } from '@/types/seo';
import { CreditsMeter, formatResetDate } from '../ai/credits-meter';
import { useCredits } from '../ai/use-credits';
import { useMounted } from '../posts/use-mounted';
import { AnalyzeForm } from './analyze-form';
import { AuditHistory } from './audit-history';
import { AuditProgress } from './audit-progress';
import { AuditResult } from './audit-result';
import { DeleteAuditDialog } from './delete-audit-dialog';
import { hasPartialResult, initialSeoState, seoReducer } from './seo-state';
import { groupHistory } from './seo-view-model';

export function SeoAnalyzer({
  status,
  history: initialHistory,
  credits: initialCredits,
  audit: initialAudit,
}: {
  /** Null when `/seo/status` did not answer. */
  status: SeoStatus | null;
  /** Null when `/seo/audits` did not answer; the island fetches it again. */
  history: SeoAuditSummary[] | null;
  /** Null when AI is off or the balance did not load. */
  credits: AiCredits | null;
  /** The audit `?audit=` named, when it loaded. */
  audit: SeoAuditDetail | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const mounted = useMounted();
  const meter = useCredits(initialCredits);

  const [state, dispatch] = useReducer(seoReducer, initialCredits, (credits) =>
    initialAudit
      ? seoReducer(initialSeoState(credits), { type: 'load', audit: initialAudit })
      : initialSeoState(credits),
  );
  const [history, setHistory] = useState<SeoAuditSummary[]>(initialHistory ?? []);
  const [historyFailed, setHistoryFailed] = useState(initialHistory === null);
  const [url, setUrl] = useState(initialAudit?.targetUrl ?? '');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SeoAuditSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const sites = useMemo(() => groupHistory(history), [history]);

  // The server's history request can fail while the API restarts; one retry
  // from the browser is what keeps that from reading as "no audits yet".
  const reloadHistory = useCallback(async () => {
    try {
      const result = await api<{ audits: SeoAuditSummary[] }>('/seo/audits?limit=50');
      setHistory(result.audits);
      setHistoryFailed(false);
    } catch {
      setHistoryFailed(true);
    }
  }, []);

  useEffect(() => {
    if (initialHistory === null) {
      void reloadHistory();
    }
  }, [initialHistory, reloadHistory]);
  const shownAudit = state.detail ?? state.audit;
  const selectedUrl = state.url ?? shownAudit?.targetUrl ?? sites[0]?.targetUrl ?? null;

  const syncAuditParam = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(window.location.search);
      if (id) {
        params.set('audit', id);
      } else {
        params.delete('audit');
      }
      const query = params.toString();
      const next = `${window.location.pathname}${query ? `?${query}` : ''}`;
      if (`${window.location.pathname}${window.location.search}` !== next) {
        router.replace(next, { scroll: false });
      }
    },
    [router],
  );

  const remember = useCallback((audit: SeoAuditSummary) => {
    setHistory((current) => [audit, ...current.filter((item) => item.id !== audit.id)]);
  }, []);

  const analyze = useCallback(
    async (target: string) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      let settled = false;

      setUrl(target);
      dispatch({ type: 'start', url: target });

      try {
        await streamEvents<SeoStreamEvent>(
          '/seo/audits',
          { url: target },
          {
            signal: current.signal,
            onEvent: (event) => {
              dispatch({ type: 'event', event });
              if (event.type === 'done') {
                settled = true;
                remember(event.audit);
                syncAuditParam(event.audit.id);
                if (event.credits) {
                  meter.apply(event.credits);
                }
              } else if (event.type === 'error') {
                settled = true;
                if (event.audit) {
                  remember(event.audit);
                }
                if (event.credits) {
                  meter.apply(event.credits);
                }
              }
            },
          },
        );

        if (!settled) {
          dispatch({
            type: 'fail',
            message: 'The connection closed before the analysis finished. Please try again.',
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
                : 'The analyzer could not be reached. Check your connection and try again.',
            status: cause instanceof ApiError ? cause.status : undefined,
          });
        }
      } finally {
        if (controller.current === current) {
          controller.current = null;
        }
      }
    },
    [meter.apply, remember, syncAuditParam],
  );

  // Leaving the page stops the run; the API aborts the crawl on disconnect.
  useEffect(() => () => controller.current?.abort(), []);

  const stop = useCallback(() => controller.current?.abort(), []);
  const analyzeAgain = useCallback(() => {
    const target = state.url ?? shownAudit?.targetUrl ?? url.trim();
    if (target) {
      void analyze(target);
    }
  }, [analyze, state.url, shownAudit, url]);

  const load = useCallback(
    async (audit: SeoAuditSummary) => {
      if (state.phase === 'running') {
        return;
      }
      setLoadingId(audit.id);
      try {
        const result = await api<{ audit: SeoAuditDetail }>(
          `/seo/audits/${encodeURIComponent(audit.id)}`,
        );
        dispatch({ type: 'load', audit: result.audit });
        setUrl(result.audit.targetUrl);
        syncAuditParam(result.audit.id);
      } catch (cause) {
        toast({
          title: "Couldn't open that audit",
          description:
            cause instanceof ApiError && cause.status === 404
              ? 'It is no longer in the history.'
              : cause instanceof ApiError
                ? cause.message
                : 'Check your connection and try again.',
        });
        if (cause instanceof ApiError && cause.status === 404) {
          setHistory((current) => current.filter((item) => item.id !== audit.id));
        }
      } finally {
        setLoadingId(null);
      }
    },
    [state.phase, syncAuditParam, toast],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleting) {
      return;
    }
    setDeleteBusy(true);
    try {
      await api(`/seo/audits/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' });
      setHistory((current) => current.filter((item) => item.id !== deleting.id));
      dispatch({ type: 'delete', id: deleting.id });
      if (shownAudit?.id === deleting.id) {
        syncAuditParam(null);
      }
      toast({ title: 'Deleted', description: 'The audit is gone from the history.' });
      setDeleting(null);
    } catch (cause) {
      toast({
        title: "Couldn't delete",
        description:
          cause instanceof ApiError ? cause.message : 'Check your connection and try again.',
      });
    } finally {
      setDeleteBusy(false);
    }
  }, [deleting, shownAudit, syncAuditParam, toast]);

  const running = state.phase === 'running';
  const showResult = running || hasPartialResult(state) || shownAudit !== null;
  const blockingError = state.error?.beforeStream && !state.error.onField ? state.error : null;
  const creditsForReset = meter.credits ?? state.credits;

  return (
    <Stack gap="lg">
      {status?.ai ? (
        <PageActions>
          <CreditsMeter
            credits={meter.credits}
            failed={meter.failed}
            onRetry={() => void meter.refresh()}
            className="w-full sm:w-72"
          />
        </PageActions>
      ) : null}

      {status === null ? (
        <ErrorState
          title="The analyzer didn't answer"
          description="The API could not say whether the SEO analyzer is available. Check that it is running, then try again."
          action={{ label: 'Try Again', onClick: () => router.refresh() }}
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:items-start">
          <div className="flex min-w-0 flex-col gap-4">
            <AnalyzeForm
              status={status}
              credits={meter.credits}
              value={url}
              running={running}
              fieldError={state.error?.onField ? state.error.message : null}
              onChange={setUrl}
              onAnalyze={(target) => void analyze(target)}
              onStop={stop}
            />

            {blockingError ? (
              <Alert variant="danger">
                <span>
                  {blockingError.message}
                  {blockingError.kind === 'out_of_credits' && creditsForReset
                    ? ` Credits reset ${mounted ? formatResetDate(creditsForReset.resetsAt) : 'next cycle'}.`
                    : ''}
                </span>
              </Alert>
            ) : null}

            {state.phase === 'idle' ? (
              <EmptyState
                icon={Search}
                title="Your audit will appear here"
                description="Enter a page's address above. The crawl, the four scores and the prioritised fixes show up as each stage finishes, in about half a minute for most sites."
                className="rounded-lg border-2 border-dashed border-outline"
              />
            ) : (
              <>
                <AuditProgress state={state} onRetry={analyzeAgain} />
                {showResult ? (
                  <AuditResult
                    state={state}
                    onAnalyzeAgain={analyzeAgain}
                    onDelete={() => setDeleting(shownAudit)}
                  />
                ) : null}
              </>
            )}
          </div>

          <AuditHistory
            sites={sites}
            selectedUrl={selectedUrl}
            shownAuditId={shownAudit?.id ?? null}
            loadingId={loadingId}
            busy={running}
            failed={historyFailed}
            onRetry={() => void reloadHistory()}
            onSelect={(audit) => void load(audit)}
            onRerun={(target) => {
              setUrl(target);
              void analyze(target);
            }}
          />
        </div>
      )}

      <DeleteAuditDialog
        audit={deleting}
        busy={deleteBusy}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) {
            setDeleting(null);
          }
        }}
        onConfirm={() => void confirmDelete()}
      />
    </Stack>
  );
}
