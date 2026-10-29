/**
 * The package's promise: it is pure, so Temporal's workflow sandbox can
 * import it and replay it identically. This guard reads every shipped
 * source file (tests and test helpers excluded) and fails on anything
 * that would break that promise.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as automation from './index';

const SRC = __dirname;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return entry === 'testing' ? [] : sourceFiles(path);
    return entry.endsWith('.ts') && !entry.endsWith('.test.ts') ? [path] : [];
  });
}

const FORBIDDEN: [RegExp, string][] = [
  [/from ['"]node:/, 'a Node built-in'],
  [/from ['"](fs|path|crypto|os|util|events|stream|http|https|url|vm)['"]/, 'a Node built-in'],
  [/\bvm\.|\brequire\(/, 'a code sandbox or require'],
  [/from ['"]@prisma\//, 'Prisma'],
  [/from ['"]@temporalio\//, 'Temporal'],
  [/from ['"]react/, 'React'],
  [/from ['"]@postgear\//, 'another workspace package'],
  [/\bDate\.now\(|\bnew Date\(\)/, 'the clock'],
  [/\bMath\.random\(/, 'randomness'],
  [/\beval\(|\bnew Function\(|\bFunction\(/, 'code evaluation'],
  [/\bprocess\.|\bwindow\.|\bdocument\.|\bglobalThis\./, 'a runtime global'],
];

describe('the package stays pure', () => {
  const files = sourceFiles(SRC);

  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(FORBIDDEN.map(([pattern, what]) => [what, pattern] as const))(
    'never uses %s',
    (_what, pattern) => {
      const offenders = files.filter((file) => pattern.test(readFileSync(file, 'utf8')));
      expect(offenders.map((file) => relative(SRC, file))).toEqual([]);
    },
  );

  it('imports nothing but zod and its own files', () => {
    for (const file of files) {
      const imports = [...readFileSync(file, 'utf8').matchAll(/from ['"]([^'"]+)['"]/g)].map(
        (match) => match[1],
      );
      for (const source of imports) expect(source === 'zod' || source.startsWith('.')).toBe(true);
    }
  });
});

describe('the public surface', () => {
  it('exports what the apps build on from the package root', () => {
    for (const name of [
      'automationGraphSchema',
      'upgradeGraph',
      'emptyGraph',
      'NODE_CATALOG',
      'getDefinition',
      'listDefinitions',
      'describeNode',
      'outputPortsOf',
      'outputFieldsOf',
      'canConnect',
      'buildIndex',
      'topologicalOrder',
      'upstreamOf',
      'exclusiveGroups',
      'areExclusive',
      'planNext',
      'validateGraph',
      'VALIDATION_RULES',
      'LIMITS',
      'EXECUTABLE_TYPES',
      'parseTemplate',
      'serializeSegments',
      'resolveTemplate',
      'resolveValue',
      'availableData',
      'evaluateCondition',
      'describeCondition',
      'nextRuns',
      'describeSchedule',
      'toTemporalScheduleSpec',
      'redact',
      'findSecretLikeValues',
      'describeWorkflow',
      'riskSummary',
      'sampleScope',
      'TEMPLATES',
      'instantiateTemplate',
      'rekeyGraph',
    ]) {
      expect(automation).toHaveProperty(name);
    }
  });
});
