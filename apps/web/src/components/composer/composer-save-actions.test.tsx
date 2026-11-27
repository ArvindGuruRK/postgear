/**
 * The composer for an Editor (Sprint 13, Module 14): drafts only. Save As
 * Draft stays; the schedule button, its Post Now chevron, the time, Next
 * Available and Repeat do not, and a faded Add To Calendar says why.
 */
import { EDITOR_FORBIDDEN_SENTENCE } from '@postgear/entitlements';
import { TooltipProvider } from '@postgear/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { SaveActions, type SaveActionsProps } from './composer-save-actions';
import { composerAccess } from './composer-state';

beforeAll(() => stubBrowserLayout());

function actions(overrides: Partial<SaveActionsProps> = {}) {
  const props: SaveActionsProps = {
    draftsOnly: false,
    saving: null,
    locked: false,
    noChannels: false,
    queued: false,
    primaryLabel: 'Add to calendar',
    onSaveDraft: jest.fn(),
    onSchedule: jest.fn(),
    onPostNow: jest.fn(),
    ...overrides,
  };
  render(
    <TooltipProvider>
      <SaveActions {...props} />
    </TooltipProvider>,
  );
  return props;
}

describe('SaveActions', () => {
  it('gives an Editor Save As Draft and no schedule or Post Now', () => {
    const props = actions({ draftsOnly: true });

    fireEvent.click(screen.getByRole('button', { name: 'Save As Draft' }));
    expect(props.onSaveDraft).toHaveBeenCalled();

    expect(screen.queryByRole('button', { name: 'Add to calendar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More ways to publish' })).toBeNull();
    expect(screen.queryByText('Post Now')).toBeNull();
  });

  it('says why there is no scheduling, in a focusable hint that does nothing', () => {
    const props = actions({ draftsOnly: true });

    const hint = screen.getByTestId('composer-editor-hint');
    expect(hint.getAttribute('aria-disabled')).toBe('true');
    expect(hint).toHaveAccessibleName('Add To Calendar');
    expect(hint).toHaveAccessibleDescription(EDITOR_FORBIDDEN_SENTENCE);

    fireEvent.click(hint);
    expect(props.onSchedule).not.toHaveBeenCalled();
    expect(props.onPostNow).not.toHaveBeenCalled();
  });

  it('keeps Save As Draft off while a scheduled post is read only', () => {
    actions({ draftsOnly: true, locked: true, queued: true });
    expect(
      (screen.getByRole('button', { name: 'Save As Draft' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('gives everyone else the draft button and the split schedule button', () => {
    const props = actions();

    expect(screen.getByRole('button', { name: 'Save As Draft' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));
    expect(props.onSchedule).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'More ways to publish' })).toBeTruthy();
    expect(screen.queryByTestId('composer-editor-hint')).toBeNull();
  });
});

describe('composerAccess', () => {
  it('makes an Editor drafts only, and a scheduled post read only to them', () => {
    expect(composerAccess('EDITOR', null)).toEqual({
      draftsOnly: true,
      published: false,
      locked: false,
    });
    expect(composerAccess('EDITOR', 'DRAFT').locked).toBe(false);
    expect(composerAccess('EDITOR', 'QUEUE')).toEqual({
      draftsOnly: true,
      published: false,
      locked: true,
    });
    expect(composerAccess('EDITOR', 'ERROR').locked).toBe(true);
  });

  it('leaves admins and members as they were: only a published post is locked', () => {
    for (const role of ['ADMIN', 'USER', 'SUPERADMIN']) {
      expect(composerAccess(role, 'QUEUE')).toEqual({
        draftsOnly: false,
        published: false,
        locked: false,
      });
      expect(composerAccess(role, 'PUBLISHED').locked).toBe(true);
    }
  });

  it('fails closed with no role', () => {
    expect(composerAccess(null, null).draftsOnly).toBe(true);
  });
});
