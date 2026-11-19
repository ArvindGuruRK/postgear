import { clipStorageOverLine } from './clips';

describe('clipStorageOverLine (Module 19)', () => {
  it('rounds like the space meter beside it, so the two agree', () => {
    // 1,218,598,509 bytes: the meter reads "1.2 GB of 1 GB".
    expect(clipStorageOverLine(1.218598509, 1)).toBe(
      "Your videos use 1.2 GB, over your plan's 1 GB. Delete some, or upgrade, to bring in more.",
    );
  });

  it('rounds up only where plain rounding would hide the overrun', () => {
    expect(clipStorageOverLine(1.04, 1)).toContain('use 1.1 GB');
    expect(clipStorageOverLine(1.0001, 1)).toContain('use 1.1 GB');
  });

  it('uses whole gigabytes from 100 GB, like the meter', () => {
    expect(clipStorageOverLine(123.4, 100)).toContain("use 123 GB, over your plan's 100 GB");
    expect(clipStorageOverLine(100.2, 100)).toContain("use 101 GB, over your plan's 100 GB");
  });

  it('never prints a negative or broken number', () => {
    expect(clipStorageOverLine(Number.NaN, -1)).toContain("use 0 GB, over your plan's 0 GB");
  });
});
