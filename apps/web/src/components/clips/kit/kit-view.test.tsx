/**
 * Recipes And Brand Kit (Sprint 13, Module 10): the kit page's two tabs, the
 * starter cards (read-only, with Duplicate), Rename and the red Delete
 * Recipe confirm, the limit line, the intro's upload limits (a 6 second file
 * and a 60 MB file are refused in one sentence before anything is sent), a
 * good intro saved once ready, and the outro card's line saved.
 */
import { TooltipProvider } from '@postgear/ui';
import type { RecipeView } from '@postgear/video-engine';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import type { ClipBrandKitView, RecipesView } from '@/types/clips-recipes';
import { fixtureVideo } from '../clips-fixtures';
import type { UploadTransport } from '../home/video-uploader';
import { brandVideoTooBig, brandVideoTooLong, deleteRecipeSentence } from './kit-model';
import { KitView } from './kit-view';
import type { BrandUploadDeps } from './use-brand-video-upload';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const push = jest.fn();
jest.mock('next/navigation', () => ({
  ...jest.requireActual('next/navigation'),
  useRouter: () => ({ push, replace: jest.fn(), refresh: jest.fn() }),
}));
jest.mock('@/lib/clips-recipes-api', () => ({
  listRecipes: jest.fn(),
  duplicateRecipe: jest.fn(),
  updateRecipe: jest.fn(),
  deleteRecipe: jest.fn(),
  listClipBrandKits: jest.fn(),
  updateClipBrandKit: jest.fn(),
  useClipBrandKit: jest.fn(),
}));
jest.mock('@/lib/clips-api', () => ({
  listCaptionStyles: jest.fn(),
  getVideo: jest.fn(),
}));
jest.mock('@postgear/video-engine', () => ({
  ...jest.requireActual('@postgear/video-engine'),
  starterRecipe: (id: string) =>
    id === 'starter-captions-only' ? { id, help: 'Adds captions and nothing else' } : null,
}));
const toast = jest.fn();
jest.mock('@postgear/ui', () => ({
  ...jest.requireActual('@postgear/ui'),
  toast: (input: unknown) => toast(input),
}));

const api = jest.requireMock('@/lib/clips-recipes-api') as Record<string, jest.Mock>;
const clipsApi = jest.requireMock('@/lib/clips-api') as Record<string, jest.Mock>;

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});

beforeEach(() => {
  for (const mock of [...Object.values(api), ...Object.values(clipsApi)]) mock.mockReset();
  clipsApi.listCaptionStyles.mockResolvedValue({
    styles: [
      { id: 'clean', name: 'Clean', hint: '', builtIn: true, look: {} },
      { id: 'bold-pop', name: 'Bold Pop', hint: '', builtIn: true, look: {} },
    ],
    defaultStyleId: 'clean',
    own: 0,
    limit: 30,
  });
  toast.mockClear();
  push.mockClear();
  window.history.replaceState(null, '', '/org-1/clips/kit');
});

function recipe(id: string, name: string, extra: Partial<RecipeView> = {}): RecipeView {
  return {
    id,
    name,
    description: `${name} line`,
    settings: { version: 1 },
    builtIn: false,
    brandKitId: null,
    createdById: 'user-1',
    createdByName: 'Priya',
    createdAt: '2026-11-27T10:00:00.000Z',
    updatedAt: '2026-11-27T10:00:00.000Z',
    ...extra,
  };
}

const STARTER_NAMES = [
  ['starter-clean-up-recording', 'Clean Up Recording'],
  ['starter-auto-edit-talking-video', 'Auto-Edit Talking Video'],
  ['starter-captions-only', 'Captions Only'],
  ['starter-reframe', 'Reframe'],
  ['starter-social-edit', 'Social Edit'],
] as const;

