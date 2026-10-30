import {
  decidedText,
  decidedTime,
  imageUrlOf,
  reviewContent,
  reviewExpiryText,
  reviewOutputOf,
} from './review-words';

const DAY = 86_400_000;
const START = '2026-10-29T09:00:00.000Z';
const start = new Date(START).getTime();

describe('reviewExpiryText', () => {
  it('counts down from the review lifetime (7 days)', () => {
    expect(reviewExpiryText(START, start + DAY - 1)).toBe('Expires in 6 days');
    expect(reviewExpiryText(START, start + 6 * DAY)).toBe('Expires in 1 day');
    expect(reviewExpiryText(START, start + 7 * DAY - 3 * 3_600_000)).toBe('Expires in 3 hours');
    expect(reviewExpiryText(START, start + 7 * DAY - 30_000)).toBe('Expires in 1 minute');
    expect(reviewExpiryText(START, start + 7 * DAY)).toBe('This review has expired.');
  });
});

describe('decidedText', () => {
  it('says who decided and when', () => {
    const decidedAt = new Date(2026, 9, 29, 9, 14).toISOString();
    const now = new Date(2026, 9, 29, 18, 0).getTime();
    expect(decidedText({ decision: 'approved', reviewedBy: 'Priya', decidedAt }, now)).toBe(
      'Approved by Priya, 09:14',
    );
    expect(decidedText({ decision: 'rejected', decidedAt }, now)).toBe('Rejected, 09:14');
  });

  it('adds the day when it was not today', () => {
    const decidedAt = new Date(2026, 9, 28, 9, 14).toISOString();
    const now = new Date(2026, 9, 29, 18, 0).getTime();
    expect(decidedTime(decidedAt, now)).toBe('28 Oct 09:14');
  });
});

describe('review content', () => {
  it('reads the resolved text, image and instructions', () => {
    expect(
      reviewContent({
        text: 'Fresh bread',
        image: 'https://cdn.example.com/a.png',
        instructions: 'Check the price',
      }),
    ).toEqual({
      text: 'Fresh bread',
      image: 'https://cdn.example.com/a.png',
      instructions: 'Check the price',
    });
    expect(reviewContent(null)).toEqual({ text: '', image: null, instructions: '' });
  });

  it('takes an image link from a media object, never a script link', () => {
    expect(imageUrlOf({ url: '/media/a.png' })).toBe('/media/a.png');
    expect(imageUrlOf('javascript:alert(1)')).toBeNull();
  });

  it('knows an answered review by its decision', () => {
    expect(reviewOutputOf({ decision: 'approved' })).toEqual({ decision: 'approved' });
    expect(reviewOutputOf({ text: 'waiting' })).toBeNull();
    expect(reviewOutputOf(undefined)).toBeNull();
  });
});
