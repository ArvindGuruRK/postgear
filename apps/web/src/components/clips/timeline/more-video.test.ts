import { ApiError } from '@/lib/api';
import {
  MORE_VIDEO_DEBOUNCE_MS,
  MORE_VIDEO_RETRY_MS,
  MORE_VIDEO_THROTTLE_MS,
  type MoreVideoAnswer,
  MoreVideoRequester,
} from './more-video';

const FETCHING: MoreVideoAnswer = { job: null, sharp: 'fetching' };
const A = { fromMs: 0, toMs: 40_000 };
const B = { fromMs: 0, toMs: 50_000 };

function setup(send: jest.Mock = jest.fn(async () => FETCHING)) {
  const onAnswer = jest.fn();
  const onPending = jest.fn();
  const onFailed = jest.fn();
  const requester = new MoreVideoRequester({ send, onAnswer, onPending, onFailed });
  return { requester, send, onAnswer, onPending, onFailed };
}

/** Lets the timers run and the sent request settle. */
async function advance(ms: number) {
  await jest.advanceTimersByTimeAsync(ms);
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('MoreVideoRequester', () => {
  it('waits for the asks to settle, then sends the newest range once', async () => {
    const { requester, send, onAnswer, onPending } = setup();
    requester.request(A);
    await advance(MORE_VIDEO_DEBOUNCE_MS - 100);
    requester.request(B);
    expect(send).not.toHaveBeenCalled();
    expect(requester.pending).toBe(true);
    expect(onPending).toHaveBeenLastCalledWith(true);

    await advance(MORE_VIDEO_DEBOUNCE_MS);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(B);
    expect(onAnswer).toHaveBeenCalledWith(FETCHING, B);
    expect(requester.pending).toBe(false);
    expect(onPending).toHaveBeenLastCalledWith(false);
  });

  it('never sends a range it already has an answer for', async () => {
    const { requester, send } = setup();
    requester.request(A);
    await advance(MORE_VIDEO_DEBOUNCE_MS);
    requester.request(A);
    await advance(MORE_VIDEO_DEBOUNCE_MS * 2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(requester.pending).toBe(false);

    requester.forget();
    requester.request(A);
    await advance(MORE_VIDEO_DEBOUNCE_MS);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('holds an ask made while a request is out, and sends only the newest after it', async () => {
    let finish: (answer: MoreVideoAnswer) => void = () => undefined;
    const send = jest.fn(
      () =>
        new Promise<MoreVideoAnswer>((resolve) => {
          finish = resolve;
        }),
    );
    const { requester } = setup(send);
    requester.request(A);
    await advance(MORE_VIDEO_DEBOUNCE_MS);
    requester.request({ fromMs: 0, toMs: 45_000 });
    requester.request(B);
    await advance(MORE_VIDEO_DEBOUNCE_MS * 3);
    expect(send).toHaveBeenCalledTimes(1);

    finish(FETCHING);
    await advance(MORE_VIDEO_DEBOUNCE_MS);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(B);
  });

  it('waits out the per-clip limit and sends the range again', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new ApiError('Wait', 429, 'more_video_throttled'))
      .mockResolvedValueOnce(FETCHING);
    const { requester, onAnswer, onFailed } = setup(send);
    requester.request(A);
    await advance(MORE_VIDEO_DEBOUNCE_MS);
    expect(send).toHaveBeenCalledTimes(1);
    expect(requester.pending).toBe(true);

    await advance(MORE_VIDEO_THROTTLE_MS - 1);
    expect(send).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(onAnswer).toHaveBeenCalledWith(FETCHING, A);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it('tries a dropped connection again, then gives up and says so', async () => {
    const offline = new ApiError('Offline', 0);
    const send = jest.fn().mockRejectedValue(offline);
    const { requester, onFailed, onPending } = setup(send);
    requester.request(A);
    await advance(MORE_VIDEO_DEBOUNCE_MS);
    await advance(MORE_VIDEO_RETRY_MS);
    await advance(MORE_VIDEO_RETRY_MS);
    expect(send).toHaveBeenCalledTimes(3);
    expect(onFailed).toHaveBeenCalledWith(A, offline);
    expect(requester.pending).toBe(false);
    expect(onPending).toHaveBeenLastCalledWith(false);

    await advance(MORE_VIDEO_RETRY_MS * 3);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('drops a refused range at once', async () => {
    const refused = new ApiError('No', 422, 'clip_range_invalid');
    const send = jest.fn().mockRejectedValue(refused);
    const { requester, onFailed } = setup(send);
    requester.request(A);
    await advance(MORE_VIDEO_DEBOUNCE_MS + MORE_VIDEO_RETRY_MS * 3);
    expect(send).toHaveBeenCalledTimes(1);
    expect(onFailed).toHaveBeenCalledWith(A, refused);
  });

  it('sends nothing and reports nothing once disposed', async () => {
    let finish: (answer: MoreVideoAnswer) => void = () => undefined;
    const send = jest.fn(
      () =>
        new Promise<MoreVideoAnswer>((resolve) => {
          finish = resolve;
        }),
    );
    const { requester, onAnswer } = setup(send);
    requester.request(A);
    await advance(MORE_VIDEO_DEBOUNCE_MS);
    requester.dispose();
    finish(FETCHING);
    await advance(MORE_VIDEO_DEBOUNCE_MS);
    requester.request(B);
    await advance(MORE_VIDEO_DEBOUNCE_MS);
    expect(onAnswer).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