function recipesView(own: RecipeView[] = [], max = 50): RecipesView {
  return {
    recipes: [
      ...STARTER_NAMES.map(([id, name]) =>
        recipe(id, name, { builtIn: true, createdById: null, createdByName: null }),
      ),
      ...own,
    ],
    own: own.length,
    max,
  };
}

function kit(extra: Partial<ClipBrandKitView> = {}): ClipBrandKitView {
  return {
    id: 'kit-1',
    name: 'Acme Kit',
    logoUrl: 'https://space.test/logo.png',
    colors: {
      primary: '#111111',
      secondary: '#222222',
      accent: '#333333',
      background: '#ffffff',
      text: '#000000',
    },
    clipLogoPosition: null,
    clipCaptionStyleId: null,
    intro: null,
    outro: null,
    ...extra,
  };
}

function fakeUpload(durationMs: number | null): BrandUploadDeps & { transport: UploadTransport } {
  const transport: UploadTransport = {
    start: jest.fn(async () => ({
      videoId: 'intro-video',
      uploadId: 'upload-1',
      partSize: 1024,
      partCount: 1,
    })),
    sign: jest.fn(async (_id: string, parts: number[]) =>
      parts.map((partNumber) => ({ partNumber, url: `https://space.test/${partNumber}` })),
    ),
    put: jest.fn(async (_url: string, body: Blob, onProgress: (loaded: number) => void) => {
      onProgress(body.size);
      return 'etag-1';
    }),
    complete: jest.fn(async () => ({ video: fixtureVideo(), job: null })),
    cancel: jest.fn(async () => ({})),
    readDuration: jest.fn(async () => null),
    isOnline: () => true,
    onOnline: () => () => undefined,
    wait: jest.fn(async () => undefined),
  };
  return {
    transport,
    readDuration: jest.fn(async () => durationMs),
    getVideo: jest.fn(async () => ({
      video: { ...fixtureVideo(), id: 'intro-video', status: 'READY' as const },
    })) as unknown as BrandUploadDeps['getVideo'],
    pollMs: 0,
  };
}

function videoFile(bytes = 2048, name = 'intro.mp4'): File {
  const file = new File([new Uint8Array(16)], name, { type: 'video/mp4' });
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
}

async function renderKit(
  props: Partial<React.ComponentProps<typeof KitView>> & {
    recipes?: RecipesView | null;
    kits?: ClipBrandKitView[] | null;
  } = {},
) {
  const { recipes = recipesView(), kits = [kit()], ...rest } = props;
  const view = render(
    <TooltipProvider>
      <KitView
        orgId="org-1"
        initialTab="recipes"
        initialRecipes={recipes}
        initialKits={kits}
        {...rest}
      />
    </TooltipProvider>,
  );
  // The caption styles the Brand Kit cards read on their own.
  await act(async () => undefined);
  return view;
}

function openTab(name: string) {
  const tab = screen.getByRole('tab', { name });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
}

