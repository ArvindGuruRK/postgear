/**
 * `@postgear/video-preview/testing`: the fake `<video>`, the stepped
 * animation frame clock and small clip documents the engine's tests use,
 * shared with the web app's tests of the playback store. Test code only.
 */
export {
  CENTRED_VERTICAL_CROP,
  clipOf,
  fullFrameOverride,
  part,
  partFrom,
  TEST_VIDEO_ID,
} from './docs';
export { FakeFrames, FakeVideo, type FakeVideoOptions, fakeVideoFactory } from './fake-video';
