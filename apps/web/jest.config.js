module.exports = {
  ...require('@postgear/config/jest.preset.js'),
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['@testing-library/jest-dom'],
  // Jest does not read tsconfig `paths`, so the two aliases the app uses are
  // repeated here. Keep them in step with apps/web/tsconfig.json.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@postgear/social-core/composer$': '<rootDir>/../../packages/social-core/src/composer/index.ts',
  },
};
