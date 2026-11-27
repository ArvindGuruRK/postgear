/**
 * The rail and the settings sections by role (Sprint 13, Module 14): an
 * Editor has no Analytics, Workflows, Discover or SEO, and no Billing, API
 * Keys, Webhooks, Connections or Discover settings. Admins and members keep
 * every entry they had.
 */
import { settingsSectionsFor } from '../settings/settings-shell';
import { RAIL, railFor } from './rail';

const segments = (entries: readonly { segment: string }[]) => entries.map((entry) => entry.segment);

describe('railFor', () => {
  it('hides the four denied entries from an Editor, keeping the order', () => {
    expect(segments(railFor('EDITOR'))).toEqual([
      'home',
      'calendar',
      'ai-copilot',
      'queue',
      'media',
      'studio',
      'clips',
    ]);
  });

  it.each(['ADMIN', 'USER', 'SUPERADMIN'])('shows every entry to %s', (role) => {
    expect(segments(railFor(role))).toEqual(segments(RAIL));
  });

  it('fails closed with no role', () => {
    expect(segments(railFor(null))).not.toContain('analytics');
  });
});

describe('settingsSectionsFor', () => {
  it('leaves an Editor Team, Signatures, Notifications and Appearance', () => {
    expect(segments(settingsSectionsFor('EDITOR'))).toEqual([
      'team',
      'signatures',
      'notifications',
      'appearance',
    ]);
  });

  it.each(['ADMIN', 'USER'])('keeps every section for %s', (role) => {
    expect(segments(settingsSectionsFor(role))).toEqual([
      'team',
      'billing',
      'api-keys',
      'webhooks',
      'connections',
      'signatures',
      'notifications',
      'discover',
      'appearance',
    ]);
  });
});
