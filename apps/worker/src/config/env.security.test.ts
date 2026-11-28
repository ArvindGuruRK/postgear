/**
 * Security sweep, Simulation (Sprint 13, Module 16), the worker's half.
 *
 * - `MEDIA_SIMULATION=true` stops the worker at boot in production, and so
 *   does `CLIPS_SIMULATION=true` while `MEDIA_SIMULATION` is unset or blank
 *   (it follows then).
 * - `AI_SIMULATION` is read by no file of the worker: the worker never calls
 *   a model (every AI step goes through the API's internal routes, which
 *   refuse it at the API's boot), so there is nothing here to refuse.
 * - A refusal names a variable, never a value.
 *
 * Sprint 12's `CLIPS_SIMULATION` refusal: `clips/simulation.security.test.ts`.
 * The API's half: `apps/api/src/config/env.security.spec.ts`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { loadWorkerEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://localhost/db',
  ENCRYPTION_KEY_AES256: 'cd'.repeat(32),
  AUTOMATION_INTERNAL_TOKEN: 'ab'.repeat(32),
};
const PRODUCTION = { NODE_ENV: 'production', CLIPS_URL_SECRET: 'u'.repeat(40) };
const REFUSAL = 'MEDIA_SIMULATION cannot be enabled in production';

function bootMessage(raw: Record<string, string>): string {
  try {
    loadWorkerEnv({ ...base, ...raw });
    return '';
  } catch (error) {
    return (error as Error).message;
  }
}

/** Every source file of the worker, tests left out. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.ts$/.test(name) && !/\.(test|spec)\.ts$/.test(name) ? [full] : [];
  });
}

describe('MEDIA_SIMULATION at the worker boot', () => {
  it('stops the worker in production when it is on', () => {
    expect(bootMessage({ ...PRODUCTION, MEDIA_SIMULATION: 'true' })).toContain(REFUSAL);
  });

  it('stops it when CLIPS_SIMULATION is on and MEDIA_SIMULATION is unset or blank', () => {
    expect(bootMessage({ ...PRODUCTION, CLIPS_SIMULATION: 'true' })).toContain(REFUSAL);
    expect(
      bootMessage({ ...PRODUCTION, CLIPS_SIMULATION: 'true', MEDIA_SIMULATION: '' }),
    ).toContain(REFUSAL);
  });

  it('boots production with it off, and development with it on', () => {
    expect(bootMessage({ ...PRODUCTION, MEDIA_SIMULATION: 'false' })).toBe('');
    expect(bootMessage({ ...PRODUCTION })).toBe('');
    expect(loadWorkerEnv({ ...base, MEDIA_SIMULATION: 'true' }).MEDIA_SIMULATION).toBe('true');
  });

  it('never repeats the media token in a refusal', () => {
    const token = 'media-internal-token-0123456789abcdef0123456789';
    const message = bootMessage({
      ...PRODUCTION,
      MEDIA_SIMULATION: 'true',
      MEDIA_INTERNAL_TOKEN: token,
    });
    expect(message).toContain(REFUSAL);
    expect(message).not.toContain(token);
    const short = 'short-media-token-1234';
    const shortMessage = bootMessage({ MEDIA_INTERNAL_TOKEN: short });
    expect(shortMessage).toContain('MEDIA_INTERNAL_TOKEN');
    expect(shortMessage).not.toContain(short);
  });
});

describe('AI_SIMULATION and the worker', () => {
  it('is read by no source file of the worker (it never calls a model itself)', () => {
    const root = path.resolve(__dirname, '..');
    const files = sourceFiles(root);
    expect(files.length).toBeGreaterThan(50);
    const readers = files.filter((file) => /AI_SIMULATION/.test(readFileSync(file, 'utf8')));
    expect(readers.map((file) => path.relative(root, file))).toEqual([]);
  });

  it('imports no model client (the moments, titles and stills are asked through the API)', () => {
    const root = path.resolve(__dirname, '..');
    const imports = sourceFiles(root).filter((file) =>
      /from '@postgear\/ai-engine'|require\('@postgear\/ai-engine'\)/.test(
        readFileSync(file, 'utf8'),
      ),
    );
    expect(imports.map((file) => path.relative(root, file))).toEqual([]);
  });
});
