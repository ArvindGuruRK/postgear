import { previewSourcesOf } from '../editor/extra-sources';
import { UPLOAD_NOT_VIDEO } from '../home/home-model';
import {
  brandFileProblem,
  brandLengthProblem,
  cleanOutroLine,
  cleanRecipeName,
  kitHref,
  kitTabFrom,
  LOGO_CHOICES,
  recipeCountLine,
} from './kit-model';

describe('kit page model', () => {
  it('reads the tab from the address, Recipes by default', () => {
    expect(kitTabFrom('brand-kit')).toBe('brand-kit');
    expect(kitTabFrom('nope')).toBe('recipes');
    expect(kitTabFrom(undefined)).toBe('recipes');
    expect(kitHref('org 1')).toBe('/org%201/clips/kit');
    expect(kitHref('org-1', 'brand-kit')).toBe('/org-1/clips/kit?tab=brand-kit');
  });

  it('counts recipes against the limit', () => {
    expect(recipeCountLine(3, 50)).toBe('3 of 50 recipes');
  });

  it('keeps names and closing lines to one trimmed line within their limits', () => {
    expect(cleanRecipeName('  Client   A\nShorts ')).toBe('Client A Shorts');
    expect(cleanRecipeName('x'.repeat(80))).toHaveLength(60);
    expect(cleanOutroLine('  Follow \t for more ')).toBe('Follow for more');
    expect(cleanOutroLine('   ')).toBeNull();
    expect(cleanOutroLine('y'.repeat(100))).toHaveLength(80);
  });

  it('offers Off and the four corners in Title Case', () => {
    expect(LOGO_CHOICES.map((choice) => choice.label)).toEqual([
      'Off',
      'Top Left',
      'Top Right',
      'Bottom Left',
      'Bottom Right',
    ]);
  });

  it('checks an intro or outro file before anything is sent', () => {
    expect(brandFileProblem({ name: 'logo.png', type: 'image/png', size: 10 })).toBe(
      UPLOAD_NOT_VIDEO,
    );
    expect(brandFileProblem({ name: 'intro.mp4', type: 'video/mp4', size: 50 * 1024 * 1024 })).toBe(
      null,
    );
    expect(
      brandFileProblem({ name: 'intro.mp4', type: 'video/mp4', size: 50 * 1024 * 1024 + 1 }),
    ).toBe('This video is 51 MB. An intro or outro can be at most 50 MB.');
    expect(brandLengthProblem(5_000)).toBeNull();
    expect(brandLengthProblem(null)).toBeNull();
    expect(brandLengthProblem(5_400)).toBe(
      'This video is 5.4 seconds long. An intro or outro can be at most 5 seconds.',
    );
  });
});

describe('previewSourcesOf (the preview engine extra sources)', () => {
  it('maps each other video to a preview source by its document source id', () => {
    expect(
      previewSourcesOf({
        extraSources: {
          'brand-intro': {
            videoId: 'v-1',
            playback: { url: 'https://space.test/intro.mp4', expiresAt: '2026-11-27T12:00:00Z' },
            proxy: { width: 1280, height: 720, fps: 30 },
            durationMs: 3_000,
          },
          'brand-outro': {
            videoId: 'v-2',
            playback: { url: 'https://space.test/outro.mp4', expiresAt: '2026-11-27T12:00:00Z' },
            proxy: null,
            durationMs: 4_000,
          },
        },
      }),
    ).toEqual({
      'brand-intro': {
        url: 'https://space.test/intro.mp4',
        expiresAt: '2026-11-27T12:00:00Z',
        offsetMs: 0,
        fps: 30,
      },
      'brand-outro': {
        url: 'https://space.test/outro.mp4',
        expiresAt: '2026-11-27T12:00:00Z',
        offsetMs: 0,
        fps: null,
      },
    });
    expect(previewSourcesOf({ extraSources: {} })).toEqual({});
  });
});
