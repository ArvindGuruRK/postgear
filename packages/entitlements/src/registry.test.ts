/**
 * The registry and the seed agree with each other and with the migration
 * that inserted the seed. If someone edits one and not the others, this is
 * where it shows: a key with no row resolves to the Free value in production.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLIPS_ENTITLEMENTS,
  MEMBERS_ENTITLEMENTS,
  defaultValue,
  type EntitlementDef,
  enumAtOrBelow,
  enumRank,
  getDef,
  isKey,
  isMeterKey,
  KEYS,
  METER_KEYS,
  REFUSAL_CODE_PATTERN,
  REFUSAL_CODES,
  REGISTRY,
  refusalCodeOf,
  seedRows,
  seedValue,
  seedValues,
  TIER_SEED,
  TIERS,
  type ValueOf,
  validateValue,
} from './index';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'prisma', 'migrations');

/** Sprint 12's seed (the Clips keys). */
const MIGRATION = join(MIGRATIONS_DIR, '20261117120000_entitlements_and_usage', 'migration.sql');

/** Module 14's seed (`members.editors_max`). */
const EDITOR_SEATS_MIGRATION = join(
  MIGRATIONS_DIR,
  '20261128140100_sprint13_editor_seats_seed',
  'migration.sql',
);

interface SqlRow {
  tier: string;
  key: string;
  value: unknown;
}

/** The literal VALUES rows of one INSERT, read from the SQL text. */
function rowsOf(sql: string, idPrefix: string): SqlRow[] {
  const pattern = new RegExp(
    `\\('${idPrefix}_[a-z_]+', (?:'PLAN', )?'([A-Z]+)', (?:NULL, )?'([a-z_.]+)', (?:'SET', NULL, )?'([^']*)'::jsonb`,
    'g',
  );
  return [...sql.matchAll(pattern)].map((match) => ({
    tier: match[1],
    key: match[2],
    value: JSON.parse(match[3]),
  }));
}

