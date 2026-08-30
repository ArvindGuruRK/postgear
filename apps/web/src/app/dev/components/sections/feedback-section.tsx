'use client';

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
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
import { Row, Section } from '../shared';

export function FeedbackSection() {
  const { toast } = useToast();

  return (
    <Section
      title="Feedback"
      description="Alerts, progress, loading states, and empty/error/success placeholders — every non-toast way the system talks back."
    >
      <Row label="Toasts (fire one)">
        <Button
          size="sm"
          onClick={() => toast({ title: 'Post scheduled', description: 'Goes live tomorrow at 9:00 AM.' })}
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
            toast({ variant: 'ai', title: 'AI caption ready', description: 'Review it before it goes live.' })
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
              <AlertDescription>You&apos;ve used 90% of this month&apos;s AI credits.</AlertDescription>
            </div>
          </Alert>
        </div>
      </Row>
      <Row label="Progress">
        <div className="flex w-56 flex-col gap-3">
          <Progress value={35} />
          <Progress value={80} />
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
        <EmptyState icon={Inbox} title="No posts yet" description="Schedule your first post to see it here." />
        <ErrorState icon={TriangleAlert} title="Couldn't load analytics" description="Check your connection and try again." />
        <SuccessState icon={Sparkles} title="Channel connected" description="You're ready to schedule posts." />
      </Row>
    </Section>
  );
}
