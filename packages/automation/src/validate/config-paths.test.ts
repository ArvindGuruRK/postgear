import { z } from 'zod';
import { asRecord, getAtPath, plainErrorMap, stringsIn } from './config-paths';

const message = (schema: z.ZodTypeAny, value: unknown) => {
  const parsed = schema.safeParse(value, { errorMap: plainErrorMap });
  return parsed.success ? undefined : parsed.error.issues[0]?.message;
};

describe('plain words for config problems', () => {
  it('asks to fill in a missing or empty field', () => {
    expect(message(z.object({ a: z.string() }), {})).toBe('Fill in this field.');
    expect(message(z.string().min(1), '')).toBe('Fill in this field.');
  });

  it('says what is wrong with sizes', () => {
    expect(message(z.string().max(3), 'long')).toBe('Keep this to 3 characters or fewer.');
    expect(message(z.array(z.string()).min(2), ['a'])).toBe('Add at least 2.');
    expect(message(z.array(z.string()).max(1), ['a', 'b'])).toBe('Use 1 or fewer.');
    expect(message(z.number().min(3), 1)).toBe('Use 3 or more.');
    expect(message(z.number().max(3), 9)).toBe('Use 3 or less.');
  });

  it('asks to choose an option, and explains unknown settings', () => {
    expect(message(z.enum(['a', 'b']), 'c')).toBe('Choose one of the options.');
    expect(message(z.literal('a'), 'b')).toBe('Choose one of the options.');
    expect(message(z.union([z.literal('a'), z.number()]), 'b')).toBe('Choose one of the options.');
    expect(message(z.object({}).strict(), { x: 1 })).toBe(
      'This step has settings this version of PostGear does not know.',
    );
    expect(message(z.string(), 4)).toBe('This value is not valid here.');
    expect(message(z.string().email(), 'nope')).toBe('This value is not valid here.');
  });

  it('keeps the message a schema wrote itself', () => {
    expect(message(z.string().min(1, 'Name this path.'), '')).toBe('Name this path.');
  });
});

describe('reading config by path', () => {
  it('reads nested values and lists, and gives up quietly', () => {
    const config = { a: [{ b: 1 }], c: 'x' };
    expect(getAtPath(config, 'a.0.b')).toBe(1);
    expect(getAtPath(config, 'c.d')).toBeUndefined();
    expect(asRecord([1])).toEqual({});
    expect(asRecord(config)).toBe(config);
  });

  it('finds every string with its path', () => {
    expect(stringsIn({ a: 'x', b: [{ c: 'y' }, 2], d: null })).toEqual([
      { path: 'a', value: 'x' },
      { path: 'b.0.c', value: 'y' },
    ]);
    expect(stringsIn(['z'])).toEqual([{ path: '0', value: 'z' }]);
  });
});
