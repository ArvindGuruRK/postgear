import {
  applyLayout,
  type ClipDocument,
  createClipDocument,
  createMontage,
  segmentLayout,
  setCanvasRatio,
} from '@postgear/video-engine';
import {
  applyToPart,
  fromPartView,
  isMontage,
  layoutPartOf,
  partClipTitle,
  partView,
} from './montage-layout';

const VIDEO_A = '3f2a9c1e-0000-4000-8000-00000000000a';
const VIDEO_B = '3f2a9c1e-0000-4000-8000-00000000000b';
const SIZE = { width: 1920, height: 1080 };

function montage(): ClipDocument {
  const result = createMontage(
    [
      {
        id: 'clip-a',
        title: 'Team Talk',
        document: createClipDocument({ videoId: VIDEO_A, fromMs: 0, toMs: 10_000, ratio: '9:16' }),
      },
      {
        id: 'clip-b',
        title: 'Big Play',
        document: createClipDocument({
          videoId: VIDEO_B,
          fromMs: 5_000,
          toMs: 15_000,
          ratio: '9:16',
        }),
      },
    ],
    { transition: 'fade' },
  );
  if (!result.ok) throw new Error(result.code);
  return result.document;
}

describe('the Layout tools on a montage', () => {
  it('knows a montage and its parts', () => {
    const doc = montage();
    const plain = createClipDocument({ videoId: VIDEO_A, fromMs: 0, toMs: 10_000, ratio: '9:16' });
    expect(isMontage(doc)).toBe(true);
    expect(isMontage(plain)).toBe(false);
    expect(layoutPartOf(plain, null)).toBeNull();
    const [first, second] = doc.segments;
    expect(layoutPartOf(doc, null)).toBe(first?.id);
    expect(layoutPartOf(doc, second?.id ?? null)).toBe(second?.id);
    expect(layoutPartOf(doc, 'gone')).toBe(first?.id);
    expect(partClipTitle(doc, second?.id ?? '')).toBe('Big Play');
  });

  it("changes only the picked clip's layout, as one new document", () => {
    const doc = montage();
    const second = doc.segments[1]?.id as string;
    const first = doc.segments[0]?.id as string;
    const before = segmentLayout(doc, first);
    const next = applyToPart(doc, second, (view) => applyLayout(view, 'split', SIZE));
    expect(next).not.toBe(doc);
    expect(segmentLayout(next, second).kind).toBe('split');
    expect(segmentLayout(next, first)).toEqual(before);
    expect(next.layout).toBe(doc.layout);
  });

  it('shows the part view with the part layout, and writes a crop drag back', () => {
    const doc = montage();
    const second = doc.segments[1]?.id as string;
    const view = partView(doc, second);
    expect(view.layout).toEqual(segmentLayout(doc, second));
    expect(fromPartView(doc, second, view)).toBe(doc);
    const dragged = applyLayout(view, 'split', SIZE);
    expect(segmentLayout(fromPartView(doc, second, dragged), second).kind).toBe('split');
  });

  it('applies a change of shape to the whole montage', () => {
    const doc = montage();
    const second = doc.segments[1]?.id as string;
    const next = applyToPart(doc, second, (view) => setCanvasRatio(view, '1:1', SIZE));
    expect(next.canvas.ratio).toBe('1:1');
  });

  it('leaves a clip that is not a montage as it always was', () => {
    const plain = createClipDocument({ videoId: VIDEO_A, fromMs: 0, toMs: 10_000, ratio: '9:16' });
    const next = applyToPart(plain, null, (view) => applyLayout(view, 'split', SIZE));
    expect(next.layout.kind).toBe('split');
    expect(partView(plain, null)).toBe(plain);
  });
});
