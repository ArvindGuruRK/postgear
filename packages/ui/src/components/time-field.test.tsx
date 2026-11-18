import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { formatTimeText, parseTimeText, TimeField } from './time-field';

describe('parseTimeText', () => {
  it.each([
    ['4', 4000],
    ['4.5', 4500],
    [' 12 ', 12000],
    ['75', 75000],
    ['1:02.3', 62300],
    ['0:04.0', 4000],
    ['1:02:03.5', 3723500],
    ['4.', 4000],
    ['.5', 500],
  ])('reads %s as %d ms', (text, ms) => {
    expect(parseTimeText(text)).toBe(ms);
  });

  it.each(['', 'abc', '4s', '-1', '1:75', '1:60:00', '1:2:3:4', '1::2', '1.2.3', ':5'])(
    'refuses %s',
    (text) => {
      expect(parseTimeText(text)).toBeNull();
    },
  );
});

describe('formatTimeText', () => {
  it.each([
    [0, '0:00.0'],
    [4000, '0:04.0'],
    [4049, '0:04.0'],
    [4050, '0:04.1'],
    [62300, '1:02.3'],
    [750_500, '12:30.5'],
    [3_723_500, '1:02:03.5'],
    [-50, '0:00.0'],
  ])('writes %d ms as %s', (ms, text) => {
    expect(formatTimeText(ms)).toBe(text);
  });

  it('shows hundredths when asked', () => {
    expect(formatTimeText(4033, 2)).toBe('0:04.03');
  });

  it('reads back what it writes', () => {
    for (const ms of [0, 4000, 62300, 3_723_500]) {
      expect(parseTimeText(formatTimeText(ms))).toBe(ms);
    }
  });
});

function Harness({
  initial = 4000,
  onChange,
  ...props
}: {
  initial?: number;
  onChange: (ms: number) => void;
  min?: number;
  max?: number;
  fps?: number;
}) {
  const [ms, setMs] = useState(initial);
  return (
    <TimeField
      aria-label="Playhead Time"
      valueMs={ms}
      onChange={(next) => {
        onChange(next);
        setMs(next);
      }}
      {...props}
    />
  );
}

function field() {
  return screen.getByRole('spinbutton', { name: 'Playhead Time' }) as HTMLInputElement;
}

describe('TimeField', () => {
  it('shows the value as a time code', () => {
    render(<Harness onChange={jest.fn()} />);
    expect(field()).toHaveValue('0:04.0');
    expect(field()).toHaveAttribute('aria-valuetext', '0:04.0');
  });

  it('does not call onChange while typing, only on Enter', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(field(), { target: { value: '1:02.3' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(field()).toHaveValue('1:02.3');
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(62300);
    expect(field()).toHaveValue('1:02.3');
  });

  it('commits on blur', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(field(), { target: { value: '4.5' } });
    fireEvent.blur(field());
    expect(onChange).toHaveBeenCalledWith(4500);
    expect(field()).toHaveValue('0:04.5');
  });

  it('puts back the last value when the text is not a time', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(field(), { target: { value: 'soon' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(field()).toHaveValue('0:04.0');

    fireEvent.change(field(), { target: { value: '1:99' } });
    fireEvent.blur(field());
    expect(onChange).not.toHaveBeenCalled();
    expect(field()).toHaveValue('0:04.0');
  });

  it('puts back the value on Escape', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(field(), { target: { value: '9' } });
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(field()).toHaveValue('0:04.0');
    fireEvent.blur(field());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not call onChange when the committed time is the same', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(field(), { target: { value: '4' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('steps one frame with the arrows', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} fps={30} initial={1000} />);
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(1033);
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(1067);
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith(1000);
  });

  it('steps one second with Shift and the arrows', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.keyDown(field(), { key: 'ArrowUp', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(5000);
    expect(field()).toHaveValue('0:05.0');
    fireEvent.keyDown(field(), { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(field(), { key: 'ArrowDown', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(3000);
  });

  it('steps from a good half-typed time', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(field(), { target: { value: '10' } });
    fireEvent.keyDown(field(), { key: 'ArrowUp', shiftKey: true });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(11000);
  });

  it('holds typed and stepped times between min and max', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} min={1000} max={8000} />);
    fireEvent.change(field(), { target: { value: '20' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(8000);
    expect(field()).toHaveValue('0:08.0');

    onChange.mockClear();
    fireEvent.keyDown(field(), { key: 'ArrowUp', shiftKey: true });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(field(), { target: { value: '0.2' } });
    fireEvent.blur(field());
    expect(onChange).toHaveBeenLastCalledWith(1000);
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
