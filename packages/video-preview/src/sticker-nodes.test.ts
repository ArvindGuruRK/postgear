import {
  badgeLayout,
  type ClipDocument,
  copyTextStyle,
  createClipDocument,
  frameState,
  type StickerItem,
  type TextItem,
  textStylePreset,
} from '@postgear/video-engine';
import { DomOverlayLayer } from './dom-overlay-layer';
import {
  badgeShapeCss,
  type StickerFrames,
  type StickerPicture,
  stickerBoxCss,
} from './sticker-nodes';

const VIDEO = '6f1c2b1e-8d4a-4c1e-9b7a-2f3e4d5c6b7a';
const LIBRARY_ID = '43c9d3e8-90cf-406d-bf4b-883caad5a985';
const UPDATE = { reason: 'seek' as const, playing: false, scrubbing: false };

function sticker(overrides: Partial<StickerItem> = {}): StickerItem {
  return {
    id: 'stk_a',
    type: 'sticker',
    start: 1_000,
    duration: 3_000,
    anchor: 'moment',
    ref: { library: 'sticker', id: LIBRARY_ID },
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 },
    flipX: false,
    widthPx: 270,
    heightPx: 135,
    loop: true,
    ...overrides,
  } as StickerItem;
}

function text(overrides: Partial<TextItem> = {}): TextItem {
  return {
    id: 'txt_a',
    type: 'text',
    start: 0,
    duration: 9_000,
    anchor: 'moment',
    text: 'Hello',
    style: copyTextStyle(textStylePreset('bold-outline').style),
    transform: { x: 0.5, y: 0.25, scale: 1, rotation: 0, opacity: 1 },
    widthPx: 864,
    fadeInMs: 0,
    fadeOutMs: 0,
    ...overrides,
  };
}

function docWith(items: Array<TextItem | StickerItem>): ClipDocument {
  const doc = createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 10_000, ratio: '9:16' });
  return { ...doc, tracks: [{ id: 'trk_overlay', kind: 'overlay', items }] };
}

const STILL: StickerPicture = {
  fileUrl: 'http://localhost:3001/uploads/library/stickers/aa/aa.png',
  animated: false,
  width: 512,
  height: 256,
  fps: null,
  frames: null,
};
const MOVING: StickerPicture = {
  fileUrl: 'http://localhost:3001/uploads/library/stickers/bb/bb.apng',
  animated: true,
  width: 400,
  height: 200,
  fps: 10,
  frames: 5,
};

