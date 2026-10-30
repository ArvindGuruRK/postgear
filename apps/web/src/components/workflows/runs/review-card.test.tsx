import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import { answerReview } from '@/lib/workflows-api';
import { ReviewCard } from './review-card';
import { makeStep } from './run-test-fixtures';

jest.mock('@/lib/workflows-api', () => ({ answerReview: jest.fn() }));

const answer = answerReview as jest.MockedFunction<typeof answerReview>;

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList;
});

beforeEach(() => answer.mockReset());

const waiting = makeStep({
  nodeKey: 'review',
  nodeType: 'logic.manualReview',
  nodeName: 'Manual Review',
  status: 'WAITING',
  input: { text: 'Fresh sourdough today', image: '', instructions: 'Check the price.' },
  output: null,
  startedAt: new Date(Date.now() - 86_400_000 + 60_000).toISOString(),
  finishedAt: null,
});

describe('ReviewCard', () => {
  it('shows the content, the instructions and the expiry', () => {
    render(<ReviewCard runId="run-1" step={waiting} />);
    expect(screen.getByText('Fresh sourdough today')).toBeTruthy();
    expect(screen.getByText('Check the price.')).toBeTruthy();
    expect(screen.getByText('Expires in 6 days')).toBeTruthy();
  });

  it('calls the API once, however often Approve is pressed', async () => {
    let resolve: (value: Awaited<ReturnType<typeof answerReview>>) => void = () => undefined;
    answer.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const onAnswered = jest.fn();
    render(<ReviewCard runId="run-1" step={waiting} onAnswered={onAnswered} />);
    const approve = screen.getByRole('button', { name: 'Approve' });
    fireEvent.click(approve);
    fireEvent.click(approve);
    expect(answer).toHaveBeenCalledTimes(1);
    expect(answer).toHaveBeenCalledWith('run-1', 'review', { decision: 'approved' });
    expect((approve as HTMLButtonElement).disabled).toBe(true);

    resolve({ nodeKey: 'review', decision: 'approved', decidedAt: new Date().toISOString() });
    await waitFor(() => expect(onAnswered).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Approved')).toBeTruthy();
  });

  it('sends the edited text with Edit Then Approve', async () => {
    answer.mockResolvedValue({
      nodeKey: 'review',
      decision: 'approved',
      decidedAt: new Date().toISOString(),
    });
    render(<ReviewCard runId="run-1" step={waiting} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Then Approve' }));
    fireEvent.change(screen.getByLabelText('Text to approve'), {
      target: { value: 'Fresh sourdough, 4 pounds' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Approve Edited Text' }));
    await waitFor(() =>
      expect(answer).toHaveBeenCalledWith('run-1', 'review', {
        decision: 'approved',
        editedText: 'Fresh sourdough, 4 pounds',
      }),
    );
  });

  it('rejects with the optional reason', async () => {
    answer.mockResolvedValue({
      nodeKey: 'review',
      decision: 'rejected',
      decidedAt: new Date().toISOString(),
    });
    render(<ReviewCard runId="run-1" step={waiting} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    fireEvent.change(screen.getByLabelText('Reason (optional)'), {
      target: { value: 'Wrong price' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() =>
      expect(answer).toHaveBeenCalledWith('run-1', 'review', {
        decision: 'rejected',
        reason: 'Wrong price',
      }),
    );
    expect(answer).toHaveBeenCalledTimes(1);
  });

  it('says so when someone else answered first, and asks for a refresh', async () => {
    answer.mockRejectedValue(
      new ApiError('This review was already answered.', 409, 'review_answered'),
    );
    const onAnswered = jest.fn();
    render(<ReviewCard runId="run-1" step={waiting} onAnswered={onAnswered} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(onAnswered).toHaveBeenCalledWith(null));
    expect(screen.getByText('Someone else answered this review first.')).toBeTruthy();
  });

  it('shows who decided, and never styles Rejected as a failure', () => {
    const decidedAt = new Date(2026, 9, 29, 9, 14).toISOString();
    render(
      <ReviewCard
        runId="run-1"
        step={{
          ...waiting,
          status: 'SUCCEEDED',
          output: { decision: 'rejected', reviewedBy: 'Priya', decidedAt, reason: 'Too long' },
        }}
      />,
    );
    const badge = screen.getByText('Rejected');
    expect(badge.className).not.toMatch(/actionDanger/);
    expect(badge.className).toMatch(/bg-transparent/);
    expect(screen.getByTestId('review-decided').textContent).toMatch(/^Rejected by Priya, /);
    expect(screen.getByText('Reason: Too long')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });
});
