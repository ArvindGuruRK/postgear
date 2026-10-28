import {
  applyPhotoToAllSlides,
  type DesignDocument,
  documentFromPreset,
  paletteForSlide,
  SAFE_PHOTO_OVERLAY,
  type SlideBackground,
  setBackground,
  themeById,
} from '@postgear/design-engine';
import { canApplyPhotoToAll, TINT_OPTIONS, tintOf, tintWords, withTint } from './slide-panel-model';

function design(): DesignDocument {
  let next = 0;
  return documentFromPreset({
    presetId: 'tips-steps-ink',
    format: 'portrait',
    newId: () => `s${++next}`,
  });
}

const PHOTO: SlideBackground = { kind: 'media', mediaId: 'media-1', overlay: 0.6 };

function withPhoto(base: DesignDocument, index: number, photo: SlideBackground = PHOTO) {
  return setBackground(base, base.slides[index].id, photo);
}

describe('tint', () => {
  it('offers Dark and Light, in that order', () => {
    expect(TINT_OPTIONS.map((option) => option.label)).toEqual(['Dark', 'Light']);
  });

  it('reads a photo with no tint as the dark one', () => {
    expect(tintOf(PHOTO)).toBe('dark');
    expect(tintOf({ ...PHOTO, tint: 'light' })).toBe('light');
    expect(tintOf({ kind: 'role', role: 'background' })).toBe('dark');
  });

  it('changes the tint and keeps the photo and its overlay', () => {
    const before = withPhoto(design(), 0, { ...PHOTO, overlay: 0.75 });
    const id = before.slides[0].id;

    const after = withTint(before, id, 'light');

    expect(after.slides[0].background).toEqual({ ...PHOTO, overlay: 0.75, tint: 'light' });
    expect(after.slides[1]).toBe(before.slides[1]);
  });

  it('turns the slide to dark inks under the light tint', () => {
    const before = withPhoto(design(), 0);
    const after = withTint(before, before.slides[0].id, 'light');
    const theme = themeById(after.themeId);

    const dark = paletteForSlide(theme, after.brand.colors, before.slides[0]);
    const light = paletteForSlide(theme, after.brand.colors, after.slides[0]);
    expect(light.text).not.toBe(dark.text);
  });

  it('changes nothing when the tint is already that one, or the slide has no photo', () => {
    const photo = withPhoto(design(), 0);
    expect(withTint(photo, photo.slides[0].id, 'dark')).toBe(photo);

    const plain = design();
    expect(withTint(plain, plain.slides[0].id, 'light')).toBe(plain);
    expect(withTint(plain, 'no-such-slide', 'light')).toBe(plain);
  });

  it('words the slider and its warning for the way the photo is tinted', () => {
    const safe = Math.round(SAFE_PHOTO_OVERLAY * 100);

    expect(tintWords('dark').strength).toBe('Darkening');
    expect(tintWords('dark').fix).toBe('Darken Photo');
    expect(tintWords('dark').warning(safe)).toBe(
      'White text can be hard to read on a light photo. Darken it to at least 60%.',
    );

    expect(tintWords('light').strength).toBe('Lightening');
    expect(tintWords('light').fix).toBe('Lighten Photo');
    expect(tintWords('light').warning(safe)).toBe(
      'Dark text can be hard to read on a dark photo. Lighten it to at least 60%.',
    );
  });
});

describe('canApplyPhotoToAll', () => {
  it('has work while another slide lacks this photo, overlay or tint', () => {
    const photo = withPhoto(design(), 1);
    expect(canApplyPhotoToAll(photo, photo.slides[1].id)).toBe(true);
  });

  it('has none once every slide has it, which is what Apply To All Slides leaves', () => {
    const photo = withPhoto(design(), 1, { ...PHOTO, tint: 'light' });
    const all = applyPhotoToAllSlides(photo, photo.slides[1].id);

    expect(canApplyPhotoToAll(all, all.slides[0].id)).toBe(false);
    // A different tint on one slide is work again.
    const darker = withTint(all, all.slides[2].id, 'dark');
    expect(canApplyPhotoToAll(darker, darker.slides[0].id)).toBe(true);
  });

  it('has none for a slide without a photo, or a design of one slide', () => {
    const plain = design();
    expect(canApplyPhotoToAll(plain, plain.slides[0].id)).toBe(false);

    const one = { ...plain, slides: [plain.slides[0]] };
    expect(canApplyPhotoToAll(withPhoto(one, 0), one.slides[0].id)).toBe(false);
  });
});
