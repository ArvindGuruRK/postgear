module.exports = {
  ...require('@postgear/config/jest.preset.js'),
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['@testing-library/jest-dom'],
};
