import { workspaceHome } from './workspace-home';

describe('workspaceHome', () => {
  it('lands an Editor on Clips (Module 14)', () => {
    expect(workspaceHome('org-1', 'EDITOR')).toBe('/org-1/clips');
  });

  it.each(['ADMIN', 'USER', 'SUPERADMIN', null, undefined])('lands %s on Home', (role) => {
    expect(workspaceHome('org-1', role)).toBe('/org-1/home');
  });
});
