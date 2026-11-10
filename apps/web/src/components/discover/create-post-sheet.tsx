'use client';

/**
 * Create Post (Sprint 11, blueprint section 5): a right-hand sheet that turns
 * a trend, a story, a Wikipedia article, a video or a festival into a draft
 * with the AI page's own pipeline.
 *
 * The brief is the API's (`item.brief`), shown as it will be sent. The
 * person picks the language (the place's, plus English), the channels, the
 * tone, the format and an optional image, sees the price and the balance,
 * and presses Draft With AI. The request is `POST /ai/generate` with three
 * Sprint 11 fields: `language`, `sources` (the card's own headlines, so the
 * run cites what the person saw and makes no web search of its own) and
 * `publishAt` when a caller dates the post (Module 05's festivals).
 *
 * While it runs, the AI page's progress and result replace the form, through
 * the same reducer and the same streaming hook. Nothing is saved until Open
 * In Composer, so closing the sheet leaves nothing behind (and stops a run).
 * Open In Composer closes the sheet as the composer opens over the page, so
 * closing the composer lands back on the cards, not on a spent result.
 *
 * What the form needs beyond the card (channels, platform rules, whether a
 * model is set up) is asked for on the first open only and kept for the
 * page's life; the balance is asked for on every open, since it moves.
 */
import { CircleStopIcon } from '@animateicons/react/lucide/circle-stop-icon';
import { SparklesIcon } from '@animateicons/react/lucide/sparkles-icon';
import { SlidersHorizontalIcon } from '@animateicons/react/lucide/sliders-horizontal-icon';
import {
  Alert,
  AlertTitle,
  Button,
  ChoiceTiles,
  cn,
  ErrorState,
  FormErrorMessage,
  FormHelperText,
  Label,
  MotionIcon,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Toggle,
} from '@postgear/ui';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { AiStatus, GenerateRequestBody, PostFormat, Tone } from '@/types/ai';
import type { Channel, ProviderSummary } from '@/types/channel';
import type { DiscoverItem, DiscoverItemKind, Locality } from '@/types/discover';
import { AiUnavailable } from '../ai/ai-unavailable';
import { CreditsChip, formatResetDate } from '../ai/credits-meter';
import { GenerateProgress } from '../ai/generate-progress';
import { GenerateResult } from '../ai/generate-result';
import {
  FORMAT_OPTIONS,
  generateCost,
  hasPartialResult,
  strictestLimit,
} from '../ai/generate-state';
import { useCredits } from '../ai/use-credits';
import { useGenerateRun } from '../ai/use-generate-run';
import { ChannelPicker } from '../composer/channel-picker';
import { useMounted } from '../posts/use-mounted';
import { draftLanguages, draftSources, draftTopic } from './discover-model';
import { languageLabel } from './language-names';

/** What a card hands the sheet: the item, and the place and language it was read in. */
export interface CreatePostTarget {
  item: DiscoverItem;
  place: Locality;
  language: string;
  /** When the post is meant to go out (Module 05's Plan A Post); the next full hour without it. */
  publishAt?: string | null;
}

export const SETUP_FAILED_TITLE = 'Your channels could not load';
export const CHANNEL_REQUIRED = 'Choose at least one channel to write for.';
/** A brief longer than this starts folded to five lines. */
const BRIEF_FOLD_AT = 280;

/** What the sheet calls the thing a draft is about, in the page's own words. */
const ITEM_WORDS: Record<DiscoverItemKind, string> = {
  trend: 'trend',
  news: 'story',
  wiki: 'article',
  social: 'topic',
  video: 'video',
  festival: 'festival',
  // Module 07 names its own; until then a competitor's item reads as a story.
  competitor: 'story',
};

const TONE_OPTIONS: readonly { value: Tone; label: string }[] = [
  { value: 'personal', label: 'Personal' },
  { value: 'company', label: 'Company' },
];

interface DraftSetup {
  channels: Channel[];
  providers: ProviderSummary[];
  status: AiStatus;
}