/** Decoded frames that remember which frame each draw asked for. */
function fakeFrames(frameCount = 5) {
  const drawn: number[] = [];
  let closed = false;
  let fail = false;
  const frames: StickerFrames = {
    frameCount,
    async draw(index) {
      if (fail) throw new Error('decode');
      drawn.push(index);
    },
    close() {
      closed = true;
    },
  };
  return {
    frames,
    drawn,
    failNext: () => {
      fail = true;
    },
    get closed() {
      return closed;
    },
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function mounted(options: ConstructorParameters<typeof DomOverlayLayer>[0] = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const layer = new DomOverlayLayer(options);
  layer.mount(host);
  const boxOf = (id: string) => host.querySelector<HTMLElement>(`[data-clip-sticker="${id}"]`);
  return { host, layer, boxOf };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('a picture sticker in the preview', () => {
  it('is placed, sized, flipped then turned in canvas pixels, from the frame state', () => {
    const state = frameState(
      docWith([
        sticker({
          transform: { x: 0.25, y: 0.5, scale: 2, rotation: 15, opacity: 0.5 },
          flipX: true,
        }),
      ]),
      1_500,
    );
    expect(stickerBoxCss(state.overlays[0] as never, state.canvas)).toEqual({
      left: '0px',
      top: '825px',
      width: '540px',
      height: '270px',
      transform: 'rotate(15deg) scaleX(-1)',
    });
  });

  it('draws nothing until its file is known, then an <img> that fills the box', () => {
    const { layer, boxOf } = mounted();
    layer.update(
      frameState(
        docWith([sticker({ transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 0.6 } })]),
        1_500,
      ),
      UPDATE,
    );
    const box = boxOf('stk_a') as HTMLElement;
    expect(box.style.visibility).toBe('hidden');
    expect(box.querySelector('img')).toBeNull();

    layer.setStickerPictures(new Map([[`library:${LIBRARY_ID}`, STILL]]));
    const img = box.querySelector('img') as HTMLImageElement;
    expect(img.src).toBe(STILL.fileUrl);
    expect(img.style.width).toBe('100%');
    expect(box.style.visibility).toBe('visible');
    expect(box.style.left).toBe('405px');
    expect(box.style.width).toBe('270px');
    expect(box.style.opacity).toBe('0.6');
  });

  it('shows only inside its window', () => {
    const { layer, boxOf } = mounted();
    layer.setStickerPictures(new Map([[`library:${LIBRARY_ID}`, STILL]]));
    const doc = docWith([sticker()]);
    layer.update(frameState(doc, 500), UPDATE);
    expect(boxOf('stk_a')).toBeNull();
    layer.update(frameState(doc, 2_000), UPDATE);
    expect(boxOf('stk_a')).not.toBeNull();
    layer.update(frameState(doc, 4_000), UPDATE);
    expect(boxOf('stk_a')).toBeNull();
  });

  it('sits under every text, bottom first, as the export overlays pictures before the text layer', () => {
    const { layer, boxOf, host } = mounted();
    layer.setStickerPictures(new Map([[`library:${LIBRARY_ID}`, STILL]]));
    const doc = docWith([text(), sticker(), sticker({ id: 'stk_b' })]);
    layer.update(frameState(doc, 2_000), UPDATE);
    expect((boxOf('stk_a') as HTMLElement).style.zIndex).toBe('-2');
    expect((boxOf('stk_b') as HTMLElement).style.zIndex).toBe('-1');
    expect((host.querySelector('[data-clip-text="txt_a"]') as HTMLElement).style.zIndex).toBe('0');
  });
});

describe('a moving sticker in the preview', () => {
  it('plays as an <img> while it decodes, then shows the frame the export shows at that moment', async () => {
    const fake = fakeFrames();
    const loadFrames = jest.fn(async () => fake.frames);
    const { layer, boxOf } = mounted({ loadFrames });
    layer.setStickerPictures(new Map([[`library:${LIBRARY_ID}`, MOVING]]));
    const doc = docWith([sticker()]);

    layer.update(frameState(doc, 1_250), UPDATE);
    const box = boxOf('stk_a') as HTMLElement;
    expect(box.querySelector('img')).not.toBeNull();
    expect(loadFrames).toHaveBeenCalledWith(MOVING.fileUrl);

    await settle();
    // 250 ms at 10 fps: frame 2.
    expect(fake.drawn).toEqual([2]);
    expect(box.querySelector('img')).toBeNull();
    expect((box.querySelector('canvas') as HTMLCanvasElement).width).toBe(400);
    expect(layer.stickerNode('stk_a')?.frameShown).toBe(2);

    // 730 ms: frame 7 wraps to 2 (already shown, not drawn again); 1 s: frame 10 wraps to 0.
    layer.update(frameState(doc, 1_730), UPDATE);
    layer.update(frameState(doc, 2_000), UPDATE);
    await settle();
    expect(fake.drawn).toEqual([2, 0]);
    expect(loadFrames).toHaveBeenCalledTimes(1);
  });

  it('holds its last frame when it plays once', async () => {
    const fake = fakeFrames();
    const { layer } = mounted({ loadFrames: async () => fake.frames });
    layer.setStickerPictures(new Map([[`library:${LIBRARY_ID}`, MOVING]]));
    const doc = docWith([sticker({ loop: false })]);
    layer.update(frameState(doc, 3_500), UPDATE);
    await settle();
    expect(layer.stickerNode('stk_a')?.frameShown).toBe(4);
  });

  it('stays an <img> where the browser cannot decode it, or a frame fails', async () => {
    const none = mounted({ loadFrames: async () => null });
    none.layer.setStickerPictures(new Map([[`library:${LIBRARY_ID}`, MOVING]]));
    none.layer.update(frameState(docWith([sticker()]), 1_250), UPDATE);
    await settle();
    none.layer.update(frameState(docWith([sticker()]), 1_350), UPDATE);
    expect((none.boxOf('stk_a') as HTMLElement).querySelector('img')).not.toBeNull();
    expect((none.boxOf('stk_a') as HTMLElement).querySelector('canvas')).toBeNull();
    none.layer.destroy();

    const fake = fakeFrames();
    fake.failNext();
    const broken = mounted({ loadFrames: async () => fake.frames });
    broken.layer.setStickerPictures(new Map([[`library:${LIBRARY_ID}`, MOVING]]));
    const doc = docWith([sticker()]);
    broken.layer.update(frameState(doc, 1_250), UPDATE);
    await settle();
    broken.layer.update(frameState(doc, 1_350), UPDATE);
    const box = broken.boxOf('stk_a') as HTMLElement;
    expect(box.querySelector('img')).not.toBeNull();
    expect(box.querySelector('canvas')).toBeNull();
  });

  it('closes the decoded frames when the layer goes', async () => {
    const fake = fakeFrames();
    const { layer } = mounted({ loadFrames: async () => fake.frames });
    layer.setStickerPictures(new Map([[`library:${LIBRARY_ID}`, MOVING]]));
    layer.update(frameState(docWith([sticker()]), 1_250), UPDATE);
    await settle();
    layer.destroy();
    expect(fake.closed).toBe(true);
  });
});

describe('the Follow Badge in the preview', () => {
  const badge = sticker({
    id: 'stk_badge',
    ref: { badge: 'twitch', name: 'rk plays' },
    widthPx: 420,
    heightPx: 140,
    transform: { x: 0.5, y: 0.8, scale: 1.5, rotation: 10, opacity: 1 },
  });

  it('draws the same shapes the ASS file draws, and its two lines as texts', () => {
    const { layer, host } = mounted();
    const doc = docWith([text(), badge]);
    const state = frameState(doc, 2_000);
    layer.update(state, UPDATE);
    const layout = badgeLayout(badge, state.canvas);
    const parts = [...host.querySelectorAll<HTMLElement>('[data-clip-badge="stk_badge"]')];
    expect(parts.map((part) => part.dataset.badgePart)).toEqual(['pill', 'disc', 'mark']);
    const pill = layout.shapes[0];
    expect(parts[0]?.style.left).toBe(badgeShapeCss(pill as never).left);
    expect(parts[0]?.style.borderRadius).toBe(`${(pill as { radius: number }).radius}px`);
    expect(parts[0]?.style.transform).toBe('rotate(10deg)');
    expect(parts[1]?.style.background).toBe('rgb(145, 70, 255)');
    expect(parts[2]?.style.getPropertyValue('clip-path')).toBe('polygon(0 0, 100% 50%, 0 100%)');

    const small = host.querySelector<HTMLElement>(
      '[data-clip-text="stk_badge-small"]',
    ) as HTMLElement;
    const name = host.querySelector<HTMLElement>(
      '[data-clip-text="stk_badge-name"]',
    ) as HTMLElement;
    expect(small.textContent).toBe('Follow On Twitch');
    expect(name.textContent).toBe('rk plays');
    expect(Number(small.style.opacity)).toBeCloseTo(0.78, 5);
    // Track order: the text before it, then the pill, disc, mark and the two lines.
    expect((host.querySelector('[data-clip-text="txt_a"]') as HTMLElement).style.zIndex).toBe('0');
    expect(parts.map((part) => part.style.zIndex)).toEqual(['1', '2', '3']);
    expect([small.style.zIndex, name.style.zIndex]).toEqual(['4', '5']);
  });

  it('leaves the screen with its item, and does not report its lines as texts to measure', () => {
    const onMeasure = jest.fn();
    const { layer, host } = mounted({ onMeasure });
    const doc = docWith([badge]);
    layer.update(frameState(doc, 2_000), UPDATE);
    expect(onMeasure).not.toHaveBeenCalled();
    layer.update(frameState(doc, 5_000), UPDATE);
    expect(host.querySelector('[data-clip-badge]')).toBeNull();
    expect(host.querySelector('[data-clip-text]')).toBeNull();
  });
});
