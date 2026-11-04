import { fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { parseTime, TimePicker, timeText, useTimeText } from './time-picker';

describe('parseTime', () => {
  it('reads a 24 hour time', () => {
    expect(parseTime('14:05')).toEqual({ hours: 14, minutes: 5 });
    expect(parseTime('00:00')).toEqual({ hours: 0, minutes: 0 });
  });

  it.each(['24:00', '9:00', '9am', '', null, undefined])('refuses %s', (value) => {
    expect(parseTime(value)).toBeNull();
  });
});

describe('timeText', () => {
  it.each([
    ['00:00', '12:00 AM'],
    ['09:05', '9:05 AM'],
    ['12:00', '12:00 PM'],
    ['23:55', '11:55 PM'],
  ])('%s on a 12 hour clock is %s', (value, text) => {
    expect(timeText(value, true)).toBe(text);
  });

  it('stays as stored on a 24 hour clock', () => {
    expect(timeText('09:05', false)).toBe('09:05');
  });

  it('leaves anything else alone', () => {
    expect(timeText('soon', true)).toBe('soon');
  });
});

describe('useTimeText', () => {
  const useClock = (hourCycle: 'h12' | 'h23') =>
    jest
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({ hourCycle } as Intl.ResolvedDateTimeFormatOptions);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes a saved time on a 12 hour clock', () => {
    useClock('h12');
    const { result } = renderHook(() => useTimeText());
    expect(result.current('09:00')).toBe('9:00 AM');
    expect(result.current('14:05')).toBe('2:05 PM');
  });

  it('leaves a saved time as it is on a 24 hour clock', () => {
    useClock('h23');
    const { result } = renderHook(() => useTimeText());
    expect(result.current('09:00')).toBe('09:00');
  });

  it('stays the same function while the clock stays the same', () => {
    useClock('h12');
    const { result, rerender } = renderHook(() => useTimeText());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe('TimePicker', () => {
  // The picker follows the viewer's clock: pinned, so this reads the same on any machine.
  const useClock = (hourCycle: 'h12' | 'h23') =>
    jest
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({ hourCycle } as Intl.ResolvedDateTimeFormatOptions);

  beforeEach(() => {
    useClock('h12');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const written = jest.fn();

  function Harness({ start }: { start: string | null }) {
    const [value, setValue] = useState(start);
    return (
      <TimePicker
        label="Time"
        value={value}
        onValueChange={(next) => {
          written(next);
          setValue(next);
        }}
      />
    );
  }

  /** The open popover hides the rest of the page from assistive technology. */
  const trigger = () => screen.getByRole('button', { name: /^Time/, hidden: true });
  const key = (name: string) => screen.getByRole('button', { name });

  it('shows the time on its trigger and the chosen keys when open', () => {
    render(<Harness start="14:05" />);
    expect(trigger()).toHaveAccessibleName('Time: 2:05 PM');
    expect(trigger()).toHaveAttribute('data-value', '14:05');
    fireEvent.click(trigger());
    expect(key('2')).toHaveAttribute('aria-pressed', 'true');
    expect(key('05')).toHaveAttribute('aria-pressed', 'true');
    expect(key('PM')).toHaveAttribute('aria-pressed', 'true');
    expect(key('AM')).toHaveAttribute('aria-pressed', 'false');
  });

  it('writes a 24 hour time whichever key is pressed', () => {
    render(<Harness start="14:05" />);
    fireEvent.click(trigger());
    fireEvent.click(key('12'));
    expect(written).toHaveBeenLastCalledWith('12:05');
    fireEvent.click(key('AM'));
    expect(written).toHaveBeenLastCalledWith('00:05');
    fireEvent.click(key('30'));
    expect(written).toHaveBeenLastCalledWith('00:30');
    fireEvent.click(key('9'));
    expect(written).toHaveBeenLastCalledWith('09:30');
    fireEvent.click(key('PM'));
    expect(written).toHaveBeenLastCalledWith('21:30');
    expect(trigger()).toHaveAccessibleName('Time: 9:30 PM');
  });

  it('keeps a stored minute that is not on a step', () => {
    render(<Harness start="09:07" />);
    fireEvent.click(trigger());
    expect(key('07')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows 00 to 23 and no AM or PM where the clock runs to 24', () => {
    jest.restoreAllMocks();
    useClock('h23');
    render(<Harness start="14:05" />);
    expect(trigger()).toHaveAccessibleName('Time: 14:05');
    fireEvent.click(trigger());
    expect(key('14')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'PM' })).toBeNull();
    const hours = within(screen.getByRole('group', { name: 'Hour' }));
    fireEvent.click(hours.getByRole('button', { name: '00' }));
    expect(written).toHaveBeenLastCalledWith('00:05');
  });

  it('starts empty on the placeholder, and the first press sets a time', () => {
    render(<Harness start={null} />);
    expect(trigger()).toHaveTextContent('Pick a time');
    fireEvent.click(trigger());
    fireEvent.click(key('15'));
    expect(written).toHaveBeenLastCalledWith('09:15');
  });

  it('closes on Done', () => {
    render(<Harness start="09:00" />);
    fireEvent.click(trigger());
    fireEvent.click(key('Done'));
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  });
});
