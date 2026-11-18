import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Button } from './button';
import { TooltipProvider } from './tooltip';
import { VideoPlayerBar, type VideoPlayerBarProps } from './video-player-bar';

function Harness(props: Partial<VideoPlayerBarProps>) {
  const [playing, setPlaying] = useState(false);
  return (
    <TooltipProvider>
      <VideoPlayerBar
        playing={playing}
        onTogglePlay={() => setPlaying((was) => !was)}
        onBack={jest.fn()}
        onForward={jest.fn()}
        timeText="12:04 / 3:42:10"
        {...props}
      />
    </TooltipProvider>
  );
}

describe('VideoPlayerBar', () => {
  it('names its buttons and shows the time', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Back 5 Seconds' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Forward 5 Seconds' })).toBeInTheDocument();
    expect(screen.getByText('12:04 / 3:42:10')).toBeInTheDocument();
  });

  it('turns Play into Pause and back', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('calls back and forward', () => {
    const onBack = jest.fn();
    const onForward = jest.fn();
    render(<Harness onBack={onBack} onForward={onForward} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back 5 Seconds' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forward 5 Seconds' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onForward).toHaveBeenCalledTimes(1);
  });

  it('takes the editor its own step labels', () => {
    render(<Harness backLabel="Back One Frame" forwardLabel="Forward One Frame" />);
    expect(screen.getByRole('button', { name: 'Back One Frame' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Forward One Frame' })).toBeInTheDocument();
  });

  it('turns every button off when disabled', () => {
    render(<Harness disabled />);
    for (const name of ['Back 5 Seconds', 'Play', 'Forward 5 Seconds']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it('turns one step off on its own', () => {
    render(<Harness backDisabled />);
    expect(screen.getByRole('button', { name: 'Back 5 Seconds' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Forward 5 Seconds' })).toBeEnabled();
  });

  it('shows what the screen puts on its right', () => {
    render(
      <Harness>
        <Button size="sm">Create Clip</Button>
      </Harness>,
    );
    expect(screen.getByRole('button', { name: 'Create Clip' })).toBeInTheDocument();
  });
});
