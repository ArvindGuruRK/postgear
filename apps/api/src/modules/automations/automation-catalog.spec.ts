/**
 * The Google Sheets step's catalog state (Module 13): "Ask a workspace admin
 * to set up Google." while no Google client is configured and no Google
 * account (simulated or real) is connected; "Connect Google first." once
 * one is configured; Ready with a connected account.
 */
import type { ValidationContext } from '@postgear/automation';
import { buildCatalog } from './automation-catalog';
import { CATALOG_REASONS } from './automations.messages';

function sheets(ctx: ValidationContext, googleReady?: boolean) {
  const entry = buildCatalog(ctx, googleReady === undefined ? {} : { googleReady }).steps.find(
    (step) => step.type === 'data.googleSheetsAppendRow',
  );
  if (!entry) throw new Error('missing Sheets step');
  return entry;
}

const empty: ValidationContext = { connections: [], channels: [] };
const withGoogle: ValidationContext = {
  connections: [{ id: 'c1', kind: 'google', name: 'Simulated', status: 'CONNECTED' }],
  channels: [],
};

describe('buildCatalog and Google', () => {
  it('asks for an admin to set Google up when no client is configured', () => {
    expect(sheets(empty, false)).toMatchObject({
      state: 'needsConnection',
      reason: CATALOG_REASONS.googleNotSetUp,
    });
    expect(CATALOG_REASONS.googleNotSetUp).toBe('Ask a workspace admin to set up Google.');
  });

  it('asks to connect Google once a client is configured', () => {
    expect(sheets(empty, true)).toMatchObject({
      state: 'needsConnection',
      reason: CATALOG_REASONS.connect('Google'),
    });
  });

  it('is ready with a connected account, simulated or real, whatever the config', () => {
    expect(sheets(withGoogle, false)).toMatchObject({ state: 'ready', reason: null });
    expect(sheets(withGoogle, true)).toMatchObject({ state: 'ready', reason: null });
  });

  it('reads the environment when not told, treating placeholders as not set', () => {
    const saved = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };
    const savedAuto = {
      id: process.env.GOOGLE_AUTOMATION_CLIENT_ID,
      secret: process.env.GOOGLE_AUTOMATION_CLIENT_SECRET,
    };
    try {
      delete process.env.GOOGLE_AUTOMATION_CLIENT_ID;
      delete process.env.GOOGLE_AUTOMATION_CLIENT_SECRET;
      process.env.GOOGLE_CLIENT_ID = 'google-client-id';
      process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
      expect(sheets(empty).reason).toBe(CATALOG_REASONS.googleNotSetUp);
      process.env.GOOGLE_CLIENT_ID = 'real-id.apps.googleusercontent.com';
      process.env.GOOGLE_CLIENT_SECRET = 'real-secret';
      expect(sheets(empty).reason).toBe(CATALOG_REASONS.connect('Google'));
    } finally {
      for (const [key, value] of [
        ['GOOGLE_CLIENT_ID', saved.id],
        ['GOOGLE_CLIENT_SECRET', saved.secret],
        ['GOOGLE_AUTOMATION_CLIENT_ID', savedAuto.id],
        ['GOOGLE_AUTOMATION_CLIENT_SECRET', savedAuto.secret],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
