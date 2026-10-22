'use client';

/**
 * The analyze form: one URL, one button, and the price of pressing it.
 *
 * Controlled from the analyzer above it, which keeps the value so "Re-run"
 * on a history row and "Analyze again" on a result can fill and send it.
 * The form validates what the API will certainly refuse with a 400 (not an
 * http/https address) before sending; what it may refuse with a 422 (a
 * private or internal address) is the API's rule, and its message is shown
 * on the same field when it comes back, so the person sees one place for
 * "this URL won't do" whichever side decided it.
 *
 * This is the one surface on the page that carries the full comic treatment
 * (design-system-rules.md §15): a `Card` with its thick border and hard
 * shadow, a `lg` input and a `lg` primary button, because the URL box is the
 * whole product's front door. The crawl is free; the button says what AI
 * advice costs when it is on, and is disabled with the reset date when the
 * balance cannot cover it, since the API would answer 402 anyway.
 */
import { CircleStopIcon } from '@animateicons/react/lucide/circle-stop-icon';
import { SearchIcon } from '@animateicons/react/lucide/search-icon';
import {
  Alert,
  AlertTitle,
  Button,
  Card,
  FormErrorMessage,
  FormField,
  FormHelperText,
  FormLabel,
  Input,
  MotionIcon,
  Text,
} from '@postgear/ui';
import { Code2, Globe } from 'lucide-react';
import { useId, useState } from 'react';
import type { AiCredits } from '@/types/ai';
import type { SeoStatus } from '@/types/seo';
import { formatResetDate } from '../ai/credits-meter';
import { useMounted } from '../posts/use-mounted';
import { isValidUrlInput } from './seo-view-model';

export function AnalyzeForm({
  status,
  credits,
  value,
  running,
  fieldError,
  onChange,
  onAnalyze,
  onStop,
}: {
  status: SeoStatus;
  credits: AiCredits | null;
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
    <Card className="p-5 sm:p-6">
      <form
        aria-label="Analyze a URL"
        className="flex flex-col gap-4"
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <FormField className="min-w-0 flex-1">
            <FormLabel htmlFor={`${id}-url`}>Website URL</FormLabel>
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
              placeholder="https://your-site.com/page"
              variant={shownError ? 'error' : 'default'}
              aria-invalid={shownError ? true : undefined}
              aria-describedby={shownError ? `${id}-error` : `${id}-help`}
              disabled={running}
            />
          </FormField>

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

        {shownError ? (
          <FormErrorMessage id={`${id}-error`} data-testid="seo-form-error">
            {shownError}
          </FormErrorMessage>
        ) : (
          <FormHelperText id={`${id}-help`}>
            Public sites only. Private and internal addresses are refused.
          </FormHelperText>
        )}

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
            AI advice is off in this setup, so recommendations are rule-based, written from the checks
            alone. Set <code className="font-bold">OPENAI_API_KEY</code> or{' '}
            <code className="font-bold">AI_SIMULATION="true"</code> on the API for model-written
            advice.
          </Alert>
        ) : null}

        <Text size="sm" muted as="p" className="inline-flex items-center gap-2">
          {status.browser ? (
            <>
              <Globe className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              Rendering with a headless browser
            </>
          ) : (
            <>
              <Code2 className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              Plain HTML crawl: JavaScript-rendered content isn't seen
            </>
          )}
        </Text>
      </form>
    </Card>
  );
}
