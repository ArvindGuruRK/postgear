import type { SourceItem } from '../../types';
import {
  byDateThenName,
  type FestivalOrigin,
  festivalItem,
  festivalNameKeys,
  mergeFestivals,
} from './merge';

const CURLY_APOSTROPHE = String.fromCodePoint(0x2019);

/** A hand-made row, the way a reader would hand it over. */
function row(
  origin: FestivalOrigin,
  date: string,
  name: string,
  badge: 'holiday' | 'observance' = 'holiday',
): SourceItem {
  const item = festivalItem({ name, date, observance: badge === 'observance', origin });
  if (!item) throw new Error(`"${name}" on ${date} is not a festival row`);
  return item;
}

const calendar = (date: string, name: string, badge?: 'holiday' | 'observance') =>
  row('Google Calendar', date, name, badge);
const library = (date: string, name: string, badge?: 'holiday' | 'observance') =>
  row('date-holidays', date, name, badge);

const shown = (items: SourceItem[]) =>
  items.map((item) => `${item.date} ${item.title} (${item.observance ? 'observance' : 'holiday'})`);

describe('festivalItem', () => {
  it('builds the row the tab shows', () => {
    expect(
      festivalItem({
        name: 'Diwali/Deepavali',
        date: '2026-11-08',
        observance: false,
        origin: 'Google Calendar',
      }),
    ).toEqual({
      kind: 'festival',
      source: { id: 'holidays', name: 'Google Calendar' },
      title: 'Diwali/Deepavali',
      date: '2026-11-08',
      observance: false,
    });
  });

  it('keeps a name as it is written, brackets and all', () => {
    const item = festivalItem({
      name: 'Ramzan Id (tentative)',
      date: '2027-03-10',
      observance: false,
      origin: 'Google Calendar',
    });
    expect(item?.title).toBe('Ramzan Id (tentative)');
  });

  it.each(['', '   ', '05-01', '2027', '***', '(   )', '<b></b>'])(
    'is nothing for the placeholder name %j',
    (name) => {
      expect(
        festivalItem({ name, date: '2027-05-01', observance: false, origin: 'date-holidays' }),
      ).toBeNull();
    },
  );

  it.each(['தைப்பொங்கல்', 'गणतंत्र दिवस', 'عيد الفطر', '春节', '1. Advent'])(
    'keeps the name %s',
    (name) => {
      const item = festivalItem({
        name,
        date: '2027-01-15',
        observance: true,
        origin: 'date-holidays',
      });
      expect(item?.title).toBe(name);
    },
  );

  it.each(['2026-02-31', '20261108', 'soon', ''])('is nothing for the date %j', (date) => {
    expect(
      festivalItem({ name: 'Diwali', date, observance: false, origin: 'Google Calendar' }),
    ).toBeNull();
  });

  it('makes a name plain text', () => {
    const item = festivalItem({
      name: '<b>Diwali</b> &amp; <script>alert(1)</script>Lights',
      date: '2026-11-08',
      observance: false,
      origin: 'Google Calendar',
    });
    expect(item?.title).toBe('Diwali & Lights');
  });

  it('takes out control characters and a text direction override', () => {
    const item = festivalItem({
      name: `Diwali${String.fromCodePoint(0x202e)}ilawiD${String.fromCodePoint(7)}  Night`,
      date: '2026-11-08',
      observance: false,
      origin: 'Google Calendar',
    });
    expect(item?.title).toBe('DiwaliilawiD Night');
  });

  it('gives a row no link: there is nowhere to open', () => {
    const item = festivalItem({
      name: 'Pongal',
      date: '2027-01-15',
      observance: true,
      origin: 'Google Calendar',
    });
    expect(item).not.toHaveProperty('url');
    expect(item?.source).toEqual({ id: 'holidays', name: 'Google Calendar' });
  });
});

