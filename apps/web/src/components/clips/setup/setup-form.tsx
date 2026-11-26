'use client';

/**
 * Clip Setup (Sprint 13, Module 05; blueprint section 2): choose the stretch,
 * say what to look for, the kind of video, the length and the shape, and read
 * the price in AI minutes before anything runs.
 *
 * The choices live in one reducer. Every change asks the API for the price
 * again (debounced, never a charge); the summary reads it back line by line
 * and the button carries the total. Too few AI minutes: the button is off and
 * the card says how many are needed and how many are left. **Find Clips**
 * starts the run and goes back to the video page, which follows its progress.
 *
 * Look For Action (Module 06) shows its price before it is switched on, and
 * says so when stills are shown to AI. Switches later modules own (Follow The
 * Speaker, Remove Silences, Hook Title, recipes, brand kits) are not shown
 * until they exist.
 */
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { SparklesIcon } from '@animateicons/react/lucide/sparkles-icon';
import {
  Alert,
  Button,
  MotionIcon,
  PageActions,
  Segmented,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Spinner,
  SummaryBox,
  Textarea,
  Toggle,
} from '@postgear/ui';
import {
  CAPTION_STYLES,
  type ClipLength,
  defaultClipSetup,
  formatClipLength,
  type Genre,
  type Ratio,
  TRANSCRIPT_LANGUAGES,
} from '@postgear/video-engine';
import { TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useReducer, useState } from 'react';
import { AnalyticsPanel, PanelHeader } from '@/components/analytics/analytics-ui';
import { ActionLink } from '@/components/home/home-actions';
import { ApiError } from '@/lib/api';
import { priceClipSetup, startHighlights } from '@/lib/clips-api';
import type { ClipVideoDetail, SetupPriceView } from '@/types/clips';
import { AiMinutesChip } from '../home/clips-meters';
import { clipErrorSentence } from '../library/clip-actions';
import { LanguageSelect } from '../panels/captions-panel';
import {
  GENRE_HELP,
  GENRE_OPTIONS,
  HONEST_LINE,
  ACTION_HELP,
  ACTION_VISION_NOTE,
  actionPriceLabel,
  LENGTH_OPTIONS,
  PAY_FOR_LOOKING,
  priceLines,
  RANGE_HELP,
  REQUEST_EXAMPLES,
  REQUEST_PLACEHOLDER,
  SETUP_RATIOS,
  setupButtonLabel,
  setupReducer,
  shortfallSentence,
  summaryLines,
} from './setup-model';

const NOTE = 'm-0 font-sans text-xs text-ink type-muted';
const LABEL = 'font-sans text-sm font-bold text-ink';
/** The price is asked for again this long after the last change. */
const PRICE_DELAY_MS = 300;

