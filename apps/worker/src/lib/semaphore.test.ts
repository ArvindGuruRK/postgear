import { Semaphore } from './semaphore';

describe('Semaphore', () => {
  it('never runs more tasks at once than it has permits', async () => {
    const semaphore = new Semaphore(2);
    let running = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 6 }, () =>
        semaphore.run(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 5));
          running -= 1;
        }),
      ),
    );

    expect(peak).toBe(2);
  });

  it('releases a permit when a task throws', async () => {
    const semaphore = new Semaphore(1);

    await expect(
      semaphore.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(semaphore.run(async () => 'next')).resolves.toBe('next');
  });
});