describe('festivalNameKeys', () => {
  it.each([
    ['Christmas Day', ['christmas']],
    ['Christmas', ['christmas']],
    ['CHRISTMAS  DAY', ['christmas']],
    ["New Year's Day", ['new years']],
    [`New Year${CURLY_APOSTROPHE}s Day`, ['new years']],
    [`All Saints${CURLY_APOSTROPHE} Day`, ['all saints']],
    ["All Saints' Day", ['all saints']],
    ['Diwali/Deepavali', ['diwali', 'deepavali']],
    ['Deepavali', ['deepavali']],
    ['Muharram/Ashura (tentative)', ['muharram', 'ashura']],
    ['Ramzan Id (tentative)', ['ramzan id']],
    ['Chhat Puja (Pratihar Sashthi/Surya Sashthi)', ['chhat puja']],
    ['Christmas Day (substitute day)', ['christmas']],
    ['Independence Day [observed]', ['independence']],
    ['Martin Luther King Jr. Day', ['martin luther king jr']],
    ['César Chávez Day', ['cesar chavez']],
    ['Fête du travail', ['fete du travail']],
    ['Day after Thanksgiving Day', ['after thanksgiving']],
    ['Labour Day', ['labor']],
    ['Labor Day', ['labor']],
    ['1. Advent', ['1 advent']],
    ['Milad un-Nabi', ['milad un nabi']],
  ])('reads %s as %j', (name, keys) => {
    expect(festivalNameKeys(name)).toEqual(keys);
  });

  it('drops the word day, and not a word that only holds it', () => {
    expect(festivalNameKeys('Daylight Saving Time ends')).toEqual(['daylight saving time ends']);
    expect(festivalNameKeys('Holiday Monday')).toEqual(['holiday monday']);
    expect(festivalNameKeys('Good Friday')).toEqual(['good friday']);
  });

  it('does not take the vowel marks out of Tamil or Hindi', () => {
    expect(festivalNameKeys('தைப்பொங்கல்')).toEqual(['தைப்பொங்கல்'.normalize('NFKD')]);
    expect(festivalNameKeys('गणतंत्र दिवस')).toEqual(['गणतंत्र दिवस'.normalize('NFKD')]);
    expect(festivalNameKeys('தை')).not.toEqual(festivalNameKeys('தி'));
  });

  it('gives a name on both sides of a slash once', () => {
    expect(festivalNameKeys('Diwali/Diwali Day')).toEqual(['diwali']);
  });

  it.each(['Day', '(tentative)', '/', 'Day/Day'])(
    'compares the name %j whole, so it matches only itself',
    (name) => {
      const keys = festivalNameKeys(name);
      expect(keys).toHaveLength(1);
      expect(keys[0]).not.toBe('');
      expect(keys).toEqual([name.toLowerCase()]);
    },
  );
});

