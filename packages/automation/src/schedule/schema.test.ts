import { scheduleConfigSchema } from './schema';

const problems = (config: Record<string, unknown>) => {
  const parsed = scheduleConfigSchema.safeParse({ timeZone: 'Asia/Kolkata', ...config });
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
};

describe('schedule config', () => {
  it('accepts each frequency with the fields it needs', () => {
    expect(problems({ frequency: 'hourly', everyHours: 2 })).toEqual([]);
    expect(problems({ frequency: 'daily', time: '09:00' })).toEqual([]);
    expect(problems({ frequency: 'weekdays', time: '23:59' })).toEqual([]);
    expect(problems({ frequency: 'weekly', time: '08:00', days: ['mon', 'fri'] })).toEqual([]);
    expect(problems({ frequency: 'monthly', time: '18:00', dayOfMonth: 'last' })).toEqual([]);
  });

  it('keeps fields another frequency used, so switching back loses nothing', () => {
    expect(problems({ frequency: 'daily', time: '09:00', days: ['mon'], everyHours: 3 })).toEqual(
      [],
    );
  });

  it('asks for exactly what is missing', () => {
    expect(problems({ frequency: 'hourly' })).toEqual(['Choose how many hours apart.']);
    expect(problems({ frequency: 'daily' })).toEqual(['Pick a time.']);
    expect(problems({ frequency: 'weekly', time: '08:00', days: [] })).toEqual([
      'Pick at least one day.',
    ]);
    expect(problems({ frequency: 'monthly', time: '08:00' })).toEqual(['Pick a day of the month.']);
  });

  it('refuses a time that is not a time of day, and a malformed time zone', () => {
    expect(problems({ frequency: 'daily', time: '24:00' })).toEqual(['Pick a time.']);
    expect(problems({ frequency: 'daily', time: '09:00', timeZone: 'Kolkata time' })).toEqual([
      'Pick a time zone.',
    ]);
    expect(problems({ frequency: 'daily', time: '09:00', timeZone: 'UTC' })).toEqual([]);
    expect(
      problems({ frequency: 'daily', time: '09:00', timeZone: 'America/Argentina/Buenos_Aires' }),
    ).toEqual([]);
  });
});
