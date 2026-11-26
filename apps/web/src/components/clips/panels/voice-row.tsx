'use client';

/**
 * Text To Speech (Sprint 13, Module 09; blueprint section 7): the Effects
 * tab's last row, shown only while the API says it can run (`ai.voice`,
 * behind `CLIPS_TTS`).
 *
 * A `Textarea` (500 characters), the voices with a play button each (when
 * a voice has a sample), the price from `aiMinutesCost('voice', ...)` on
 * **Make The Voice** (`highlight`), then the job's progress with Cancel.
 * When the job is done the voice goes on the sound row at the playhead
 * (`addMadeVoice`), one undo step.
 */
import {
  Button,
  Label,
  Progress,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
  Spinner,
  Textarea,
} from '@postgear/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { GroupLabel, NOTE } from '@/components/studio/panel-ui';
import { ApiError } from '@/lib/api';
import type { ClipVoiceView } from '@/types/clips';
import type { PlaybackStore } from '../editor/playback';
import { AiMinutesChip } from '../home/clips-meters';
import { TOO_MANY_SOUNDS } from './audio-model';
import {
  addMadeVoice,
  madeVoiceOf,
  VOICE_ADDED,
  VOICE_LANGUAGE_SENTENCE,
  VOICE_MAKING,
  VOICE_NO_OUTPUT,
  VOICE_OFF_NOTE,
  VOICE_PLACEHOLDER,
  VOICE_TEXT_MAX,
  VOICE_UNSAVED,
  voiceButtonLabel,
  voiceCountText,
} from './ai-effects-model';
import {
  type AiEffectsDeps,
  type AiEffectsInput,
  type Problem,
  problemOf,
} from './ai-effects-deps';
import { ProblemAlert } from './bleep-row';
import { PreviewButton } from './sound-rows';