describe('KitView: the page', () => {
  it('opens on Recipes with Back To Clips, and remembers the Brand Kit tab in the address', async () => {
    await renderKit();
    expect(screen.getByRole('link', { name: /Back To Clips/ })).toHaveAttribute(
      'href',
      '/org-1/clips',
    );
    expect(screen.getByRole('tab', { name: 'Recipes' })).toHaveAttribute('aria-selected', 'true');
    openTab('Brand Kit');
    expect(screen.getByRole('tab', { name: 'Brand Kit' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(window.location.search).toBe('?tab=brand-kit'));
    openTab('Recipes');
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('asks for the recipes itself when the server could not, with Try Again on a failure', async () => {
    api.listRecipes.mockRejectedValueOnce(new Error('down'));
    api.listRecipes.mockResolvedValueOnce(recipesView());
    await renderKit({ recipes: null });
    const failed = await screen.findByTestId('clip-kit-recipes-failed');
    fireEvent.click(within(failed).getByRole('button', { name: 'Try Again' }));
    expect(await screen.findAllByTestId('clip-kit-starter')).toHaveLength(5);
  });
});

describe('KitView: recipes', () => {
  it('lists the five starters read-only with Built In and Duplicate, the help and the line', async () => {
    await renderKit();
    const starters = screen.getAllByTestId('clip-kit-starter');
    expect(starters).toHaveLength(5);
    expect(starters.map((card) => within(card).getByRole('heading').textContent)).toEqual(
      STARTER_NAMES.map(([, name]) => name),
    );
    for (const card of starters) {
      expect(within(card).getByText('Built In')).toBeInTheDocument();
      expect(within(card).queryByRole('button', { name: /Rename/ })).toBeNull();
      expect(within(card).queryByRole('button', { name: /Delete/ })).toBeNull();
      expect(within(card).getByRole('button', { name: /Duplicate/ })).toBeInTheDocument();
    }
    const captionsOnly = starters[2] as HTMLElement;
    expect(within(captionsOnly).getByText('Adds captions and nothing else')).toBeInTheDocument();
    expect(within(captionsOnly).getByText('Captions Only line')).toBeInTheDocument();
  });

  it('says how recipes are made when the workspace has none, and counts against the limit', async () => {
    await renderKit();
    expect(screen.getByTestId('clip-kit-no-recipes')).toHaveTextContent('No recipes yet.');
    expect(screen.getByTestId('clip-kit-recipe-count')).toHaveTextContent('0 of 50 recipes');
  });

  it('duplicates a starter into My Recipes and counts it', async () => {
    api.duplicateRecipe.mockResolvedValue(recipe('own-1', 'Reframe Copy'));
    await renderKit();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Reframe' }));
    const mine = await screen.findByTestId('clip-kit-recipe');
    expect(api.duplicateRecipe).toHaveBeenCalledWith('starter-reframe');
    expect(within(mine).getByRole('heading')).toHaveTextContent('Reframe Copy');
    expect(screen.getByTestId('clip-kit-recipe-count')).toHaveTextContent('1 of 50 recipes');
    expect(toast).toHaveBeenCalledWith({ title: '"Reframe Copy" is in your recipes.' });
  });

  it('turns Duplicate off at the limit', async () => {
    await renderKit({ recipes: recipesView([recipe('own-1', 'A'), recipe('own-2', 'B')], 2) });
    expect(screen.getByTestId('clip-kit-recipe-count')).toHaveTextContent('2 of 2 recipes');
    expect(screen.getByRole('button', { name: 'Duplicate Reframe' })).toBeDisabled();
  });

  it('shows the workspace recipe with its line and who made it, and renames it in a dialog', async () => {
    api.updateRecipe.mockResolvedValue(recipe('own-1', 'Client B Shorts'));
    await renderKit({ recipes: recipesView([recipe('own-1', 'Client A Shorts')]) });
    const card = screen.getByTestId('clip-kit-recipe');
    expect(within(card).getByText('Client A Shorts line')).toBeInTheDocument();
    expect(within(card).getByText('Made by Priya')).toBeInTheDocument();

    fireEvent.click(within(card).getByRole('button', { name: 'Rename Client A Shorts' }));
    const dialog = await screen.findByTestId('clip-kit-rename-dialog');
    const field = within(dialog).getByPlaceholderText('Enter your recipe name');
    fireEvent.change(field, { target: { value: '  Client B   Shorts ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.updateRecipe).toHaveBeenCalledWith('own-1', { name: 'Client B Shorts' }),
    );
    await waitFor(() => expect(screen.queryByTestId('clip-kit-rename-dialog')).toBeNull());
    expect(within(screen.getByTestId('clip-kit-recipe')).getByRole('heading')).toHaveTextContent(
      'Client B Shorts',
    );
  });

  it('refuses an empty name in the dialog without a call', async () => {
    await renderKit({ recipes: recipesView([recipe('own-1', 'Client A Shorts')]) });
    fireEvent.click(screen.getByRole('button', { name: 'Rename Client A Shorts' }));
    const dialog = await screen.findByTestId('clip-kit-rename-dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('Enter your recipe name'), {
      target: { value: '   ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Enter a name for the recipe.')).toBeInTheDocument();
    expect(api.updateRecipe).not.toHaveBeenCalled();
  });

  it('deletes a recipe only after the red confirm that names it', async () => {
    api.deleteRecipe.mockResolvedValue({ message: 'Recipe deleted.' });
    await renderKit({ recipes: recipesView([recipe('own-1', 'Client A Shorts')]) });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Recipe Client A Shorts' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent(deleteRecipeSentence('Client A Shorts'));
    expect(api.deleteRecipe).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByTestId('clip-kit-delete-confirm'));
    await waitFor(() => expect(api.deleteRecipe).toHaveBeenCalledWith('own-1'));
    await waitFor(() => expect(screen.queryByTestId('clip-kit-recipe')).toBeNull());
    expect(screen.getByTestId('clip-kit-recipe-count')).toHaveTextContent('0 of 50 recipes');
    expect(toast).toHaveBeenCalledWith({ title: 'Recipe deleted.' });
  });
});

describe('KitView: brand kit', () => {
  it('points to Design Studio when the workspace has no kits', async () => {
    await renderKit({ kits: [], initialTab: 'brand-kit' });
    expect(screen.getByTestId('clip-kit-no-kits')).toHaveTextContent('No brand kits yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Open Design Studio' }));
    expect(push).toHaveBeenCalledWith('/org-1/studio');
  });

  it('saves the logo corner and moves the dot in the drawing', async () => {
    api.updateClipBrandKit.mockResolvedValue(kit({ clipLogoPosition: 'top-right' }));
    await renderKit({ initialTab: 'brand-kit' });
    expect(screen.getByTestId('clip-kit-logo-drawing')).toHaveAttribute('data-position', 'off');
    fireEvent.click(screen.getByRole('button', { name: 'Top Right' }));
    await waitFor(() =>
      expect(api.updateClipBrandKit).toHaveBeenCalledWith('kit-1', {
        clipLogoPosition: 'top-right',
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('clip-kit-logo-drawing')).toHaveAttribute(
        'data-position',
        'top-right',
      ),
    );
  });

  it('turns the logo place off for a kit with no logo', async () => {
    await renderKit({ initialTab: 'brand-kit', kits: [kit({ logoUrl: null })] });
    expect(screen.getByRole('button', { name: 'Top Left' })).toBeDisabled();
    expect(screen.getByText('This kit has no logo. Add one in Design Studio.')).toBeInTheDocument();
  });

  it('refuses a 6 second intro in one sentence before anything is sent', async () => {
    const upload = fakeUpload(6_000);
    await renderKit({ initialTab: 'brand-kit', uploadDeps: upload });
    fireEvent.change(screen.getByTestId('clip-kit-intro-input'), {
      target: { files: [videoFile()] },
    });
    const error = await screen.findByTestId('clip-kit-intro-error');
    expect(error).toHaveTextContent(brandVideoTooLong(6_000));
    expect(error).toHaveTextContent(
      'This video is 6 seconds long. An intro or outro can be at most 5 seconds.',
    );
    expect(upload.transport.start).not.toHaveBeenCalled();
    expect(api.updateClipBrandKit).not.toHaveBeenCalled();
  });

  it('refuses a 60 MB intro before its length is even read', async () => {
    const upload = fakeUpload(3_000);
    await renderKit({ initialTab: 'brand-kit', uploadDeps: upload });
    const bytes = 60 * 1024 * 1024;
    fireEvent.change(screen.getByTestId('clip-kit-intro-input'), {
      target: { files: [videoFile(bytes)] },
    });
    const error = await screen.findByTestId('clip-kit-intro-error');
    expect(error).toHaveTextContent(brandVideoTooBig(bytes));
    expect(error).toHaveTextContent('This video is 60 MB. An intro or outro can be at most 50 MB.');
    expect(upload.readDuration).not.toHaveBeenCalled();
    expect(upload.transport.start).not.toHaveBeenCalled();
  });

  it('uploads a 3 second intro, waits for it, then saves it on the kit and shows its player', async () => {
    const upload = fakeUpload(3_000);
    api.updateClipBrandKit.mockResolvedValue(
      kit({
        intro: {
          videoId: 'intro-video',
          title: 'intro.mp4',
          durationMs: 3_000,
          url: 'https://space.test/intro.mp4',
          posterUrl: null,
        },
      }),
    );
    await renderKit({ initialTab: 'brand-kit', uploadDeps: upload });
    await act(async () => {
      fireEvent.change(screen.getByTestId('clip-kit-intro-input'), {
        target: { files: [videoFile()] },
      });
    });
    await waitFor(() =>
      expect(api.updateClipBrandKit).toHaveBeenCalledWith('kit-1', {
        clipIntroVideoId: 'intro-video',
      }),
    );
    expect(upload.transport.start).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'intro.mp4', mimeType: 'video/mp4' }),
    );
    expect(await screen.findByTestId('clip-kit-intro-player')).toHaveAttribute(
      'src',
      'https://space.test/intro.mp4',
    );
    expect(screen.getByRole('button', { name: 'Remove Intro' })).toBeInTheDocument();
  });

  it('removes the intro', async () => {
    api.updateClipBrandKit.mockResolvedValue(kit());
    await renderKit({
      initialTab: 'brand-kit',
      kits: [
        kit({
          intro: {
            videoId: 'intro-video',
            title: 'intro.mp4',
            durationMs: 3_000,
            url: 'https://space.test/intro.mp4',
            posterUrl: null,
          },
        }),
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Intro' }));
    await waitFor(() =>
      expect(api.updateClipBrandKit).toHaveBeenCalledWith('kit-1', { clipIntroVideoId: null }),
    );
    expect(await screen.findByRole('button', { name: 'Upload Intro Video' })).toBeInTheDocument();
  });

  it('saves the outro card line when the field is left, trimmed, once', async () => {
    api.updateClipBrandKit.mockResolvedValue(
      kit({ outro: { kind: 'card', text: 'Follow for more' } }),
    );
    await renderKit({ initialTab: 'brand-kit' });
    const field = screen.getByPlaceholderText('Enter your closing line');
    expect(field).toHaveAttribute('maxLength', '80');
    fireEvent.change(field, { target: { value: '  Follow   for more ' } });
    fireEvent.blur(field);
    await waitFor(() =>
      expect(api.updateClipBrandKit).toHaveBeenCalledWith('kit-1', {
        clipOutroText: 'Follow for more',
      }),
    );
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: 'Closing line saved.' }));
    fireEvent.blur(field);
    expect(api.updateClipBrandKit).toHaveBeenCalledTimes(1);
  });

  it('switches the outro to a video, and back to the card drops the video', async () => {
    api.updateClipBrandKit.mockResolvedValue(kit());
    await renderKit({
      initialTab: 'brand-kit',
      kits: [
        kit({
          outro: {
            kind: 'video',
            video: {
              videoId: 'outro-video',
              title: 'outro.mp4',
              durationMs: 4_000,
              url: 'https://space.test/outro.mp4',
              posterUrl: null,
            },
          },
        }),
      ],
    });
    expect(screen.getByTestId('clip-kit-outro-video-player')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Card' }));
    await waitFor(() =>
      expect(api.updateClipBrandKit).toHaveBeenCalledWith('kit-1', { clipOutroVideoId: null }),
    );
    expect(screen.getByPlaceholderText('Enter your closing line')).toBeInTheDocument();
  });
});
