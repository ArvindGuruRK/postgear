import { startingConfig } from './graph-ops';

describe('startingConfig', () => {
  it('gives steps with a time zone the browser zone when they are added', () => {
    expect(startingConfig('postgear.addToQueue', undefined, 'Asia/Kolkata')).toEqual({
      timeZone: 'Asia/Kolkata',
    });
    expect(startingConfig('trigger.schedule', { mode: 'daily' }, 'Europe/Berlin')).toEqual({
      mode: 'daily',
      timeZone: 'Europe/Berlin',
    });
  });

  it('keeps a zone the picker item already set', () => {
    const config = { timeZone: 'UTC' };
    expect(startingConfig('trigger.schedule', config, 'Asia/Kolkata')).toBe(config);
  });

  it('leaves steps without a time zone alone', () => {
    expect(startingConfig('notify.slack', undefined, 'Asia/Kolkata')).toBeUndefined();
    expect(startingConfig('postgear.addToQueue', undefined, '')).toBeUndefined();
  });
});
