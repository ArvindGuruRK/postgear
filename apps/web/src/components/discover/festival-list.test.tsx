/**
 * The Festivals list (Module 05): sections by week in the page's order, each
 * row with its date, name, badge and how far off it is, counted from the
 * answer's `today` and never from the machine's clock, and Plan A Post
 * handing back the festival it was pressed on.
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { DiscoverItem } from '@/types/discover';
import { stubBrowserLayout } from '../workflows/fields/test-dom';
import { FestivalList } from './festival-list';

beforeAll(stubBrowserLayout);

function festival(date: string, title: string, observance: boolean): DiscoverItem {
  return {
    id: `${date}|${title}`,
    kind: 'festival',
    source: { id: 'holidays', name: 'Google Calendar' },
    title,
    date,
    observance,
    brief: `Festival in India: "${title}".`,
  };
}

/** India around 10 November 2026 (a Tuesday), as the recorded calendar has it. */
const TODAY = '2026-11-10';
const DIWALI = festival('2026-11-08', 'Diwali/Deepavali', false);
const GOVARDHAN = festival('2026-11-09', 'Govardhan Puja', true);
const BHAI_DUJ = festival('2026-11-11', 'Bhai Duj', true);
const CHHAT = festival('2026-11-15', 'Chhat Puja (Pratihar Sashthi/Surya Sashthi)', true);
const GURU_NANAK = festival('2026-11-24', 'Guru Nanak Jayanti', false);
const DECEMBER = festival('2026-12-03', 'கார்த்திகை தீபம்', true);
const INDIA = [DIWALI, GOVARDHAN, BHAI_DUJ, CHHAT, GURU_NANAK, DECEMBER];

function row(name: string): HTMLElement {
  const found = screen.getByText(name).closest('[data-testid="discover-festival-row"]');
  if (!(found instanceof HTMLElement)) throw new Error(`no row for ${name}`);
  return found;
}

describe('FestivalList', () => {
  it('draws the sections that have festivals, in order, each under its name', () => {
    render(<FestivalList items={INDIA} today={TODAY} />);

    expect(screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent)).toEqual([
      'This Week',
      'Later This Month',
      'Next Month',
      'Just Happened',
    ]);

    const thisWeek = screen.getByRole('region', { name: 'This Week' });
    expect(
      within(thisWeek)
        .getAllByTestId('discover-festival-row')
        .map((node) => node.querySelector('time')?.getAttribute('datetime')),
    ).toEqual(['2026-11-11', '2026-11-15']);

    // What just happened reads most recent first.
    const past = screen.getByRole('region', { name: 'Just Happened' });
    expect(
      within(past)
        .getAllByTestId('discover-festival-row')
        .map((node) => node.querySelector('time')?.getAttribute('datetime')),
    ).toEqual(['2026-11-09', '2026-11-08']);
  });

  it('writes a row: the date and weekday, the name, the badge, how far off', () => {
    render(<FestivalList items={INDIA} today={TODAY} />);

    const diwali = within(row('Diwali/Deepavali'));
    expect(diwali.getByText('8 Nov')).toBeInTheDocument();
    expect(diwali.getByText('Sunday')).toBeInTheDocument();
    expect(diwali.getByText('Public Holiday')).toBeInTheDocument();
    expect(diwali.getByTestId('festival-when')).toHaveTextContent('2 days ago');

    const bhaiDuj = within(row('Bhai Duj'));
    expect(bhaiDuj.getByText('11 Nov')).toBeInTheDocument();
    expect(bhaiDuj.getByText('Wednesday')).toBeInTheDocument();
    expect(bhaiDuj.getByText('Observance')).toBeInTheDocument();
    expect(bhaiDuj.getByTestId('festival-when')).toHaveTextContent('tomorrow');

    expect(within(row('Govardhan Puja')).getByTestId('festival-when')).toHaveTextContent(
      'yesterday',
    );
    expect(within(row('Guru Nanak Jayanti')).getByTestId('festival-when')).toHaveTextContent(
      'in 14 days',
    );
    expect(within(row('Guru Nanak Jayanti')).getByText('Public Holiday')).toBeInTheDocument();
  });

  it("counts from the answer's today, whatever the machine's clock says", () => {
    jest.useFakeTimers({ now: new Date('2031-05-05T12:00:00Z') });
    try {
      render(<FestivalList items={INDIA} today={TODAY} />);

      expect(within(row('Bhai Duj')).getByTestId('festival-when')).toHaveTextContent('tomorrow');
      expect(screen.getByRole('region', { name: 'This Week' })).toContainElement(row('Bhai Duj'));

      // The same festivals read from the day itself.
      render(<FestivalList items={[CHHAT]} today="2026-11-15" />);
      expect(screen.getAllByText('today')).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('lets the browser pick the direction of a name', () => {
    render(<FestivalList items={INDIA} today={TODAY} />);
    expect(screen.getByText('கார்த்திகை தீபம்')).toHaveAttribute('dir', 'auto');
  });

  it('hands Plan A Post the festival it was pressed on', () => {
    const onPlanPost = jest.fn();
    render(<FestivalList items={INDIA} today={TODAY} onPlanPost={onPlanPost} />);

    fireEvent.click(within(row('Diwali/Deepavali')).getByRole('button', { name: 'Plan A Post' }));
    expect(onPlanPost).toHaveBeenCalledTimes(1);
    expect(onPlanPost).toHaveBeenCalledWith(DIWALI);

    // A festival that just happened can still be planned for: every row has the button.
    expect(screen.getAllByRole('button', { name: 'Plan A Post' })).toHaveLength(INDIA.length);
  });

  it('shows no Plan A Post without a sheet to open', () => {
    render(<FestivalList items={INDIA} today={TODAY} />);
    expect(screen.queryByRole('button', { name: 'Plan A Post' })).not.toBeInTheDocument();
  });

  it('is one unnamed list, with no "in N days", when the answer has no today', () => {
    render(<FestivalList items={INDIA} today={undefined} />);

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('discover-festival-row')).toHaveLength(INDIA.length);
    expect(screen.queryByTestId('festival-when')).not.toBeInTheDocument();
  });
});