/** The channels, their platforms' rules and the AI status, loaded on the first open. */
function useDraftSetup(active: boolean) {
  const [setup, setSetup] = useState<DraftSetup | null>(null);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  const load = useCallback(async () => {
    started.current = true;
    setFailed(false);
    try {
      const [{ channels }, { providers }, { status }] = await Promise.all([
        api<{ channels: Channel[] }>('/channels'),
        // Without the rules the result just shows no limit, as on the AI page.
        api<{ providers: ProviderSummary[] }>('/channels/providers').catch(() => ({
          providers: [] as ProviderSummary[],
        })),
        api<{ status: AiStatus }>('/ai/status'),
      ]);
      setSetup({ channels, providers, status });
    } catch {
      started.current = false;
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (active && !started.current && !setup) void load();
  }, [active, setup, load]);

  return { setup, failed, retry: load };
}

export function CreatePostSheet({
  orgId,
  target,
  onClose,
}: {
  orgId: string;
  target: CreatePostTarget | null;
  onClose: () => void;
}) {
  const { setup, failed, retry } = useDraftSetup(target !== null);
  const kind = target ? ITEM_WORDS[target.item.kind] : 'story';

  return (
    <Sheet open={target !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent className="max-w-xl overflow-y-auto" data-testid="create-post-sheet">
        <SheetHeader>
          <SheetTitle>Create Post</SheetTitle>
          <SheetDescription>
            Draft a post about this {kind} with AI. Nothing is saved until you open it in the
            composer.
          </SheetDescription>
        </SheetHeader>

        {target === null ? null : setup ? (
          setup.status.configured ? (
            <CreatePostBody
              key={target.item.id}
              orgId={orgId}
              target={target}
              setup={setup}
              onOpened={onClose}
            />
          ) : (
            <AiUnavailable />
          )
        ) : failed ? (
          <ErrorState
            title={SETUP_FAILED_TITLE}
            description="Check that the API is running, then try again."
            action={{ label: 'Try Again', onClick: () => void retry(), variant: 'secondary' }}
          />
        ) : (
          <div className="flex flex-col gap-4" aria-busy="true">
            <Skeleton className="h-24" />
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

interface DraftValues {
  language: string;
  channelIds: string[];
  tone: Tone;
  format: PostFormat;
  withImage: boolean;
}

function CreatePostBody({
  orgId,
  target,
  setup,
  onOpened,
}: {
  orgId: string;
  target: CreatePostTarget;
  setup: DraftSetup;
  onOpened: () => void;
}) {
  const credits = useCredits(null);
  const run = useGenerateRun(null, credits.apply);
  const { state } = run;

  const [values, setValues] = useState<DraftValues>(() => {
    const connected = setup.channels.filter((channel) => channel.health === 'connected');
    return {
      language: target.language,
      // One connected channel is the obvious choice; pre-pick it, as the AI page does.
      channelIds: connected.length === 1 ? [connected[0].id] : [],
      tone: 'personal',
      format: 'one_short',
      withImage: false,
    };
  });

  const limit = useMemo(
    () =>
      strictestLimit(
        state.request?.channelIds ?? values.channelIds,
        setup.channels,
        setup.providers,
      ),
    [state.request, values.channelIds, setup.channels, setup.providers],
  );

  function draft() {
    const sources = draftSources(target.item);
    const request: GenerateRequestBody = {
      topic: draftTopic(target.item),
      tone: values.tone,
      format: values.format,
      withImage: values.withImage,
      channelIds: values.channelIds,
      language: values.language,
      ...(sources.length > 0 ? { sources } : {}),
      ...(target.publishAt ? { publishAt: target.publishAt } : {}),
    };
    void run.generate(request);
  }

  // A refusal before anything streamed goes back to the form. A stream that
  // broke after the hook or the parts arrived keeps them on screen: they may
  // have been paid for, and the reducer keeps them for that reason.
  const showForm =
    state.phase === 'idle' || (Boolean(state.error?.beforeStream) && !hasPartialResult(state));

  if (showForm) {
    return (
      <DraftForm
        orgId={orgId}
        target={target}
        setup={setup}
        credits={credits}
        values={values}
        refusal={state.error?.beforeStream ? state.error.message : null}
        onChange={setValues}
        onSubmit={draft}
      />
    );
  }

  const running = state.phase === 'running';

  /** Try Again and Regenerate: the request that ran, as it was sent. */
  function again() {
    if (state.request) void run.generate(state.request);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        {running ? (
          <Button variant="secondary" onClick={run.stop}>
            <MotionIcon icon={CircleStopIcon} className="h-4 w-4" />
            Cancel
          </Button>
        ) : (
          <Button variant="secondary" onClick={run.reset}>
            <MotionIcon icon={SlidersHorizontalIcon} className="h-4 w-4" />
            Edit Settings
          </Button>
        )}
      </div>
      <GenerateProgress state={state} onRetry={again} />
      {state.error?.beforeStream ? (
        // GenerateProgress shows only errors the stream sent; this one ended it.
        <Alert variant="danger" data-testid="create-post-broken">
          <div className="flex flex-col gap-1">
            <AlertTitle>Generation didn't finish</AlertTitle>
            <span>{state.error.message}</span>
          </div>
        </Alert>
      ) : null}
      {hasPartialResult(state) || running ? (
        <GenerateResult
          orgId={orgId}
          state={state}
          limit={limit}
          publishAt={state.request?.publishAt ?? null}
          onRegenerate={again}
          onOpened={onOpened}
        />
      ) : null}
    </div>
  );
}

function DraftForm({
  orgId,
  target,
  setup,
  credits,
  values,
  refusal,
  onChange,
  onSubmit,
}: {
  orgId: string;
  target: CreatePostTarget;
  setup: DraftSetup;
  credits: ReturnType<typeof useCredits>;
  values: DraftValues;
  /** The API refused before streaming (out of credits, a foreign channel): its sentence. */
  refusal: string | null;
  onChange: (values: DraftValues) => void;
  onSubmit: () => void;
}) {
  const id = useId();
  const mounted = useMounted();
  const [attempted, setAttempted] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const topic = draftTopic(target.item);
  const languages = draftLanguages(target.place, target.language);
  const balance = credits.credits;
  const cost = balance ? generateCost(balance, values.withImage) : null;
  const cannotAfford = balance !== null && cost !== null && balance.remaining < cost;
  const channelError = values.channelIds.length === 0 ? CHANNEL_REQUIRED : null;
  const update = (patch: Partial<DraftValues>) => onChange({ ...values, ...patch });

  return (
    <form
      aria-label="Create a post"
      className="flex flex-col gap-6"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (!channelError && !cannotAfford) onSubmit();
      }}
    >
      <section className="flex flex-col gap-2" aria-labelledby={`${id}-brief`}>
        <span id={`${id}-brief`} className="type-ui text-sm text-ink">
          Brief
        </span>
        <div className="rounded-lg border-2 border-outline bg-inset p-3">
          <p
            dir="auto"
            data-testid="create-post-brief"
            className={cn(
              'm-0 whitespace-pre-wrap break-words font-sans text-sm text-ink',
              !expanded && 'line-clamp-5',
            )}
          >
            {topic}
          </p>
        </div>
        {topic.length > BRIEF_FOLD_AT ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? 'Show Less' : 'Show More'}
          </Button>
        ) : null}
      </section>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-language`}>Language</Label>
        <Select value={values.language} onValueChange={(language) => update({ language })}>
          <SelectTrigger id={`${id}-language`} data-testid="create-post-language">
            <SelectValue>{languageLabel(values.language)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {languages.map((code) => (
              <SelectItem key={code} value={code}>
                {languageLabel(code)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <span className="type-ui text-sm text-ink">Channels</span>
        <ChannelPicker
          orgId={orgId}
          channels={setup.channels}
          selected={values.channelIds}
          onToggle={(channelId) =>
            update({
              channelIds: values.channelIds.includes(channelId)
                ? values.channelIds.filter((item) => item !== channelId)
                : [...values.channelIds, channelId],
            })
          }
        />
        {attempted && channelError ? <FormErrorMessage>{channelError}</FormErrorMessage> : null}
      </div>

      <div className="flex flex-col gap-2">
        <span id={`${id}-tone`} className="type-ui text-sm text-ink">
          Tone
        </span>
        <ChoiceTiles
          labelledBy={`${id}-tone`}
          options={TONE_OPTIONS}
          value={values.tone}
          onValueChange={(tone) => update({ tone })}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span id={`${id}-format`} className="type-ui text-sm text-ink">
          Format
        </span>
        <ChoiceTiles
          labelledBy={`${id}-format`}
          options={FORMAT_OPTIONS}
          value={values.format}
          onValueChange={(format) => update({ format })}
          // Four in a row squeeze each name onto two lines on a phone.
          className="grid-flow-row grid-cols-2 sm:grid-flow-col sm:grid-cols-none"
        />
        <FormHelperText>
          {FORMAT_OPTIONS.find((option) => option.value === values.format)?.hint}
        </FormHelperText>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Label htmlFor={`${id}-image`}>Add an image</Label>
          <FormHelperText>
            {setup.status.images
              ? `${balance?.costs.generate_image ?? 10} more credits.`
              : 'Image generation is not available in this setup.'}
          </FormHelperText>
        </div>
        <Toggle
          id={`${id}-image`}
          checked={values.withImage}
          onCheckedChange={(withImage) => update({ withImage })}
          disabled={!setup.status.images}
        />
      </div>

      {refusal ? <Alert variant="danger">{refusal}</Alert> : null}

      {cannotAfford && balance && cost !== null ? (
        <Alert variant="warning" data-testid="create-post-no-credits">
          <div className="flex flex-col gap-1">
            <AlertTitle>Not enough credits</AlertTitle>
            <span>
              This draft costs {cost} and {balance.remaining}{' '}
              {balance.remaining === 1 ? 'remains' : 'remain'}. Credits reset{' '}
              {mounted ? formatResetDate(balance.resetsAt) : 'next cycle'}
              {values.withImage ? ', or turn the image off.' : '.'}
            </span>
          </div>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <CreditsChip
          credits={balance}
          failed={credits.failed}
          onRetry={() => void credits.refresh()}
          testId="create-post-credits"
        />
        <Button
          type="submit"
          variant="highlight"
          disabled={cannotAfford || setup.channels.length === 0}
        >
          <MotionIcon icon={SparklesIcon} className="h-4 w-4" />
          {cost === null
            ? 'Draft With AI'
            : `Draft With AI (${cost} ${cost === 1 ? 'Credit' : 'Credits'})`}
        </Button>
      </div>
    </form>
  );
}
