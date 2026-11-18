// The preview drives <video>, <canvas> and the DOM, so its tests run in
// jsdom. jsdom has no media at all: the tests use the fake video element in
// src/testing (events, seeks and frame callbacks on demand).
module.exports = {
  ...require('@postgear/config/jest.preset.js'),
  testEnvironment: 'jsdom',
};
