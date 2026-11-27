/**
 * The Layouts tab's Brand Kit section (Sprint 13, Module 10): picking a kit
 * is one undo step that brings its logo, intro and outro; each switch is one
 * step; None takes the kit off; the outro card says where it shows.
 */
import { TooltipProvider } from '@postgear/ui';
import {
  brandPartsOf,
  type ClipBrandKit,
  type ClipDocument,
  createClipDocument,
} from '@postgear/video-engine';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import type { ClipBrandKitView } from '@/types/clips-recipes';
import { BrandKitSection } from './brand-kit-section';
import { NO_BRAND_KITS, OUTRO_CARD_PREVIEW_NOTE } from './brand-kit-model';
import type { LayoutEdit } from './layouts-panel';

jest.mock('@/lib/clips-recipes-api', () => ({
  listClipBrandKits: jest.fn(),
  useClipBrandKit: jest.fn(),
}));
jest.mock('@/lib/clips-api', () => ({ listCaptionStyles: jest.fn() }));
const toast = jest.fn();
jest.mock('@postgear/ui', () => ({
  ...jest.requireActual('@postgear/ui'),
  toast: (input: unknown) => toast(input),
}));

const api = jest.requireMock('@/lib/clips-recipes-api') as Record<string, jest.Mock>;
const clipsApi = jest.requireMock('@/lib/clips-api') as Record<string, jest.Mock>;

const VIDEO = '3f2a9c1e-0000-4000-8000-000000000001';
const KIT_ID = '7b0c9d2e-0000-4000-8000-000000000010';
const LOGO = '7b0c9d2e-0000-4000-8000-000000000020';
const INTRO = '7b0c9d2e-0000-4000-8000-000000000030';

const ENGINE_KIT: ClipBrandKit = {
  id: KIT_ID,
  name: 'Acme Kit',
  logo: { assetId: LOGO, width: 400, height: 400 },
  logoPosition: 'top-right',
  captionStyleId: null,
  intro: { videoId: INTRO, durationMs: 3_000, width: 1920, height: 1080 },
  outro: { kind: 'card', text: 'Follow for more', background: '#111111', colour: '#ffffff' },
};

const KIT_VIEW: ClipBrandKitView = {
  id: KIT_ID,
  name: 'Acme Kit',
  logoUrl: 'https://space.test/logo.png',
  colors: {
    primary: '#111111',
    secondary: '#222222',
    accent: '#333333',
    background: '#111111',
    text: '#ffffff',
  },
  clipLogoPosition: 'top-right',
  clipCaptionStyleId: null,
  intro: null,
  outro: { kind: 'card', text: 'Follow for more' },
};

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
  Element.prototype.scrollIntoView = jest.fn();
  Element.prototype.hasPointerCapture = jest.fn(() => false);
  Element.prototype.releasePointerCapture = jest.fn();
});

beforeEach(() => {
  for (const mock of [...Object.values(api), ...Object.values(clipsApi)]) mock.mockReset();
  api.listClipBrandKits.mockResolvedValue({ brandKits: [KIT_VIEW] });
  api.useClipBrandKit.mockResolvedValue(ENGINE_KIT);
  clipsApi.listCaptionStyles.mockResolvedValue({
    styles: [],
    defaultStyleId: 'clean',
    own: 0,
    limit: 30,
  });
  toast.mockClear();
});

function clip(): ClipDocument {
  return {
    ...createClipDocument({ videoId: VIDEO, fromMs: 10_000, toMs: 40_000, ratio: '9:16' }),
    meta: { shapeChosen: true },
  };
}

async function renderSection(initial: ClipDocument = clip()) {
  const state = { doc: initial, steps: 0 };
  const spoken: string[] = [];
  function Host() {
    const [doc, setDoc] = useState(initial);
    state.doc = doc;
    const edit: LayoutEdit = (change, sentence) => {
      const next = change(state.doc);
      if (next === state.doc) return;
      state.steps += 1;
      spoken.push(sentence);
      setDoc(next);
    };
    return <BrandKitSection document={doc} onEdit={edit} />;
  }
  render(
    <TooltipProvider>
      <Host />
    </TooltipProvider>,
  );
  await act(async () => undefined);
  return { state, spoken };
}

