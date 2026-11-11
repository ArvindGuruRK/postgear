module.exports = {
  ...require('@postgear/config/jest.preset.js'),
  testEnvironment: 'jsdom',
  // The second entry gives `findBy` and `waitFor` five seconds in place of
  // one: a whole screen in jsdom, beside the whole suite, can take longer than
  // a second to show its first button.
  setupFilesAfterEnv: ['@testing-library/jest-dom', '<rootDir>/src/test-utils/async-timeout.ts'],
  // Page-level suites render whole screens in jsdom. Alone they take a second
  // or two; beside the whole suite on a busy machine they passed Jest's 5
  // second default, so the workspace has one roomier limit instead of a line
  // in every such file.
  testTimeout: 20_000,
  // Jest does not read tsconfig `paths`, so the aliases the app uses are
  // repeated here. Keep them in step with apps/web/tsconfig.json.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@postgear/social-core/composer$':
      '<rootDir>/../../packages/social-core/src/composer/index.ts',
    // A single file of the design system (`@postgear/ui/lib/nice-ceiling`),
    // as tsconfig's `@postgear/ui/*`; the bare package still resolves through
    // node_modules.
    '^@postgear/ui/(.*)$': '<rootDir>/../../packages/ui/src/$1',
    // Per-icon paths ship as ES modules only; component tests get a stub.
    '^@animateicons/react/lucide/.+$': '<rootDir>/src/test-utils/animated-icon-stub.ts',
  },
};
