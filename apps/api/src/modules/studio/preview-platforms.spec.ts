import { IntegrationManager } from '@postgear/social-core';
import { previewPlatforms } from './preview-platforms';

/** The real providers' rules, the ones Send meets in the composer. */
const PROVIDERS = new IntegrationManager().list();

const ids = (format: Parameters<typeof previewPlatforms>[0]) =>
  previewPlatforms(format, PROVIDERS).map((platform) => platform.id);

describe('previewPlatforms', () => {
  it('offers all four frames for the feed shapes every platform takes', () => {
    expect(ids('square')).toEqual(['instagram', 'facebook', 'linkedin', 'x']);
    expect(ids('portrait')).toEqual(['instagram', 'facebook', 'linkedin', 'x']);
    expect(ids('landscape')).toEqual(['instagram', 'facebook', 'linkedin', 'x']);
  });

  it('leaves Instagram out for a story, whose 9:16 shape its feed refuses', () => {
    expect(ids('story')).toEqual(['facebook', 'linkedin', 'x']);
  });

  it("carries each platform's caption limit and how it counts", () => {
    const x = previewPlatforms('square', PROVIDERS).find((platform) => platform.id === 'x');

    expect(x).toMatchObject({ name: 'X', lengthMethod: 'x-weighted' });
    expect(x?.maxLength).toBeGreaterThan(0);
  });

  it('skips a platform that is missing or takes no images', () => {
    const [instagram] = PROVIDERS.filter((provider) => provider.identifier === 'instagram');
    const noImages = {
      identifier: 'facebook',
      rules: { ...instagram.rules, media: { ...instagram.rules.media, maxImages: 0 } },
    };

    expect(previewPlatforms('square', [noImages]).map((platform) => platform.id)).toEqual([]);
    expect(previewPlatforms('square', [])).toEqual([]);
  });
});
