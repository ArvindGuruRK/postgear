'use client';

/**
 * The analyze bar: one address, one button, and what pressing it costs
 * (revamped 2026-10-23).
 *
 * The page's front door, so it opens the page as a frame-colour panel with a
 * tall field and the primary button, and under them one quiet line: the
 * helper (or the error) on the left, how the page will be fetched and the
 * credits left on the right. The credits used to be a meter alone at the top
 * of the page; here they sit beside the button that spends them.
 *
 * Controlled from the analyzer above it, which keeps the value so "Re-run" on
 * a history row and "Analyze Again" on a result can fill and send it. The form
 * validates what the API will certainly refuse with a 400 (not an http/https
 * address) before sending; what it may refuse with a 422 (a private or
 * internal address) is the API's rule, and its message lands on the same
 * field, so "this URL won't do" has one place whichever side decided it. The
 * crawl is free; the button names the AI advice's price when it is on, and is
 * disabled with the reset date when the balance cannot cover it, since the
 * API would answer 402 anyway.
 */
import { CircleStopIcon } from '@animateicons/react/lucide/circle-stop-icon';
import { SearchIcon } from '@animateicons/react/lucide/search-icon';
import {
  Alert,
  AlertTitle,
  Button,
  FormErrorMessage,
  FormHelperText,
  Input,
  MotionIcon,
} from '@postgear/ui';
import { Code2, Globe } from 'lucide-react';
import { useId, useState } from 'react';
import type { AiCredits } from '@/types/ai';
import type { SeoStatus } from '@/types/seo';
import { CreditsChip, formatResetDate } from '../ai/credits-meter';
import { useMounted } from '../posts/use-mounted';
import { SeoPanel } from './seo-ui';
import { isValidUrlInput } from './seo-view-model';

export function AnalyzeForm({
  status,
  credits,
  creditsFailed,
  onRetryCredits,
  value,
  running,
  fieldError,
  onChange,
  onAnalyze,
  onStop,
}: {
  status: SeoStatus;
  credits: AiCredits | null;
  /** The balance could not be loaded. */
  creditsFailed: boolean;
  onRetryCredits: () => void;
  value: string;
  running: boolean;
  /** The API's refusal of the last submitted URL (400 or 422), if any. */
  fieldError: string | null;
  onChange: (value: string) => void;
  onAnalyze: (url: string) => void;
  onStop: () => void;
}) {
  const id = useId();
  const mounted = useMounted();
  const [attempted, setAttempted] = useState(false);
  // The API's field error is about the URL that was sent; editing it moves on.
  const [submitted, setSubmitted] = useState<string | null>(null);

  const trimmed = value.trim();
  const clientError =
    trimmed.length === 0
      ? 'Enter the address of a page to analyze.'
      : !isValidUrlInput(trimmed)
        ? 'Enter a full address starting with http:// or https://.'
        : null;
  const shownError =
    attempted && clientError ? clientError : fieldError && value === submitted ? fieldError : null;

  const cost = status.ai ? status.adviceCost : 0;
  const cannotAfford = status.ai && credits !== null && cost > 0 && credits.remaining < cost;

  return (
    <SeoPanel className="p-4 sm:p-5">
      <form
        aria-label="Analyze a URL"
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setAttempted(true);
          setSubmitted(value);
          if (!clientError && !running && !cannotAfford) {
            onAnalyze(trimmed);
          }
        }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label htmlFor={`${id}-url`} className="sr-only">
            Website URL
          </label>
          <div className="relative min-w-0 flex-1">
            <Globe
              aria-hidden="true"
              className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink muted-tone"
              strokeWidth={2.5}
            />
            <Input
              id={`${id}-url`}
              data-testid="seo-url"
              type="url"
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              // The URL box is the page's single purpose; landing with the cursor in it is expected.
              autoFocus
              size="lg"
              value={value}
              onChange={(event) => {
                setAttempted(false);
                onChange(event.target.value);
              }}
              placeholder="Enter your website address"
              variant={shownError ? 'error' : 'default'}
              aria-invalid={shownError ? true : undefined}
              aria-describedby={shownError ? `${id}-error` : `${id}-help`}
              disabled={running}
              className="ps-12 shadow-none"
            />
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <Button
              type="submit"
              size="lg"
              data-testid="seo-analyze"
              disabled={running || cannotAfford}
              className="flex-1 sm:flex-none"
            >
              <MotionIcon icon={SearchIcon} className="h-4 w-4" />
              {running
                ? 'Analyzing…'
                : cost > 0
                  ? `Analyze (${cost} ${cost === 1 ? 'Credit' : 'Credits'})`
                  : 'Analyze'}
            </Button>
            {running ? (
              <Button type="button" variant="secondary" size="lg" onClick={onStop}>
                <MotionIcon icon={CircleStopIcon} className="h-4 w-4" />
                Stop
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {shownError ? (
            <FormErrorMessage id={`${id}-error`} data-testid="seo-form-error">
              {shownError}
            </FormErrorMessage>
          ) : (
            <FormHelperText id={`${id}-help`}>
              Public sites only. Private and internal addresses are refused.
            </FormHelperText>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-sans text-xs text-ink">
            <span className="inline-flex items-center gap-1.5 type-muted">
              {status.browser ? (
                <Globe className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              ) : (
                <Code2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              )}
              {status.browser ? 'Rendered in a headless browser' : 'Plain HTML crawl'}
            </span>
            {status.ai ? (
              <CreditsChip
                credits={credits}
                failed={creditsFailed}
                onRetry={onRetryCredits}
                testId="seo-credits"
              />
            ) : null}
          </div>
        </div>

        {cannotAfford && credits ? (
          <Alert variant="warning">
            <div className="flex flex-col gap-1">
              <AlertTitle>Not enough credits for AI advice</AlertTitle>
              <span>
                An analysis costs {cost} and {credits.remaining}{' '}
                {credits.remaining === 1 ? 'remains' : 'remain'}. Credits reset{' '}
                {mounted ? formatResetDate(credits.resetsAt) : 'next cycle'}.
              </span>
            </div>
          </Alert>
        ) : null}

        {!status.ai ? (
          <Alert>
            AI advice is off in this setup, so recommendations are rule-based, written from the
            checks alone. Set <code className="font-bold">OPENAI_API_KEY</code> or{' '}
            <code className="font-bold">AI_SIMULATION="true"</code> on the API for model-written
            advice.
          </Alert>
        ) : null}
      </form>
    </SeoPanel>
  );
}
