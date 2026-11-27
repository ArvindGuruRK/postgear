/**
 * The voices on offer (Sprint 13, Module 09) and the scripts a line is
 * written in. The API reads the media service's own list, so its schema must
 * take the shared fixtures Python is tested against.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { makeVoiceSchema } from './clip-voice.schema';
import { textScripts, voiceReads } from './text-script';
import { findVoice, sampleUrlOf, voiceListSchema, voiceViews } from './voices';

const FIXTURES = path.join(__dirname, '../../../../../../packages/media-contract/fixtures/voices');

const fixture = (name: string) =>
  JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8')) as unknown;

describe('the voice lists', () => {
  it.each(readdirSync(FIXTURES).filter((name) => name.endsWith('.json')))(
    "%s parses as the media contract's VoiceList",
    (name) => {
      expect(voiceListSchema.parse(fixture(name))).toEqual(fixture(name));
    },
  );

  it('refuses a path for an id, an unknown language or an extra key', () => {
    const list = voiceListSchema.parse(fixture('kokoro.json'));
    const voice = list.voices[0];
    for (const bad of [
      { ...list, voices: [{ ...voice, id: '../etc' }] },
      { ...list, voices: [{ ...voice, languages: ['fr'] }] },
      { ...list, voices: [{ ...voice, sample: 'x' }] },
      { ...list, extra: true },
    ]) {
      expect(voiceListSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('answers each Kokoro voice with its sample, and a copy the caller may change', () => {
    const { voices } = voiceListSchema.parse(fixture('kokoro.json'));
    const views = voiceViews(voices);
    expect(views[0]).toEqual({
      id: 'kokoro-heart',
      name: 'Heart',
      languages: ['en'],
      sampleUrl: '/clips/voice-samples/kokoro-heart.m4a',
    });
    expect(voiceViews(voiceListSchema.parse(fixture('simulated.json')).voices)[0]?.sampleUrl).toBe(
      null,
    );
    views[0]?.languages.push('ta');
    expect(findVoice(voices, 'kokoro-heart')?.languages).toEqual(['en']);
    expect(findVoice(voices, 'af_heart')).toBeNull();
  });
});

describe('the voice samples', () => {
  const PUBLIC = path.join(__dirname, '../../../../../../apps/web/public');

  it('has a sample file for every Kokoro voice (run `npm run voice:samples` after a change)', () => {
    const { voices } = voiceListSchema.parse(fixture('kokoro.json'));
    for (const voice of voices) {
      const url = sampleUrlOf(voice.id);
      expect(url).not.toBeNull();
      expect(statSync(path.join(PUBLIC, url as string)).size).toBeGreaterThan(5_000);
    }
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

  it('refuses an empty or too long line, a voice id that is not one, a bad revision or an extra key', () => {
    for (const bad of [
      { ...body, text: '  ​ ' },
      { ...body, text: 'x'.repeat(501) },
      { ...body, voiceId: 'af_heart' },
      { ...body, voiceId: '../voices' },
      { ...body, revision: 0 },
      { ...body, revision: 1.5 },
      { ...body, speed: 1 },
      { text: 'Hi', voiceId: 'sim-river' },
    ]) {
      expect(makeVoiceSchema.safeParse(bad).success).toBe(false);
    }
  });
});
