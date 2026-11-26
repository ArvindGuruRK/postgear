/**
 * The sample registry (Sprint 13, Module 01): the generated two-speakers
 * sample, a developer's own sample, and the links that fetch from them.
 */
import { recogniseLink } from '@postgear/video-engine';
import {
  GENERATED_SAMPLES,
  isOwnSample,
  OWN_SAMPLES,
  SAMPLE_NAMES,
  sampleDurationMs,
  sampleFileName,
  samplePlan,
  sampleSpec,
} from './samples';
import { resolveSimulationLink, simulationLinks } from './simulation';

describe('the sample registry', () => {
  it('names the generated samples and the own ones, with no name twice', () => {
    expect(GENERATED_SAMPLES).toEqual(['talk', 'stream', 'two-speakers']);
    expect(OWN_SAMPLES).toEqual(['verideck']);
    expect(new Set(SAMPLE_NAMES).size).toBe(SAMPLE_NAMES.length);
    const files = SAMPLE_NAMES.map(sampleFileName);
    expect(new Set(files).size).toBe(files.length);
    for (const file of files) expect(file).toMatch(/^[a-z0-9-]+\.mp4$/);
  });

  it('answers each sample from the plan', () => {
    expect(sampleSpec('talk')).toMatchObject({ file: 'talk.mp4', durationSec: 180 });
    expect(sampleSpec('two-speakers')).toMatchObject({ file: 'two-speakers.mp4', durationSec: 240 });
    expect(sampleDurationMs('verideck')).toBe(60_000);
    expect(isOwnSample('verideck')).toBe(true);
    expect(isOwnSample('talk')).toBe(false);
  });

  it('keeps an own sample out of the repository: a relative source and a variable to name another', () => {
    const { verideck } = samplePlan().own;
    expect(verideck.envVar).toBe('CLIPS_OWN_SAMPLE');
    for (const source of verideck.sources) {
      expect(source.startsWith('/')).toBe(false);
      expect(source).not.toContain('..');
    }
  });
});

describe('the two-speakers plan', () => {
  const plan = samplePlan().twoSpeakers;

  it('has two speakers on opposite sides whose heads stay inside the picture', () => {
    const [left, right] = plan.speakers;
    expect(left?.centreX).toBeLessThan(0.5);
    expect(right?.centreX).toBeGreaterThan(0.5);
    for (const speaker of plan.speakers) {
      expect(speaker.centreX - speaker.faceWidth / 2).toBeGreaterThan(0);
      expect(speaker.centreX + speaker.faceWidth / 2).toBeLessThan(1);
      expect(speaker.centreY - speaker.faceHeight / 2).toBeGreaterThan(0);
      expect(speaker.centreY + speaker.faceHeight / 2).toBeLessThan(1);
    }
    expect(left?.toneHz).not.toBe(right?.toneHz);
  });

  it('has turns in order that never overlap, take turns, and leave some silences', () => {
    const ids = new Set(plan.speakers.map((speaker) => speaker.id));
    let previousEnd = 0;
    let previousSpeaker = '';
    let longPauses = 0;
    for (const turn of plan.turns) {
      expect(ids.has(turn.speaker)).toBe(true);
      expect(turn.startSec).toBeGreaterThanOrEqual(previousEnd);
      expect(turn.endSec).toBeGreaterThan(turn.startSec);
      expect(turn.speaker).not.toBe(previousSpeaker);
      if (turn.startSec - previousEnd >= 4) longPauses += 1;
      previousEnd = turn.endSec;
      previousSpeaker = turn.speaker;
    }
    expect(previousEnd).toBeLessThanOrEqual(plan.durationSec);
    // Remove Silences needs something to find.
    expect(longPauses).toBeGreaterThanOrEqual(3);
  });
});

describe('the sample links', () => {
  it.each([
    ['https://www.youtube.com/watch?v=simverideck', 'verideck', 60_000],
    ['https://www.youtube.com/watch?v=simtwospkr1', 'two-speakers', 240_000],
  ])('%s fetches the %s sample whole', (url, sample, takeMs) => {
    const link = recogniseLink(url);
    expect('platform' in link).toBe(true);
    if (!('platform' in link)) return;
    const answer = resolveSimulationLink(link);
    expect(answer).toMatchObject({ type: 'video', sample, takeMs });
    if (answer?.type === 'video') {
      expect((answer.probeJson as { duration: number }).duration).toBe(takeMs / 1000);
    }
  });

  it('gives every link with a sample a sample that exists', () => {
    for (const entry of simulationLinks()) {
      if (entry.sample) expect(SAMPLE_NAMES).toContain(entry.sample);
    }
  });
});
