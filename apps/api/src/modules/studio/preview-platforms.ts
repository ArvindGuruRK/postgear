/**
 * The platform frames Preview offers for a design (DS-7.1: "only those that
 * fit the format").
 *
 * Decided by the composer's own rules, the ones Send meets, rather than by a
 * second list in the web app: a platform that cannot take an image of the
 * format's shape is not offered, because a preview of a post the composer
 * would then refuse is a promise PostGear cannot keep. Instagram's feed, for
 * one, refuses a 9:16 story-shaped image.
 *
 * The editor and the public share page both get the answer from the API, so
 * there is one copy of the decision.
 */
import { type FormatId, formatSpec } from '@postgear/design-engine';
import type { ProviderSummary } from '@postgear/social-core';
import type { PreviewPlatform, PreviewPlatformId } from './studio.types';

/** The frames Studio draws, in the order the switch lists them. */
const FRAMES: ReadonlyArray<{ id: PreviewPlatformId; name: string }> = [
  { id: 'instagram', name: 'Instagram' },
  { id: 'facebook', name: 'Facebook' },
  { id: 'linkedin', name: 'LinkedIn' },
  { id: 'x', name: 'X' },
];

export function previewPlatforms(
  format: FormatId,
  providers: Pick<ProviderSummary, 'identifier' | 'rules'>[],
): PreviewPlatform[] {
  const spec = formatSpec(format);
  const shape = spec.width / spec.height;

  return FRAMES.flatMap((frame) => {
    const rules = providers.find((provider) => provider.identifier === frame.id)?.rules;
    if (!rules || rules.media.maxImages === 0) return [];

    const range = rules.media.imageAspectRatio;
    if (range && (shape < range.min || shape > range.max)) return [];

    return [
      {
        id: frame.id,
        name: frame.name,
        maxLength: rules.maxLength,
        lengthMethod: rules.lengthMethod,
      },
    ];
  });
}
