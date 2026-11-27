/**
 * The capability table (Sprint 13, Module 14), one function at a time, against
 * the table in the module doc and what the API's decorators do today.
 */
import * as caps from './capabilities';

const ROLES = ['SUPERADMIN', 'ADMIN', 'USER', 'EDITOR'] as const;

/** Who may: S(uperadmin), A(dmin), U(ser), E(ditor). */
const TABLE: Record<string, string> = {
  canWorkOnClips: 'SAUE',
  canUseStudio: 'SAUE',
  canUseMedia: 'SAUE',
  canUseCopilot: 'SAUE',
  canReadCalendar: 'SAUE',
  canSaveDrafts: 'SAUE',
  canUseTags: 'SAUE',
  canSchedule: 'SAU',
  canPublish: 'SAU',
  canViewAnalytics: 'SAU',
  canUseSeo: 'SAU',
  canUseDiscover: 'SAU',
  canViewBilling: 'SAU',
  canViewChannels: 'SAU',
  canUseWorkflows: 'SAU',
  canConnectChannels: 'SAU',
  canViewDeveloperSettings: 'SAU',
  canManageWorkspaceSettings: 'SA',
  canManageChannels: 'SA',
  canManageTeam: 'SA',
  canManageBilling: 'SA',
  canManageApiKeys: 'SA',
  canManageWebhooks: 'SA',
  canManageWorkflows: 'SA',
};

describe('capabilities', () => {
  it('covers every can* function the module exports', () => {
    const exported = Object.keys(caps).filter((name) => name.startsWith('can'));
    expect(exported.sort()).toEqual(Object.keys(TABLE).sort());
  });

  it.each(Object.entries(TABLE))('%s answers as the table says', (name, who) => {
    const decide = (caps as unknown as Record<string, (role: string) => boolean>)[name];
    for (const role of ROLES) {
      expect([role, decide(role)]).toEqual([role, who.includes(role[0])]);
    }
  });

  it('fails closed with no role or an unknown one', () => {
    for (const name of Object.keys(TABLE)) {
      const decide = (caps as unknown as Record<string, (role: unknown) => boolean>)[name];
      expect(decide(null)).toBe(false);
      expect(decide(undefined)).toBe(false);
      expect(decide('OWNER')).toBe(false);
      expect(decide('')).toBe(false);
    }
  });

  it('names the four roles and the three an invite may grant', () => {
    expect(caps.WORKSPACE_ROLE_NAMES).toEqual(['SUPERADMIN', 'ADMIN', 'USER', 'EDITOR']);
    expect(caps.INVITABLE_ROLE_NAMES).toEqual(['ADMIN', 'USER', 'EDITOR']);
    expect(caps.isWorkspaceRole('EDITOR')).toBe(true);
    expect(caps.isWorkspaceRole('OWNER')).toBe(false);
    expect(caps.isEditor('EDITOR')).toBe(true);
    expect(caps.isEditor('USER')).toBe(false);
  });

  it('keeps the two sentences word for word', () => {
    expect(caps.EDITOR_FORBIDDEN_SENTENCE).toBe('Editors cannot do this. Ask an admin.');
    expect(caps.PAGE_DENIED_SENTENCE).toBe('You do not have access to this page.');
  });
});
