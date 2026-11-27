import { TooltipProvider } from '@postgear/ui';
import {
  type ClipDocument,
  createClipDocument,
  describeRecipe,
  type RecipeView,
  recipeFromClip,
} from '@postgear/video-engine';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { ApiError } from '@/lib/api';
import { ApplyRecipeDialog, SaveRecipeDialog } from './recipe-dialogs';

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});

const KIT_ID = '5b2a9c1e-0000-4000-8000-000000000001';

function makeDoc(): ClipDocument {
  const doc = createClipDocument({
    videoId: '3f2a9c1e-0000-4000-8000-000000000001',
    fromMs: 10_000,
    toMs: 40_000,
    ratio: '9:16',
  });
  return { ...doc, meta: { shapeChosen: true, cleanup: { silencesMinMs: 800, fillers: true } } };
}

function recipe(id: string, name: string, builtIn: boolean): RecipeView {
  return {
    id,
    name,
    description: `${name} line`,
    settings: { version: 1, ratio: '9:16' },
    builtIn,
    brandKitId: null,
    createdById: null,
    createdByName: null,
    createdAt: null,
    updatedAt: null,
  };
}

describe('Save As Recipe', () => {
  function renderSave(doc: ClipDocument, create = jest.fn()) {
    const kits = jest.fn(async () => ({
      brandKits: [{ id: KIT_ID, name: 'Client A' }],
    })) as never;
    const onSaved = jest.fn();
    const onOpenChange = jest.fn();
    render(
      <TooltipProvider>
        <SaveRecipeDialog
          open
          onOpenChange={onOpenChange}
          document={doc}
          exportQuality="1080p"
          styles={[]}
          onSaved={onSaved}
          deps={{ create, kits }}
        />
      </TooltipProvider>,
    );
    return { create, onSaved, onOpenChange };
  }

  it('reads back exactly what will be saved, and saves it with the clip brand kit', async () => {
    const doc = { ...makeDoc(), brandKitId: KIT_ID };
    const settings = recipeFromClip(doc, { exportQuality: '1080p' });
    const create = jest.fn(async () => recipe('r-1', 'Client A Shorts', false));
    const { onSaved, onOpenChange } = renderSave(doc, create);

    const readback = screen.getByTestId('clip-save-recipe-readback');
    expect(within(readback).getByText(describeRecipe(settings))).toBeTruthy();
    expect(within(readback).getByText('Shape: Vertical')).toBeTruthy();
    expect(within(readback).getByText('Remove filler words')).toBeTruthy();
    expect(within(readback).getByText('Export at 1080p')).toBeTruthy();
    expect(await screen.findByText('Keep the brand kit (Client A)')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Enter your recipe name'), {
      target: { value: '  Client A   Shorts ' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('clip-save-recipe-submit'));
    });
    expect(create).toHaveBeenCalledWith({
      name: 'Client A Shorts',
      settings,
      brandKitId: KIT_ID,
    });
    expect(onSaved).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('leaves the kit out when unticked', async () => {
    const doc = { ...makeDoc(), brandKitId: KIT_ID };
    const create = jest.fn(async () => recipe('r-1', 'Mine', false));
    renderSave(doc, create);
    fireEvent.click(screen.getByTestId('clip-save-recipe-kit'));
    fireEvent.change(screen.getByPlaceholderText('Enter your recipe name'), {
      target: { value: 'Mine' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('clip-save-recipe-submit'));
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ brandKitId: null }));
  });

  it('shows the workspace limit in an Alert and keeps the name', async () => {
    const create = jest.fn(async () => {
      throw new ApiError(
        'This workspace has 50 recipes, the most it can keep.',
        422,
        'recipe_limit',
      );
    });
    const { onOpenChange } = renderSave(makeDoc(), create);
    fireEvent.change(screen.getByPlaceholderText('Enter your recipe name'), {
      target: { value: 'One More' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('clip-save-recipe-submit'));
    });
    const alert = screen.getByTestId('clip-save-recipe-problem');
    expect(alert.getAttribute('data-code')).toBe('recipe_limit');
    expect(alert.textContent).toContain('50 recipes');
    expect((screen.getByPlaceholderText('Enter your recipe name') as HTMLInputElement).value).toBe(
      'One More',
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('cannot save without a name', () => {
    renderSave(makeDoc());
    expect((screen.getByTestId('clip-save-recipe-submit') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe('Apply A Recipe', () => {
  it('lists the starters, then the workspace own, each with its line, and applies one', async () => {
    const list = jest.fn(async () => ({
      recipes: [
        recipe('starter-reframe', 'Reframe', true),
        recipe('r-2', 'Client A Shorts', false),
      ],
      own: 1,
      max: 50,
    }));
    const onApply = jest.fn(async () => null);
    const onOpenChange = jest.fn();
    render(
      <TooltipProvider>
        <ApplyRecipeDialog open onOpenChange={onOpenChange} onApply={onApply} deps={{ list }} />
      </TooltipProvider>,
    );
    const starters = await screen.findByRole('region', { name: 'Starter Recipes' });
    expect(within(starters).getByText('Reframe')).toBeTruthy();
    expect(within(starters).getByText('Reframe line')).toBeTruthy();
    const own = screen.getByRole('region', { name: 'My Recipes' });
    expect(within(own).getByText('Client A Shorts')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply Client A Shorts' }));
    });
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ id: 'r-2' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps a refusal in the dialog', async () => {
    const list = jest.fn(async () => ({
      recipes: [recipe('r-2', 'Mine', false)],
      own: 1,
      max: 50,
    }));
    const onApply = jest.fn(async () => 'This recipe is not here any more.');
    render(
      <TooltipProvider>
        <ApplyRecipeDialog open onOpenChange={jest.fn()} onApply={onApply} deps={{ list }} />
      </TooltipProvider>,
    );
    const apply = await screen.findByRole('button', { name: 'Apply Mine' });
    await act(async () => {
      fireEvent.click(apply);
    });
    await waitFor(() =>
      expect(screen.getByTestId('clip-apply-recipe-problem').textContent).toContain(
        'not here any more',
      ),
    );
  });
});
