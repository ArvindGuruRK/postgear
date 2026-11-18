import {
  addSound,
  createClipDocument,
  type LibrarySoundView,
  type SoundUploadView,
} from '@postgear/video-engine';
import {
  detailsLine,
  layerFiles,
  lengthLabel,
  meterPercent,
  meterWarns,
  peaksPath,
  rowSoundInfo,
  rowSoundKey,
  type SoundFileInfo,
  soundInfoOf,
  unknownSoundFiles,
  volumePercent,
} from './audio-model';

const VIDEO = '11111111-1111-4111-8111-111111111111';
const WHOOSH = '5c0e8a52-0000-4000-8000-0000000000a1';
const UPLOAD = '5c0e8a52-0000-4000-8000-0000000000b2';

describe('the Audio tab words', () => {
  it('shows a length as minutes and seconds, never below a second', () => {
    expect(lengthLabel(400)).toBe('0:01');
    expect(lengthLabel(3_200)).toBe('0:03');
    expect(lengthLabel(65_000)).toBe('1:05');
    expect(lengthLabel(null)).toBe('');
  });

  it('names the source, the author and the licence in plain words', () => {
    expect(
      detailsLine({
        source: 'Kenney Impact Sounds',
        author: 'Kenney',
        licence: 'CC0-1.0',
        licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        sourceUrl: 'https://kenney.nl/assets/impact-sounds',
      }),
    ).toBe('From Kenney Impact Sounds by Kenney. CC0, free to use.');
    expect(
      detailsLine({
        source: 'PostGear Sounds',
        author: 'PostGear Sounds',
        licence: 'OWN',
        licenceUrl: '',
        sourceUrl: 'own://whoosh',
      }),
    ).toBe('From PostGear Sounds. Made for PostGear, free to use in your clips.');
  });

  it('reads volumes as percents', () => {
    expect(volumePercent(1.5)).toBe(150);
    expect(volumePercent(3)).toBe(200);
    expect(volumePercent(-1)).toBe(0);
  });
});

describe('the sound files the preview plays', () => {
  const view: LibrarySoundView = {
    id: WHOOSH,
    name: 'Quick Whoosh',
    kind: 'sfx',
    category: 'whooshes',
    tags: ['whoosh'],
    durationMs: 900,
    bpm: null,
    previewUrl: 'https://space.test/whoosh.m4a',
    peaks: [0, 128, 255],
    isFavourite: false,
    credit: null,
    details: {
      source: 'PostGear Sounds',
      author: 'PostGear',
      licence: 'OWN',
      licenceUrl: '',
      sourceUrl: '',
    },
  };
  const upload: SoundUploadView = {
    id: UPLOAD,
    name: 'My Jingle',
    status: 'ready',
    error: null,
    durationMs: 4_000,
    peaks: [10, 20],
    fileUrl: 'https://space.test/private/jingle.m4a',
    createdAt: '2026-11-19T10:00:00.000Z',
  };

  it('knows a row at once, under the key its item will have', () => {
    expect(rowSoundKey(view, 'library')).toBe(`library:${WHOOSH}`);
    expect(rowSoundKey(upload, 'upload')).toBe(`asset:${UPLOAD}`);
    expect(rowSoundInfo(view, 'sfx')).toMatchObject({ fileUrl: view.previewUrl, durationMs: 900 });
    expect(rowSoundInfo(upload, 'sfx')).toMatchObject({
      fileUrl: upload.fileUrl,
      name: 'My Jingle',
    });
  });

  it('asks only for files it does not know, and hands the layer only playable ones', () => {
    let doc = createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 30_000, ratio: '9:16' });
    const one = addSound(doc, { library: 'sound', id: WHOOSH }, 'sfx', 1_000, { durationMs: 900 });
    if (!one.ok) throw new Error('refused');
    const two = addSound(one.doc, { asset: UPLOAD }, 'music', 0, { durationMs: 4_000 });
    if (!two.ok) throw new Error('refused');
    doc = two.doc;
    const known = new Map<string, SoundFileInfo>();
    expect(unknownSoundFiles(doc, known)).toEqual({ library: [WHOOSH], asset: [UPLOAD] });
    known.set(`library:${WHOOSH}`, rowSoundInfo(view, 'sfx'));
    known.set(
      `asset:${UPLOAD}`,
      soundInfoOf({ key: `asset:${UPLOAD}`, missing: true, removed: false }),
    );
    expect(unknownSoundFiles(doc, known)).toEqual({ library: [], asset: [] });
    expect(layerFiles(known)).toEqual([[`library:${WHOOSH}`, view.previewUrl]]);
  });
});

describe('the drawings', () => {
  it('draws the peaks mirrored round the middle, and only the share the file fills', () => {
    expect(peaksPath([0, 255], 100, 20)).toBe('M0 9.5 L100 0 L100 20 L0 10.5 Z');
    expect(peaksPath([255, 255], 100, 20, 0.5)).toBe('M0 0 L50 0 L50 20 L0 20 Z');
    expect(peaksPath([], 100, 20)).toBe('');
    expect(peaksPath(null, 100, 20)).toBe('');
  });

  it('reads the meter on a decibel scale and warns at the top', () => {
    expect(meterPercent(0)).toBe(0);
    expect(meterPercent(1)).toBe(100);
    expect(meterPercent(0.5)).toBe(87);
    expect(meterPercent(0.001)).toBe(0);
    expect(meterWarns(0.99)).toBe(false);
    expect(meterWarns(1.2)).toBe(true);
  });
});