export function SetupForm({
  orgId,
  detail,
  action = { available: false, vision: false },
}: {
  orgId: string;
  detail: ClipVideoDetail;
  /** Module 06: Look For Action can run right now; `vision`: it also shows stills to AI. */
  action?: { available: boolean; vision: boolean };
}) {
  const router = useRouter();
  const { video } = detail;
  const durationMs = video.durationMs ?? 0;
  const [setup, dispatch] = useReducer(setupReducer, durationMs, defaultClipSetup);
  const [price, setPrice] = useState<SetupPriceView | null>(null);
  const [pricing, setPricing] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const ids = {
    language: useId(),
    genre: useId(),
    range: useId(),
    request: useId(),
    length: useId(),
    shape: useId(),
    captions: useId(),
    action: useId(),
    style: useId(),
    summary: useId(),
    look: useId(),
  };
  const videoHref = `/${encodeURIComponent(orgId)}/clips/video/${encodeURIComponent(video.id)}`;

  // The price, again after every change (debounced; never a charge).
  useEffect(() => {
    const abort = new AbortController();
    setPricing(true);
    const timer = setTimeout(() => {
      priceClipSetup(video.id, setup, { signal: abort.signal })
        .then((view) => {
          if (abort.signal.aborted) return;
          setPrice(view);
          setPricing(false);
          setProblem(null);
        })
        .catch((cause) => {
          if (abort.signal.aborted) return;
          setPricing(false);
          setProblem(clipErrorSentence(cause));
        });
    }, PRICE_DELAY_MS);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [setup, video.id]);

  const shortfall = shortfallSentence(price);
  const styleName = useMemo(
    () => CAPTION_STYLES.find((style) => style.id === setup.captions.styleId)?.name ?? null,
    [setup.captions.styleId],
  );

  const start = async () => {
    if (starting || shortfall || !price) return;
    setStarting(true);
    setProblem(null);
    try {
      await startHighlights(video.id, setup);
      router.push(videoHref);
    } catch (cause) {
      setProblem(
        cause instanceof ApiError && cause.code === 'highlights_running'
          ? 'We are already looking for clips in this video.'
          : clipErrorSentence(cause),
      );
      setStarting(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="clip-setup">
      <PageActions className="justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <ActionLink href={videoHref}>
            <MotionIcon icon={ArrowLeftIcon} className="h-4 w-4" />
            Video
          </ActionLink>
          <p
            className="m-0 min-w-0 truncate font-sans text-lg text-ink type-heading"
            title={video.title}
          >
            {video.title}
          </p>
          <span className="shrink-0 font-sans text-sm text-ink type-muted">
            {formatClipLength(durationMs)}
          </span>
        </div>
      </PageActions>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_22rem] items-start gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          <AnalyticsPanel aria-labelledby={ids.range} className="flex flex-col gap-4 p-4">
            <PanelHeader id={ids.range} title="Video" />
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <span id={ids.language} className={LABEL}>
                  Spoken Language
                </span>
                <LanguageSelect
                  value={setup.language}
                  onChange={(language) => dispatch({ type: 'language', language })}
                  labelledBy={ids.language}
                  languages={TRANSCRIPT_LANGUAGES}
                  auto
                />
              </div>
              <div className="flex flex-col gap-2">
                <span id={ids.genre} className={LABEL}>
                  Genre
                </span>
                <Select
                  value={setup.genre}
                  onValueChange={(genre) => dispatch({ type: 'genre', genre: genre as Genre })}
                >
                  <SelectTrigger aria-labelledby={ids.genre} data-testid="clip-setup-genre">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GENRE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className={NOTE}>{GENRE_HELP}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <span className={LABEL}>Range</span>
              <Slider
                value={[setup.range.fromMs, setup.range.toMs]}
                min={0}
                max={Math.max(3_000, durationMs)}
                step={1_000}
                minStepsBetweenThumbs={3}
                thumbs={[
                  { 'aria-label': 'Start', 'aria-valuetext': formatClipLength(setup.range.fromMs) },
                  { 'aria-label': 'End', 'aria-valuetext': formatClipLength(setup.range.toMs) },
                ]}
                onValueChange={([fromMs, toMs]) => {
                  if (fromMs !== undefined && toMs !== undefined) {
                    dispatch({ type: 'range', fromMs, toMs });
                  }
                }}
                data-testid="clip-setup-range"
              />
              <div className="flex justify-between font-sans text-xs tabular-nums text-ink type-muted">
                <span>{formatClipLength(setup.range.fromMs)}</span>
                <span>{formatClipLength(setup.range.toMs)}</span>
              </div>
              <p className={NOTE}>{RANGE_HELP}</p>
            </div>
          </AnalyticsPanel>

          <AnalyticsPanel aria-labelledby={ids.look} className="flex flex-col gap-4 p-4">
            <PanelHeader id={ids.look} title="What To Make" />
            <div className="flex flex-col gap-2">
              <label htmlFor={ids.request} className={LABEL}>
                What should we look for?
              </label>
              <Textarea
                id={ids.request}
                rows={2}
                maxLength={300}
                value={setup.request}
                placeholder={REQUEST_PLACEHOLDER}
                onChange={(event) => dispatch({ type: 'request', request: event.target.value })}
                data-testid="clip-setup-request"
              />
              <p className={NOTE}>
                For example:{' '}
                {REQUEST_EXAMPLES.map((example, index) => (
                  <span key={example}>
                    <button
                      type="button"
                      className="cursor-pointer border-0 bg-transparent p-0 font-sans text-xs text-ink underline"
                      onClick={() => dispatch({ type: 'request', request: example })}
                    >
                      {example}
                    </button>
                    {index < REQUEST_EXAMPLES.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <span id={ids.length} className={LABEL}>
                Clip Length
              </span>
              <Segmented<ClipLength>
                labelledBy={ids.length}
                options={LENGTH_OPTIONS}
                value={setup.length}
                onValueChange={(length) => dispatch({ type: 'length', length })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <span id={ids.shape} className={LABEL}>
                Shape
              </span>
              <Segmented<Ratio>
                labelledBy={ids.shape}
                options={SETUP_RATIOS}
                value={setup.ratio}
                onValueChange={(ratio) => dispatch({ type: 'ratio', ratio })}
              />
            </div>
          </AnalyticsPanel>

          <AnalyticsPanel className="flex flex-col gap-4 p-4">
            <div className="flex items-center gap-3">
              <Toggle
                id={ids.captions}
                checked={setup.captions.on}
                onCheckedChange={(on) => dispatch({ type: 'captions', on })}
                data-testid="clip-setup-captions"
              />
              <label htmlFor={ids.captions} className={`${LABEL} flex-1`}>
                Captions
              </label>
              {setup.captions.on ? (
                <Select
                  value={setup.captions.styleId}
                  onValueChange={(styleId) => dispatch({ type: 'captionStyle', styleId })}
                >
                  <SelectTrigger aria-label="Caption Style" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CAPTION_STYLES.map((style) => (
                      <SelectItem key={style.id} value={style.id}>
                        {style.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
            <p className={NOTE}>
              Every clip opens with captions of what is said, in the style picked.
            </p>
          </AnalyticsPanel>

          {action.available ? (
            <AnalyticsPanel className="flex flex-col gap-4 p-4">
              <div className="flex items-center gap-3">
                <Toggle
                  id={ids.action}
                  checked={setup.action}
                  onCheckedChange={(on) => dispatch({ type: 'action', on })}
                  data-testid="clip-setup-action"
                />
                <label htmlFor={ids.action} className={`${LABEL} flex-1`}>
                  Look For Action
                </label>
                <span className="font-sans text-xs font-bold text-ink type-muted">
                  {actionPriceLabel(setup)}
                </span>
              </div>
              <p className={NOTE}>
                {ACTION_HELP}
                {action.vision ? ` ${ACTION_VISION_NOTE}` : ''}
              </p>
            </AnalyticsPanel>
          ) : null}
        </div>

        <AnalyticsPanel
          aria-labelledby={ids.summary}
          className="sticky top-4 flex flex-col gap-4 p-4"
          data-testid="clip-setup-summary"
        >
          <PanelHeader id={ids.summary} title="Summary" />
          <SummaryBox
            title={summaryLines(setup, styleName)[0]}
            notes={summaryLines(setup, styleName).slice(1)}
            rowsLabel="Price in AI minutes"
            rows={
              price
                ? [
                    ...priceLines(price).map((line) => ({
                      id: line.step,
                      lead: line.name,
                      main: '',
                      end: line.value,
                    })),
                    {
                      id: 'total',
                      lead: <strong>Total</strong>,
                      main: '',
                      end: <strong data-testid="clip-setup-total">{price.total}</strong>,
                    },
                  ]
                : []
            }
          />
          <AiMinutesChip orgId={orgId} fallback={null} />
          {shortfall ? (
            <Alert variant="warning" className="items-center" data-testid="clip-setup-shortfall">
              <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              <p className="m-0 min-w-0 flex-1">{shortfall}</p>
              <ActionLink href={`/${encodeURIComponent(orgId)}/settings/billing`}>
                See Plans
              </ActionLink>
            </Alert>
          ) : null}
          {problem ? (
            <Alert variant="danger" className="items-center" data-testid="clip-setup-problem">
              <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              <p className="m-0 min-w-0 flex-1">{problem}</p>
            </Alert>
          ) : null}
          <Button
            variant="highlight"
            className="w-full"
            disabled={starting || pricing || !price || shortfall !== null}
            onClick={() => void start()}
            data-testid="clip-setup-find"
          >
            {starting ? <Spinner /> : <MotionIcon icon={SparklesIcon} className="h-4 w-4" />}
            {setupButtonLabel(price)}
          </Button>
          <p className={NOTE}>{HONEST_LINE}</p>
          <p className={NOTE}>{PAY_FOR_LOOKING}</p>
        </AnalyticsPanel>
      </div>
    </div>
  );
}
