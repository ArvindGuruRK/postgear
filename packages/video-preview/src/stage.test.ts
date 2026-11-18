import { type ClipDocument, frameState, lookSvgValues } from '@postgear/video-engine';
import { PreviewStage } from './stage';
import { clipOf, part } from './testing';

function docWith(changes: Partial<Pick<ClipDocument, 'zooms' | 'looks' | 'fades'>>): ClipDocument {
  return { ...clipOf([part('a', 10_000, 20_000)]), ...changes };
}

function layerOf(stage: PreviewStage, name: string): HTMLElement {
  return stage.root.querySelector(`[data-preview-layer="${name}"]`) as HTMLElement;
}

describe('PreviewStage: effects', () => {
  it('orders the layers as the export does: picture, look, vignette, overlays, one fade', () => {
    const stage = new PreviewStage(document);
    const frame = layerOf(stage, 'frame');
    expect(frame.parentElement).toBe(stage.root);
    expect([...frame.children].map((el) => (el as HTMLElement).dataset.previewLayer)).toEqual([
      'looks',
      'vignette',
      'overlays',
    ]);
    expect(stage.looks.firstElementChild).toBe(stage.zoom);
    const filter = stage.root.querySelector('filter') as Element;
    expect(filter.id).toBe(stage.lookFilterId);
    expect(filter.getAttribute('color-interpolation-filters')).toBe('sRGB');
    expect(new PreviewStage(document).lookFilterId).not.toBe(stage.lookFilterId);
  });

  it('scales the picture about the focus while a zoom is on, and only then', () => {
    const stage = new PreviewStage(document);
    const doc = docWith({
      zooms: [
        {
          id: 'z',
          source: 'src',
          from: 12_000,
          to: 14_000,
          scale: 2,
          focus: { x: 0.25, y: 0.75 },
          ease: 300,
        },
      ],
    });
    stage.syncEffects(frameState(doc, 3_000));
    expect(stage.zoom.style.transform).toBe('scale(2)');
    expect(stage.zoom.style.transformOrigin).toBe('25% 75%');

    // Halfway into the ease: smoothstep at a half is a half.
    stage.syncEffects(frameState(doc, 2_150));
    expect(stage.zoom.style.transform).toBe('scale(1.5)');

    stage.syncEffects(frameState(doc, 5_000));
    expect(stage.zoom.style.transform).toBe('');
  });

  it('points the look wrapper at a colour matrix with the look numbers', () => {
    const stage = new PreviewStage(document);
    const looks = { colour: 'sepia' as const, strength: 0.6, vignette: 0 };
    stage.syncEffects(frameState(docWith({ looks }), 1_000));
    expect(stage.looks.style.filter).toBe(`url(#${stage.lookFilterId})`);
    const matrix = stage.root.querySelector('feColorMatrix') as Element;
    expect(matrix.getAttribute('type')).toBe('matrix');
    expect(matrix.getAttribute('values')).toBe(lookSvgValues(looks));

    stage.syncEffects(
      frameState(docWith({ looks: { colour: 'sepia', strength: 0, vignette: 0 } }), 1_000),
    );
    expect(stage.looks.style.filter).toBe('');
  });

  it('shows the vignette only when it is on', () => {
    const stage = new PreviewStage(document);
    expect(stage.vignette.style.display).toBe('none');
    stage.syncEffects(
      frameState(docWith({ looks: { colour: 'none', strength: 0, vignette: 0.5 } }), 1_000),
    );
    expect(stage.vignette.style.display).toBe('block');
    stage.syncEffects(
      frameState(docWith({ looks: { colour: 'none', strength: 0, vignette: 0 } }), 1_000),
    );
    expect(stage.vignette.style.display).toBe('none');
  });

  it('fades the whole frame, overlays included, with the clip fade', () => {
    const stage = new PreviewStage(document);
    const doc = docWith({ fades: { inMs: 1_000, outMs: 2_000 } });
    stage.syncEffects(frameState(doc, 500));
    expect(Number(stage.frame.style.opacity)).toBeCloseTo(0.5, 6);
    expect(stage.overlayHost.parentElement).toBe(stage.frame);
    stage.syncEffects(frameState(doc, 5_000));
    expect(stage.frame.style.opacity).toBe('');
    stage.syncEffects(frameState(doc, 9_000));
    expect(Number(stage.frame.style.opacity)).toBeCloseTo(0.5, 6);
  });
});
