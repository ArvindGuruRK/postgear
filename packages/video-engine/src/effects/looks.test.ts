import { LOOK_COLOURS } from '../document/schema';
import {
  applyLook,
  blendLook,
  composeLooks,
  contrastLook,
  IDENTITY_LOOK,
  LOOK_NAMES,
  LOOK_ORDER,
  LOOK_TARGETS,
  lookMatrix,
  lookSvgValues,
  SEPIA_LOOK,
  saturationLook,
  VIGNETTE_CSS_STOPS,
  vignetteAngle,
  vignetteCss,
  vignetteFactor,
} from './looks';

const FLAT: [number, number, number] = [96, 144, 192];
const round = (c: number[]) => c.map((v) => Math.round(v));

describe('looks', () => {
  it('names every look in Title Case, in the schema order', () => {
    expect(LOOK_ORDER).toEqual(LOOK_COLOURS);
    for (const colour of LOOK_COLOURS) {
      expect(LOOK_NAMES[colour]).toMatch(/^([A-Z][a-z]*)( [A-Z][a-z]*)*$/);
      expect(LOOK_TARGETS[colour]).toHaveLength(3);
    }
  });

  it('draws nothing for None and for Strength 0', () => {
    expect(lookMatrix({ colour: 'none', strength: 1 })).toBeNull();
    expect(lookMatrix({ colour: 'warm', strength: 0 })).toBeNull();
    expect(lookMatrix({ colour: 'warm', strength: Number.NaN })).toBeNull();
    expect(lookSvgValues({ colour: 'sepia', strength: 0 })).toBeNull();
    expect(applyLook(null, FLAT)).toEqual(FLAT);
  });

  it('turns a flat 96,144,192 into the cookbook greys and sepia', () => {
    expect(round(applyLook(lookMatrix({ colour: 'black_white', strength: 1 }), FLAT))).toEqual([
      135, 135, 135,
    ]);
    expect(round(applyLook(lookMatrix({ colour: 'sepia', strength: 1 }), FLAT))).toEqual([
      185, 165, 128,
    ]);
  });

  it('moves in a straight line from the identity with the strength', () => {
    const half = lookMatrix({ colour: 'sepia', strength: 0.5 });
    const full = applyLook(lookMatrix({ colour: 'sepia', strength: 1 }), FLAT);
    const mid = applyLook(half, FLAT);
    for (let i = 0; i < 3; i += 1) {
      expect(mid[i]).toBeCloseTo(((FLAT[i] as number) + (full[i] as number)) / 2, 3);
    }
    expect(blendLook(SEPIA_LOOK, 0)).toEqual(IDENTITY_LOOK);
  });

  it('changes the colour for every look at full strength', () => {
    for (const colour of LOOK_COLOURS) {
      if (colour === 'none') continue;
      const out = applyLook(lookMatrix({ colour, strength: 1 }), FLAT);
      expect(out.some((v, i) => Math.abs(v - (FLAT[i] as number)) > 4)).toBe(true);
    }
  });

  it('clamps once, at the end', () => {
    const bright = lookMatrix({ colour: 'vivid', strength: 1 });
    for (const v of applyLook(bright, [250, 250, 250])) expect(v).toBeLessThanOrEqual(255);
    for (const v of applyLook(bright, [4, 4, 4])) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('composes steps first to last and keeps a grey grey through saturation and contrast', () => {
    const grey: [number, number, number] = [100, 100, 100];
    const both = composeLooks(contrastLook(1.2), saturationLook(1.5));
    const out = applyLook(both, grey);
    expect(out[0]).toBeCloseTo(out[1], 6);
    expect(out[1]).toBeCloseTo(out[2], 6);
    // Contrast about the middle: 100 is below 127.5, so it gets darker.
    expect(out[0]).toBeCloseTo(1.2 * 100 + 0.5 * (1 - 1.2) * 255, 6);
  });

  it('writes the editor matrix as four rows of five, keeping alpha', () => {
    const values = lookSvgValues({ colour: 'black_white', strength: 1 });
    expect(values).toBe('0.3 0.59 0.11 0 0 0.3 0.59 0.11 0 0 0.3 0.59 0.11 0 0 0 0 0 1 0');
    const warm = lookSvgValues({ colour: 'warm', strength: 1 })?.split(' ').map(Number);
    expect(warm).toHaveLength(20);
    expect(warm?.[4]).toBeCloseTo(0.035, 6);
  });
});

describe('vignette', () => {
  it('runs from no angle to a quarter turn', () => {
    expect(vignetteAngle(0)).toBe(0);
    expect(vignetteAngle(1)).toBeCloseTo(Math.PI / 4, 12);
    expect(vignetteAngle(2)).toBeCloseTo(Math.PI / 4, 12);
    expect(vignetteAngle(Number.NaN)).toBe(0);
  });

  it('darkens by cos(angle x d) to the fourth, as FFmpeg does on RGB', () => {
    expect(vignetteFactor(1, 0)).toBe(1);
    expect(vignetteFactor(1, 1)).toBeCloseTo(0.25, 10);
    expect(vignetteFactor(0, 1)).toBe(1);
    // The measured frame: 1080 by 1920, the side at d = 540 / 1101.4 and the top at 960 / 1101.4.
    const half = Math.hypot(540, 960);
    expect(vignetteFactor(1, 540 / half)).toBeCloseTo(0.74, 2);
    expect(vignetteFactor(1, 960 / half)).toBeCloseTo(0.36, 2);
  });

  it('draws the same curve as a gradient to the far corner', () => {
    expect(vignetteCss(0)).toBeNull();
    const css = vignetteCss(1) as string;
    expect(css.startsWith('radial-gradient(circle farthest-corner at 50% 50%, ')).toBe(true);
    expect(css.match(/rgba\(/g)).toHaveLength(VIGNETTE_CSS_STOPS + 1);
    expect(css).toContain('rgba(0, 0, 0, 0) 0%');
    expect(css).toContain('rgba(0, 0, 0, 0.75) 100%');
  });
});