describe('mergeFestivals', () => {
  it('reads Diwali/Deepavali and a library Deepavali as one festival, under the calendar name', () => {
    const merged = mergeFestivals(
      [calendar('2026-11-08', 'Diwali/Deepavali')],
      [library('2026-11-08', 'Deepavali')],
    );

    expect(merged).toEqual([
      {
        kind: 'festival',
        source: { id: 'holidays', name: 'Google Calendar' },
        title: 'Diwali/Deepavali',
        date: '2026-11-08',
        observance: false,
      },
    ]);
  });

  it('matches the other side of the slash too, and a library name with a slash', () => {
    expect(
      mergeFestivals(
        [calendar('2026-11-08', 'Diwali/Deepavali')],
        [library('2026-11-08', 'Diwali')],
      ),
    ).toHaveLength(1);
    expect(
      mergeFestivals(
        [calendar('2026-11-08', 'Deepavali')],
        [library('2026-11-08', 'Diwali/Deepavali')],
      ).map((item) => item.title),
    ).toEqual(['Deepavali']);
  });

  it('joins two rows that each match one side of a third', () => {
    const merged = mergeFestivals(
      [calendar('2026-11-08', 'Deepavali', 'observance')],
      [library('2026-11-08', 'Diwali/Deepavali', 'observance'), library('2026-11-08', 'Diwali')],
    );
    expect(shown(merged)).toEqual(['2026-11-08 Deepavali (holiday)']);
  });

  it('keeps Pongal an observance when nothing says it is a day off', () => {
    const merged = mergeFestivals(
      [
        calendar('2027-01-15', 'Pongal', 'observance'),
        calendar('2027-01-15', 'Guru Govind Singh Jayanti', 'observance'),
      ],
      [library('2027-01-26', 'Republic Day')],
    );

    expect(shown(merged)).toEqual([
      '2027-01-15 Guru Govind Singh Jayanti (observance)',
      '2027-01-15 Pongal (observance)',
      '2027-01-26 Republic Day (holiday)',
    ]);
  });

  it('keeps an observance an observance when the library agrees', () => {
    const merged = mergeFestivals(
      [calendar('2027-01-15', 'Pongal', 'observance')],
      [library('2027-01-15', 'Pongal', 'observance')],
    );
    expect(shown(merged)).toEqual(['2027-01-15 Pongal (observance)']);
  });

  it('lets the stronger badge win, whichever reader holds it', () => {
    expect(
      shown(
        mergeFestivals(
          [calendar('2027-01-15', 'Pongal', 'observance')],
          [library('2027-01-15', 'Pongal', 'holiday')],
        ),
      ),
    ).toEqual(['2027-01-15 Pongal (holiday)']);

    expect(
      shown(
        mergeFestivals(
          [calendar('2026-12-25', 'Christmas', 'holiday')],
          [library('2026-12-25', 'Christmas Day', 'observance')],
        ),
      ),
    ).toEqual(['2026-12-25 Christmas (holiday)']);
  });

  it('leaves the row with the calendar when its badge comes from the library', () => {
    const [merged] = mergeFestivals(
      [calendar('2027-01-15', 'Pongal', 'observance')],
      [library('2027-01-15', 'Pongal', 'holiday')],
    );
    expect(merged.source).toEqual({ id: 'holidays', name: 'Google Calendar' });
  });

  it('keeps both names when a date has two festivals', () => {
    const merged = mergeFestivals(
      [
        calendar('2026-11-08', 'Diwali/Deepavali'),
        calendar('2026-11-08', 'Naraka Chaturdasi', 'observance'),
      ],
      [],
    );

    expect(shown(merged)).toEqual([
      '2026-11-08 Diwali/Deepavali (holiday)',
      '2026-11-08 Naraka Chaturdasi (observance)',
    ]);
  });

  it('keeps a library row the calendar has no name for on that date', () => {
    const merged = mergeFestivals(
      [calendar('2026-11-27', 'Black Friday', 'observance')],
      [library('2026-11-27', 'Day after Thanksgiving Day')],
    );

    expect(merged.map((item) => [item.title, item.source.name, item.observance])).toEqual([
      ['Black Friday', 'Google Calendar', true],
      ['Day after Thanksgiving Day', 'date-holidays', false],
    ]);
  });

  it('never joins the same name on two dates: next year is another festival', () => {
    const merged = mergeFestivals(
      [calendar('2026-11-08', 'Diwali/Deepavali'), calendar('2027-10-29', 'Diwali/Deepavali')],
      [library('2026-11-09', 'Deepavali')],
    );
    expect(merged.map((item) => item.date)).toEqual(['2026-11-08', '2026-11-09', '2027-10-29']);
  });

  it('sees through an apostrophe, an accent, a bracket, the word day and a spelling', () => {
    const merged = mergeFestivals(
      [
        calendar('2027-01-01', "New Year's Day"),
        calendar('2027-03-31', 'Cesar Chavez Day', 'observance'),
        calendar('2027-07-05', 'Independence Day (substitute)'),
        calendar('2026-12-25', 'Christmas'),
        calendar('2027-09-06', 'Labor Day'),
      ],
      [
        library('2027-01-01', `New Year${CURLY_APOSTROPHE}s Day`),
        library('2027-03-31', 'César Chávez Day'),
        library('2027-07-05', 'Independence Day (substitute day)'),
        library('2026-12-25', 'Christmas Day'),
        library('2027-09-06', 'Labour Day'),
      ],
    );

    expect(shown(merged)).toEqual([
      '2026-12-25 Christmas (holiday)',
      "2027-01-01 New Year's Day (holiday)",
      '2027-03-31 Cesar Chavez Day (holiday)',
      '2027-07-05 Independence Day (substitute) (holiday)',
      '2027-09-06 Labor Day (holiday)',
    ]);
  });

  it('does not join names that only share words', () => {
    const merged = mergeFestivals(
      [
        calendar('2027-12-24', 'Christmas Day (substitute)'),
        calendar('2027-12-24', 'Christmas Eve', 'observance'),
        calendar('2026-10-02', 'Mahatma Gandhi Jayanti'),
      ],
      [library('2026-10-02', 'Gandhi Jayanti')],
    );

    expect(shown(merged)).toEqual([
      '2026-10-02 Gandhi Jayanti (holiday)',
      '2026-10-02 Mahatma Gandhi Jayanti (holiday)',
      '2027-12-24 Christmas Day (substitute) (holiday)',
      '2027-12-24 Christmas Eve (observance)',
    ]);
  });

  it('shows the day off when one reader lists a festival twice on a date', () => {
    // India 2027-08-25, in the order the recorded calendar lists them.
    const merged = mergeFestivals(
      [
        calendar('2027-08-25', 'Janmashtami (Smarta)', 'observance'),
        calendar('2027-08-25', 'Janmashtami', 'holiday'),
      ],
      [],
    );
    expect(shown(merged)).toEqual(['2027-08-25 Janmashtami (holiday)']);

    const otherOrder = mergeFestivals(
      [
        calendar('2026-09-04', 'Janmashtami', 'holiday'),
        calendar('2026-09-04', 'Janmashtami (Smarta)', 'observance'),
      ],
      [],
    );
    expect(shown(otherOrder)).toEqual(['2026-09-04 Janmashtami (holiday)']);
  });

  it('shows the plainer name when one reader lists a festival twice with one badge', () => {
    const merged = mergeFestivals(
      [],
      [library('2027-03-23', 'Nauryz (substitute day)'), library('2027-03-23', 'Nauryz')],
    );
    expect(shown(merged)).toEqual(['2027-03-23 Nauryz (holiday)']);
  });

  it('shows the calendar name even when the library row is the day off', () => {
    const merged = mergeFestivals(
      [calendar('2027-08-15', 'Assumption of Mary', 'observance')],
      [library('2027-08-15', 'Assumption Of Mary', 'holiday')],
    );
    expect(merged.map((item) => [item.title, item.observance])).toEqual([
      ['Assumption of Mary', false],
    ]);
  });

  it('answers by date, then by name', () => {
    const merged = mergeFestivals(
      [
        calendar('2027-01-15', 'Pongal', 'observance'),
        calendar('2026-11-24', "Guru Tegh Bahadur's Martyrdom Day", 'observance'),
        calendar('2026-11-24', 'Guru Nanak Jayanti'),
        calendar('2026-11-08', 'Naraka Chaturdasi', 'observance'),
      ],
      [library('2026-11-08', 'bhai duj', 'observance'), library('2026-11-08', 'Anna Day')],
    );

    expect(merged.map((item) => item.title)).toEqual([
      'Anna Day',
      'bhai duj',
      'Naraka Chaturdasi',
      'Guru Nanak Jayanti',
      "Guru Tegh Bahadur's Martyrdom Day",
      'Pongal',
    ]);
  });

  it('changes neither list it was given', () => {
    const fromCalendar = [calendar('2027-01-15', 'Pongal', 'observance')];
    const fromLibrary = [library('2027-01-15', 'Pongal', 'holiday')];
    const before = JSON.stringify([fromCalendar, fromLibrary]);

    mergeFestivals(fromCalendar, fromLibrary);

    expect(JSON.stringify([fromCalendar, fromLibrary])).toBe(before);
  });

  it('leaves out a row with no date, and answers nothing for nothing', () => {
    const undated: SourceItem = { ...calendar('2027-01-15', 'Pongal'), date: undefined };
    expect(mergeFestivals([undated], [])).toEqual([]);
    expect(mergeFestivals([], [])).toEqual([]);
  });
});

describe('byDateThenName', () => {
  it('orders by date first, then by name without minding the case', () => {
    const rows = [
      { date: '2026-11-11', title: 'Armistice Day' },
      { date: '2026-11-08', title: 'naraka Chaturdasi' },
      { date: '2026-11-08', title: 'Diwali/Deepavali' },
      { title: 'Undated' },
    ];
    expect([...rows].sort(byDateThenName).map((entry) => entry.title)).toEqual([
      'Undated',
      'Diwali/Deepavali',
      'naraka Chaturdasi',
      'Armistice Day',
    ]);
  });
});
