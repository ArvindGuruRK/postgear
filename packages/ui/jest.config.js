module.exports = {
  ...require('@postgear/config/jest.preset.js'),
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['@testing-library/jest-dom', '<rootDir>/src/test-utils/top-layer-guard.ts'],
  moduleNameMapper: {
    // Per-icon paths ship as ES modules only; component tests get a stub.
    '^@animateicons/react/lucide/.+$': '<rootDir>/src/test-utils/animated-icon-stub.ts',
  },
};
