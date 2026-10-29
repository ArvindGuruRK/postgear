module.exports = {
  ...require('@postgear/config/jest.preset.js'),
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['@testing-library/jest-dom'],
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
