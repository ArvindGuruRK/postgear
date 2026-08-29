/**
 * Shared Jest base config. Each package's own jest.config.js spreads this
 * and overrides only what it needs — e.g. `apps/web` and `packages/ui`
 * override `testEnvironment` to `jsdom` and add React Testing Library setup,
 * since this base targets plain Node packages (API, worker, DB, engines).
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/src/**/*.test.ts',
    '<rootDir>/src/**/*.spec.ts',
    '<rootDir>/src/**/*.test.tsx',
    '<rootDir>/src/**/*.spec.tsx',
  ],
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
  coverageDirectory: 'coverage',
  // Jest exits 1 on zero test files by default — correct for a mature
  // codebase (an empty test dir usually means a broken glob), wrong for a
  // pre-Sprint-0 scaffold where no test files exist anywhere yet. Remove
  // once every package has at least one real test.
  passWithNoTests: true,
};
