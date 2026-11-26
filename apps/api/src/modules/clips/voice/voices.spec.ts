/**
 * The voices on offer (Sprint 13, Module 09) and the scripts a line is
 * written in. The API's list must be the shared fixture the Python speaker
 * is tested against, so a voice offered is always one that can speak.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { makeVoiceSchema } from './clip-voice.schema';
import { textScripts, voiceReads } from './text-script';
import { findVoice, VOICES, voiceViews } from './voices';

const FIXTURE = path.join(
  __dirname,
  '../../../../../../packages/media-contract/fixtures/voices/simulated.json',
);

describe('the voices', () => {
  it('are the shared fixture, the same list Python speaks', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
      voices: Array<{ id: string; name: string; languages: string[] }>;
    };
    expect(VOICES.map((voice) => ({ ...voice, languages: [...voice.languages] }))).toEqual(
      fixture.voices,
    );
  });

  it('answer with no sample yet, and a copy the caller may change', () => {
    const views = voiceViews();
    expect(views[0]).toEqual({
      id: 'sim-river',
      name: 'River',
      languages: ['en'],
      sampleUrl: null,
    });
    views[0]?.languages.push('ta');
    expect(findVoice('sim-river')?.languages).toEqual(['en']);
    expect(findVoice('af_heart')).toBeNull();
  });
});

describe('textScripts and voiceReads', () => {
  it('tells Latin, Devanagari and Tamil apart, by letters only', () => {
    expect([...textScripts('Wait for it! 123 🔥')]).toEqual(['latin']);
    expect([...textScripts('यह सबसे अच्छा हिस्सा है')]).toEqual(['devanagari']);
    expect([...textScripts('இது சிறந்த பகுதி')]).toEqual(['tamil']);
    expect([...textScripts('Привет')]).toEqual(['other']);
    expect(textScripts('123 !?').size).toBe(0);
  });

  it('a voice reads a line only when it reads every script in it', () => {
    expect(voiceReads(['en'], 'Hello there')).toBe(true);
    expect(voiceReads(['en'], 'Hello यह')).toBe(false);
    expect(voiceReads(['en', 'hi'], 'Hello यह')).toBe(true);
    expect(voiceReads(['en', 'hi'], 'இது')).toBe(false);
    expect(voiceReads(['en'], 'Привет')).toBe(false);
    expect(voiceReads(['en'], '2026!')).toBe(true);
  });
});

describe('makeVoiceSchema', () => {
  const body = { text: 'Wait for it.', voiceId: 'sim-river', revision: 3 };

  it('trims the line and strips control characters before counting', () => {
    expect(makeVoiceSchema.parse({ ...body, text: '  Wait\u0007 for it.  ' }).text).toBe(
      'Wait for it.',
    );
    expect(makeVoiceSchema.parse({ ...body, text: 'x'.repeat(500) }).text).toHaveLength(500);
  });

  it('refuses an empty or too long line, an unknown voice, a bad revision or an extra key', () => {
    for (const bad of [
      { ...body, text: '  ​ ' },
      { ...body, text: 'x'.repeat(501) },
      { ...body, voiceId: 'af_heart' },
      { ...body, revision: 0 },
      { ...body, revision: 1.5 },
      { ...body, speed: 1 },
      { text: 'Hi', voiceId: 'sim-river' },
    ]) {
      expect(makeVoiceSchema.safeParse(bad).success).toBe(false);
    }
  });
});
