'use client';

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Countdown,
  EmptyState,
  ErrorState,
  Progress,
  Skeleton,
  Spinner,
  SuccessState,
  ToastAction,
  useToast,
} from '@postgear/ui';
import { Inbox, Sparkles, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Row, Section } from '../shared';

export function FeedbackSection() {
  const { toast } = useToast();
  // Lazy initialisers so each target is fixed at mount rather than recomputed
  // on every render (which would restart the countdown's tick animation).
  const [launchTarget] = useState(
    () => new Date(Date.now() + 3 * 86_400_000 + 7 * 3_600_000 + 42 * 60_000 + 18_000),
  );
  const [urgentTarget] = useState(() => new Date(Date.now() + 45 * 60_000));

  return (
    <Section
      title="Feedback"
      description="Alerts, progress, loading states, and empty/error/success placeholders — every non-toast way the system talks back."
    >
      <Row label="Toasts (fire one)">
        <Button
          size="sm"
          onClick={() =>
            toast({ title: 'Post scheduled', description: 'Goes live tomorrow at 9:00 AM.' })
          }
        >
          Default
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() =>
            toast({
              variant: 'danger',
              title: 'Publish failed',
              description: 'LinkedIn rejected the request — token expired.',
            })
          }
        >
          Danger
        </Button>
        <Button
          size="sm"
          variant="ai"
          onClick={() =>
            toast({
              variant: 'ai',
              title: 'AI caption ready',
              description: 'Review it before it goes live.',
            })
          }
        >
          AI
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            toast({
              title: 'Event has been created',
              description: 'Sunday, December 03, 2023 at 9:00 AM',
              action: <ToastAction altText="Undo">Undo</ToastAction>,
            })
          }
        >
          With Undo
        </Button>
      </Row>
      <Row label="Toasts (fire several to see the stack)">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            toast({ title: 'Post scheduled', description: 'Goes live tomorrow at 9:00 AM.' });
            toast({ title: 'Draft saved', description: 'Picks up where you left off.' });
            toast({
              title: 'Event has been created',
              description: 'Sunday, December 03, 2023 at 9:00 AM',
              action: <ToastAction altText="Undo">Undo</ToastAction>,
            });
          }}
        >
          Fire 3
        </Button>
      </Row>
      <Row label="Alert">
        <div className="flex w-full max-w-md flex-col gap-3">
          <Alert>
            <AlertTitle>Heads up</AlertTitle>
            <AlertDescription>Your LinkedIn token expires in 3 days.</AlertDescription>
          </Alert>
          <Alert variant="success">
            <AlertTitle>Connected</AlertTitle>
            <AlertDescription>TikTok is now linked to this workspace.</AlertDescription>
          </Alert>
          <Alert variant="danger">
            <AlertTitle>Publish failed</AlertTitle>
            <AlertDescription>Instagram rejected the request — image too large.</AlertDescription>
          </Alert>
          <Alert variant="warning">
            <TriangleAlert className="h-4 w-4 shrink-0" strokeWidth={2.5} />
            <div>
              <AlertTitle>Approaching limit</AlertTitle>
              <AlertDescription>
                You&apos;ve used 90% of this month&apos;s AI credits.
              </AlertDescription>
            </div>
          </Alert>
        </div>
      </Row>
      <Row label="Progress">
        <div className="flex w-80 flex-col gap-4">
          {/* One flat fill per bar, straight off the locked action palette. */}
          <Progress value={77} size="lg" tone="danger" label="77% sold!" />
          <Progress value={64} size="lg" label="64% booked" />
          <Progress value={35} />
          <Progress value={80} tone="success" label="80%" />
          <Progress value={48} tone="accent" label="48%" />
          <Progress value={12} size="sm" tone="ai" label="12%" />
          {/* Stripes off — the plain fill the rest of the app already uses. */}
          <Progress value={60} striped={false} animated={false} />
        </div>
      </Row>
      <Row label="Countdown">
        <div className="flex flex-col gap-5">
          <Countdown to={launchTarget} size="lg" />
          <Countdown to={launchTarget} size="md" />
          {/* Under the default 1h threshold, so every tile shows the urgent state. */}
          <Countdown to={urgentTarget} size="sm" />
        </div>
      </Row>
      <Row label="Spinner">
        <Spinner size="sm" />
        <Spinner size="md" />
        <Spinner size="lg" />
      </Row>
      <Row label="Skeleton">
        <div className="flex w-56 flex-col gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </Row>
      <Row label="Empty / Error / Success State">
        <EmptyState
          icon={Inbox}
          title="No posts yet"
          description="Schedule your first post to see it here."
        />
        <ErrorState
          icon={TriangleAlert}
          title="Couldn't load analytics"
          description="Check your connection and try again."
        />
        <SuccessState
          icon={Sparkles}
          title="Channel connected"
          description="You're ready to schedule posts."
        />
      </Row>
    </Section>
  );
}
