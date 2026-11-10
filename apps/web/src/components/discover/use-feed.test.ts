/**
 * The feed hook's question (Module 05): the language is part of it only on
 * the tabs it changes, so switching it on Videos or Festivals asks the API
 * for nothing, while Trending and News ask again. Module 06: the News topic
 * is part of the question on News alone.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { getFeed } from '@/lib/discover-api';
import type { FeedKind, FeedResponse, Locality, NewsTopic } from '@/types/discover';
import { feedKey, useFeed } from './use-feed';

jest.mock('@/lib/discover-api', () => ({ getFeed: jest.fn() }));

const mockedGetFeed = getFeed as jest.MockedFunction<typeof getFeed>;

const CHENNAI: Locality = {
  countryCode: 'IN',
  countryName: 'India',
  regionCode: 'IN-TN',
  regionName: 'Tamil Nadu',
  city: 'Chennai',
  timeZone: 'Asia/Kolkata',
  languages: ['ta', 'en'],
  newsLanguages: ['ta', 'en'],
};

function answer(kind: FeedKind): FeedResponse {
  return { kind, language: 'ta', locality: CHENNAI, groups: [], unavailable: [] };
}

beforeEach(() => {
  mockedGetFeed.mockReset();
  mockedGetFeed.mockImplementation((kind) => Promise.resolve(answer(kind)));
});

describe('feedKey', () => {
  it('tells languages apart on Trending and News', () => {
    expect(feedKey('trending', CHENNAI, 'ta')).not.toBe(feedKey('trending', CHENNAI, 'en'));
    expect(feedKey('news', CHENNAI, 'ta')).not.toBe(feedKey('news', CHENNAI, 'en'));
  });

  it('reads Videos and Festivals the same in every language', () => {
    expect(feedKey('videos', CHENNAI, 'ta')).toBe(feedKey('videos', CHENNAI, 'en'));
    expect(feedKey('festivals', CHENNAI, 'ta')).toBe(feedKey('festivals', CHENNAI, 'en'));
  });

  it('tells tabs and places apart', () => {
    expect(feedKey('videos', CHENNAI, 'ta')).not.toBe(feedKey('festivals', CHENNAI, 'ta'));
    expect(feedKey('festivals', CHENNAI, 'ta')).not.toBe(
      feedKey('festivals', { ...CHENNAI, countryCode: 'FR' }, 'ta'),
    );
  });
});

describe('useFeed', () => {
  it('asks once for Festivals, however the language changes', async () => {
    const { result, rerender } = renderHook(
      ({ language }) => useFeed('festivals', CHENNAI, language),
      { initialProps: { language: 'ta' } },
    );
    await waitFor(() => expect(result.current.data?.kind).toBe('festivals'));

    rerender({ language: 'en' });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockedGetFeed).toHaveBeenCalledTimes(1);
    expect(result.current.data?.kind).toBe('festivals');
  });

  it('asks again for Trending in the new language', async () => {
    const { result, rerender } = renderHook(
      ({ language }) => useFeed('trending', CHENNAI, language),
      { initialProps: { language: 'ta' } },
    );
    await waitFor(() => expect(result.current.data?.kind).toBe('trending'));

    rerender({ language: 'en' });
    await waitFor(() => expect(mockedGetFeed).toHaveBeenCalledTimes(2));
    expect(mockedGetFeed).toHaveBeenLastCalledWith('trending', CHENNAI, 'en');
  });

  it('asks again on Refresh, on any tab', async () => {
    const { result } = renderHook(() => useFeed('videos', CHENNAI, 'ta'));
    await waitFor(() => expect(result.current.data?.kind).toBe('videos'));

    act(() => result.current.refresh());
    await waitFor(() => expect(mockedGetFeed).toHaveBeenCalledTimes(2));
  });

  it('asks for nothing without a tab to ask for', () => {
    const { result } = renderHook(() => useFeed(null, CHENNAI, 'ta'));

    expect(mockedGetFeed).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});

describe('the News topic (Module 06)', () => {
  it('is part of the question on News only', () => {
    expect(feedKey('news', CHENNAI, 'ta', 'BUSINESS')).not.toBe(feedKey('news', CHENNAI, 'ta'));
    expect(feedKey('news', CHENNAI, 'ta', 'BUSINESS')).not.toBe(
      feedKey('news', CHENNAI, 'ta', 'SPORTS'),
    );
    expect(feedKey('news', CHENNAI, 'ta', null)).toBe(feedKey('news', CHENNAI, 'ta'));
    expect(feedKey('trending', CHENNAI, 'ta', 'BUSINESS')).toBe(feedKey('trending', CHENNAI, 'ta'));
  });

  it('asks News with the topic, and again when it changes', async () => {
    const { result, rerender } = renderHook(
      ({ topic }: { topic: NewsTopic | null }) => useFeed('news', CHENNAI, 'ta', topic),
      { initialProps: { topic: 'BUSINESS' as NewsTopic | null } },
    );
    await waitFor(() => expect(result.current.data?.kind).toBe('news'));
    expect(mockedGetFeed).toHaveBeenLastCalledWith('news', CHENNAI, 'ta', 'BUSINESS');

    rerender({ topic: 'SPORTS' });
    await waitFor(() => expect(mockedGetFeed).toHaveBeenCalledTimes(2));
    expect(mockedGetFeed).toHaveBeenLastCalledWith('news', CHENNAI, 'ta', 'SPORTS');

    // All is asked without a topic at all.
    rerender({ topic: null });
    await waitFor(() => expect(mockedGetFeed).toHaveBeenCalledTimes(3));
    expect(mockedGetFeed).toHaveBeenLastCalledWith('news', CHENNAI, 'ta');
  });

  it('never sends the topic with another tab, nor asks again for it', async () => {
    const { result, rerender } = renderHook(
      ({ topic }: { topic: NewsTopic | null }) => useFeed('trending', CHENNAI, 'ta', topic),
      { initialProps: { topic: 'BUSINESS' as NewsTopic | null } },
    );
    await waitFor(() => expect(result.current.data?.kind).toBe('trending'));

    rerender({ topic: 'SPORTS' });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockedGetFeed).toHaveBeenCalledTimes(1);
    expect(mockedGetFeed).toHaveBeenLastCalledWith('trending', CHENNAI, 'ta');
  });
});