async function pickKit(name: string) {
  const trigger = screen.getByTestId('clip-brand-kit-select');
  await waitFor(() => expect(trigger).not.toBeDisabled());
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const option = await screen.findByRole('option', { name });
  await act(async () => {
    fireEvent.keyDown(option, { key: 'Enter' });
  });
}

describe('BrandKitSection', () => {
  it('says where kits are made when the workspace has none', async () => {
    api.listClipBrandKits.mockResolvedValue({ brandKits: [] });
    await renderSection();
    expect(await screen.findByText(NO_BRAND_KITS)).toBeInTheDocument();
  });

  it('applies a picked kit as one undo step: logo, intro and the outro card', async () => {
    const { state, spoken } = await renderSection();
    await pickKit('Acme Kit');
    await waitFor(() => expect(state.steps).toBe(1));
    expect(api.useClipBrandKit).toHaveBeenCalledWith(KIT_ID);
    expect(brandPartsOf(state.doc)).toEqual({
      kitId: KIT_ID,
      logo: true,
      intro: true,
      outro: true,
    });
    expect(spoken).toEqual(['Acme Kit applied.']);
    // The switches show for the parts the kit has, all on.
    expect(screen.getByTestId('clip-brand-logo')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('clip-brand-intro')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('clip-brand-outro')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Card')).toBeInTheDocument();
    expect(screen.getByText(OUTRO_CARD_PREVIEW_NOTE)).toBeInTheDocument();
  });

  it('switches one part off as one step and keeps the others', async () => {
    const { state, spoken } = await renderSection();
    await pickKit('Acme Kit');
    await waitFor(() => expect(state.steps).toBe(1));
    fireEvent.click(screen.getByTestId('clip-brand-intro'));
    expect(state.steps).toBe(2);
    expect(brandPartsOf(state.doc)).toEqual({
      kitId: KIT_ID,
      logo: true,
      intro: false,
      outro: true,
    });
    expect(spoken.at(-1)).toBe('Intro off.');
    expect(screen.getByTestId('clip-brand-intro')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByTestId('clip-brand-intro'));
    expect(state.steps).toBe(3);
    expect(brandPartsOf(state.doc).intro).toBe(true);
  });

  it('takes the kit off with None, back to the clip it was', async () => {
    const start = clip();
    const { state, spoken } = await renderSection(start);
    await pickKit('Acme Kit');
    await waitFor(() => expect(state.steps).toBe(1));
    await pickKit('None');
    expect(state.steps).toBe(2);
    expect(brandPartsOf(state.doc)).toEqual({
      kitId: null,
      logo: false,
      intro: false,
      outro: false,
    });
    expect(state.doc.segments).toEqual(start.segments);
    expect(spoken.at(-1)).toBe('Brand kit removed.');
    expect(screen.queryByTestId('clip-brand-logo')).toBeNull();
  });

  it('reads a clip that already wears the kit, asking for the kit once for its switches', async () => {
    const { applyBrandKit } = jest.requireActual('@postgear/video-engine');
    const worn = applyBrandKit(clip(), ENGINE_KIT, { intro: false });
    await renderSection(worn);
    expect(await screen.findByTestId('clip-brand-intro')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('clip-brand-logo')).toHaveAttribute('aria-checked', 'true');
    expect(api.useClipBrandKit).toHaveBeenCalledTimes(1);
  });

  it('says so in a toast when the kit cannot be used, and changes nothing', async () => {
    const { ApiError } = jest.requireActual('@/lib/api');
    api.useClipBrandKit.mockRejectedValue(new ApiError('That brand kit was deleted.', 404));
    const { state } = await renderSection();
    await pickKit('Acme Kit');
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: 'That brand kit was deleted.',
        variant: 'danger',
      }),
    );
    expect(state.steps).toBe(0);
  });
});