export function VoiceRow({
  input,
  deps,
  playback,
}: {
  input: AiEffectsInput;
  deps: AiEffectsDeps;
  playback: PlaybackStore;
}) {
  const textId = useId();
  const voicesId = useId();
  const [text, setText] = useState('');
  const [voices, setVoices] = useState<ClipVoiceView[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    const abort = new AbortController();
    depsRef.current
      .voices(abort.signal)
      .then((view) => {
        if (abort.signal.aborted) return;
        setEnabled(view.enabled);
        setVoices(view.voices);
        setVoiceId((current) => current ?? view.voices[0]?.id ?? null);
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setProblem(problemOf(cause));
      });
    return () => abort.abort();
  }, []);

  // One sample at a time; leaving the row stops it.
  const stopSample = useRef<(() => void) | null>(null);
  useEffect(() => () => stopSample.current?.(), []);
  const toggleSample = (voice: ClipVoiceView) => {
    stopSample.current?.();
    stopSample.current = null;
    if (playing === voice.id || !voice.sampleUrl) {
      setPlaying(null);
      return;
    }
    setPlaying(voice.id);
    stopSample.current = depsRef.current.playSample(voice.sampleUrl, () => {
      setPlaying((current) => (current === voice.id ? null : current));
    });
  };

  // The job: progress while it runs; done puts the voice at the playhead, once.
  const { job } = deps.useJob(jobId);
  const current = job?.id === jobId ? job : null;
  const finished = useRef<string | null>(null);
  const onEditRef = useRef(input.onEdit);
  onEditRef.current = input.onEdit;
  useEffect(() => {
    if (!current || finished.current === current.id) return;
    if (current.status === 'DONE') {
      finished.current = current.id;
      setJobId(null);
      const made = madeVoiceOf(current);
      if (!made) {
        setProblem({ text: VOICE_NO_OUTPUT, plans: false });
        return;
      }
      const at = playback.getCurrentMs();
      let refused = false;
      onEditRef.current((doc) => {
        const result = addMadeVoice(doc, made, at);
        if (result.ok) return result.doc;
        refused = true;
        return doc;
      }, VOICE_ADDED);
      if (refused) setProblem({ text: TOO_MANY_SOUNDS, plans: false });
    } else if (current.status === 'FAILED') {
      finished.current = current.id;
      setJobId(null);
      setProblem({ text: current.error?.message ?? problemOf(null).text, plans: false });
    } else if (current.status === 'CANCELLED') {
      finished.current = current.id;
      setJobId(null);
    }
  }, [current, playback]);

  const line = text.trim();
  const make = async () => {
    if (line.length === 0 || !voiceId) return;
    setBusy(true);
    setProblem(null);
    try {
      const revision = await input.flushRevision();
      if (revision === null) {
        setProblem({ text: VOICE_UNSAVED, plans: false });
        return;
      }
      const outcome = await deps.makeVoice(input.clipId, { text: line, voiceId, revision });
      // The same line and voice hand back the same finished job (`reused`),
      // so forget the last one or the voice would never be added again.
      finished.current = null;
      setJobId(outcome.job.id);
    } catch (cause) {
      const known =
        cause instanceof ApiError && cause.code === 'voice_language'
          ? { text: VOICE_LANGUAGE_SENTENCE, plans: false }
          : problemOf(cause);
      setProblem(known);
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) {
    return (
      <p className={NOTE} data-testid="clip-voice-off">
        {VOICE_OFF_NOTE}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="clip-voice">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <GroupLabel id={textId}>Words</GroupLabel>
          <span
            className="font-sans text-xs tabular-nums text-ink type-muted"
            data-testid="clip-voice-count"
          >
            {voiceCountText(text.length)}
          </span>
        </div>
        <Textarea
          aria-labelledby={textId}
          placeholder={VOICE_PLACEHOLDER}
          value={text}
          maxLength={VOICE_TEXT_MAX}
          rows={4}
          onChange={(event) => setText(event.target.value.slice(0, VOICE_TEXT_MAX))}
          data-testid="clip-voice-text"
        />
      </div>

      <div className="flex flex-col gap-2">
        <GroupLabel id={voicesId}>Voice</GroupLabel>
        {voices === null ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <RadioGroup
            aria-labelledby={voicesId}
            value={voiceId ?? ''}
            onValueChange={setVoiceId}
            className="flex flex-col gap-1"
            data-testid="clip-voice-list"
          >
            {voices.map((voice) => (
              <VoiceChoice
                key={voice.id}
                voice={voice}
                playing={playing === voice.id}
                onPlay={() => toggleSample(voice)}
              />
            ))}
          </RadioGroup>
        )}
      </div>

      {problem ? (
        <ProblemAlert problem={problem} orgId={input.orgId} testId="clip-voice-problem" />
      ) : null}

      {jobId !== null ? (
        <div className="flex flex-col gap-2" data-testid="clip-voice-progress">
          <Progress tone="ai" value={current?.progress ?? 0} aria-label={VOICE_MAKING} />
          <p className={NOTE}>{current?.stageLabel ?? VOICE_MAKING}</p>
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() => {
              deps.cancelJob(jobId).catch((cause) => setProblem(problemOf(cause)));
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <>
          <Button
            variant="highlight"
            className="w-full"
            disabled={busy || line.length === 0 || !voiceId}
            onClick={() => void make()}
            data-testid="clip-voice-make"
          >
            {busy ? <Spinner /> : null}
            {voiceButtonLabel(line.length)}
          </Button>
          <AiMinutesChip orgId={input.orgId} fallback={null} />
        </>
      )}
    </div>
  );
}

function VoiceChoice({
  voice,
  playing,
  onPlay,
}: {
  voice: ClipVoiceView;
  playing: boolean;
  onPlay: () => void;
}) {
  const id = useId();
  return (
    <div
      className="flex items-center gap-2 rounded-md border-2 border-outline bg-inset px-2 py-1"
      data-testid="clip-voice-choice"
    >
      <RadioGroupItem id={id} value={voice.id} />
      <Label htmlFor={id} className="min-w-0 flex-1 cursor-pointer truncate">
        {voice.name}
      </Label>
      {voice.sampleUrl ? (
        <PreviewButton name={voice.name} playing={playing} onToggle={onPlay} />
      ) : null}
    </div>
  );
}