describe('the registry', () => {
  it('names every entry after its own key', () => {
    for (const key of KEYS) {
      expect(REGISTRY[key].key).toBe(key);
    }
    expect(KEYS).toHaveLength(14);
    expect(KEYS).toEqual([
      ...Object.keys(CLIPS_ENTITLEMENTS),
      ...Object.keys(MEMBERS_ENTITLEMENTS),
    ]);
  });

  it('gives every key a default that passes its own validation', () => {
    for (const key of KEYS) {
      const def: EntitlementDef = REGISTRY[key];
      expect([key, validateValue(def, def.default).ok]).toEqual([key, true]);
    }
  });

  it('makes the default the Free value, so a missing row never grants more than Free', () => {
    for (const key of KEYS) {
      expect([key, defaultValue(key)]).toEqual([key, TIER_SEED.FREE[key]]);
    }
  });

  it('gives refusal codes the shape the exception filter passes, and each one a sentence', () => {
    const codes = KEYS.map(refusalCodeOf).filter((code): code is string => code !== undefined);
    for (const code of codes) {
      expect(code).toMatch(REFUSAL_CODE_PATTERN);
      expect(REFUSAL_CODES).toContain(code);
    }
    for (const code of REFUSAL_CODES) {
      expect(code).toMatch(REFUSAL_CODE_PATTERN);
    }
    expect(REFUSAL_CODE_PATTERN.test('Clips_Full')).toBe(false);
    expect(REFUSAL_CODE_PATTERN.test(`a${'b'.repeat(64)}`)).toBe(false);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('keeps min below max and every enum default a storable member', () => {
    for (const key of KEYS) {
      const def: EntitlementDef = REGISTRY[key];
      if (def.type === 'number' || def.type === 'meter') {
        expect(def.min).toBeLessThanOrEqual(def.max);
      }
      if (def.type === 'enum') {
        expect(def.options).toContain(def.default);
        expect(def.reserved ?? []).not.toContain(def.default);
        for (const option of def.options) {
          expect(def.optionLabels[option]).toBeTruthy();
        }
      }
    }
  });

  it('lists the export qualities of the video engine plus a reserved 4k, low to high', () => {
    const def = REGISTRY['clips.export_max_quality'];
    expect(def.options).toEqual(['720p', '720p60', '1080p', '1080p60', '4k']);
    expect(def.reserved).toEqual(['4k']);
    expect(enumRank(def, '720p')).toBe(0);
    expect(enumRank(def, '8k')).toBe(-1);
    expect(enumAtOrBelow(def, '1080p', '1080p60')).toBe(true);
    expect(enumAtOrBelow(def, '1080p60', '1080p')).toBe(false);
    expect(enumAtOrBelow(def, '720p', 'nonsense')).toBe(false);
    expect(enumAtOrBelow(def, 'nonsense', '1080p60')).toBe(false);
  });

  it('knows its meters and their windows', () => {
    expect(METER_KEYS).toEqual([
      'clips.import_minutes_per_month',
      'clips.ai_minutes_per_month',
      'clips.downloads_per_day',
    ]);
    expect(REGISTRY['clips.downloads_per_day'].window).toBe('day');
    expect(REGISTRY['clips.ai_minutes_per_month'].window).toBe('cycle');
    expect(isMeterKey('clips.storage_gb')).toBe(false);
    expect(isMeterKey('clips.ai_minutes_per_month')).toBe(true);
  });

  it('tells known keys from anything else', () => {
    expect(isKey('clips.enabled')).toBe(true);
    expect(isKey('clips.nope')).toBe(false);
    expect(isKey('toString')).toBe(false);
    expect(isKey(42)).toBe(false);
    expect(getDef('constructor')).toBeUndefined();
  });

  it('types values by key (checked by the compiler)', () => {
    const quality: ValueOf<'clips.export_max_quality'> = '1080p60';
    const minutes: ValueOf<'clips.import_minutes_per_month'> = null;
    const on: ValueOf<'clips.enabled'> = true;
    // @ts-expect-error 4k is reserved, so it is not a value a key can resolve to.
    const reserved: ValueOf<'clips.export_max_quality'> = '4k';
    expect([quality, minutes, on, reserved]).toHaveLength(4);
  });
});

describe('the seed', () => {
  it('has every key for every tier, in PLAN_ORDER', () => {
    expect(TIERS).toEqual(['FREE', 'STANDARD', 'PRO', 'TEAM', 'ULTIMATE']);
    for (const tier of TIERS) {
      expect(Object.keys(TIER_SEED[tier]).sort()).toEqual([...KEYS].sort());
    }
    expect(seedRows()).toHaveLength(70);
  });

  it('holds only values that pass validation', () => {
    for (const { tier, key, value } of seedRows()) {
      const def: EntitlementDef = REGISTRY[key];
      expect([tier, key, validateValue(def, value).ok]).toEqual([tier, key, true]);
    }
  });

  it('never gives a higher tier less than a lower one', () => {
    for (const key of KEYS) {
      const def: EntitlementDef = REGISTRY[key];
      if (def.type !== 'number' && def.type !== 'meter') continue;
      const values = TIERS.map((tier) => TIER_SEED[tier][key] as number);
      expect([key, values]).toEqual([key, [...values].sort((a, b) => a - b)]);
    }
  });

  it('answers the kill switch per tier and key', () => {
    expect(seedValue('PRO', 'clips.ai_minutes_per_month')).toBe(900);
    const values = seedValues('TEAM');
    expect(values['clips.browse_channels']).toBe(10);
    values['clips.browse_channels'] = 99;
    expect(TIER_SEED.TEAM['clips.browse_channels']).toBe(10);
  });
});

describe('the migrations agree with the seed', () => {
  const sql = readFileSync(MIGRATION, 'utf8');
  const seatsSql = readFileSync(EDITOR_SEATS_MIGRATION, 'utf8');
  const planRows = [...rowsOf(sql, 'seed'), ...rowsOf(seatsSql, 'seed')];
  const logRows = [...rowsOf(sql, 'seedlog'), ...rowsOf(seatsSql, 'seedlog')];

  it('inserts 70 plan rows and 70 change log rows (65 Clips, 5 editor seats)', () => {
    expect(planRows).toHaveLength(70);
    expect(logRows).toHaveLength(70);
    expect(rowsOf(seatsSql, 'seed')).toHaveLength(5);
  });

  it('seeds editor seats as FREE 0, STANDARD 1, PRO 3, TEAM 10, ULTIMATE 25', () => {
    expect(rowsOf(seatsSql, 'seed').map((row) => [row.tier, row.value])).toEqual([
      ['FREE', 0],
      ['STANDARD', 1],
      ['PRO', 3],
      ['TEAM', 10],
      ['ULTIMATE', 25],
    ]);
  });

  it('inserts exactly the seed, cell for cell', () => {
    const expected = seedRows().map(({ tier, key, value }) => ({ tier, key, value }));
    const byCell = (a: SqlRow, b: SqlRow) =>
      `${a.tier} ${a.key}`.localeCompare(`${b.tier} ${b.key}`);
    expect([...planRows].sort(byCell)).toEqual([...expected].sort(byCell));
    expect([...logRows].sort(byCell)).toEqual([...expected].sort(byCell));
  });

  it('names no key the code does not know, and no unknown tier', () => {
    for (const row of planRows) {
      expect([row.key, isKey(row.key)]).toEqual([row.key, true]);
      expect(TIERS).toContain(row.tier);
    }
  });

  it('never overwrites an operator edit', () => {
    expect(sql).toMatch(/ON CONFLICT \("tier", "key"\) DO NOTHING/);
    // Module 14's seed has no conflict target, so it skips a clash on the id
    // or on (tier, key) alike.
    expect(seatsSql.match(/ON CONFLICT DO NOTHING;/g)).toHaveLength(2);
  });
});
