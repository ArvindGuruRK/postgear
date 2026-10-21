import { SparklesIcon } from '@animateicons/react/lucide/sparkles-icon';
import { Badge, Button, MotionIcon } from '@postgear/ui';
import { Row, Section } from '../shared';

export function ButtonsSection() {
  return (
    <>
      <Section
        title="Buttons"
        description="One primary per area, secondary for everything else, red for deletes, violet for asking the AI. shadow-brutalMd collapses to shadow-brutalPressed on click."
      >
        <Row label="Primary (one per area)">
          <Button size="sm">Create Post</Button>
          <Button size="md">Create Post</Button>
          <Button size="lg">Create Post</Button>
          <Button disabled>Disabled</Button>
        </Row>
        <Row label="Secondary (everything else)">
          <Button variant="secondary">Add Channel</Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
        </Row>
        <Row label="Danger (deletes)">
          <Button variant="danger">Delete</Button>
          <Button variant="danger" disabled>
            Disabled
          </Button>
        </Row>
        <Row label="AI (asking the AI)">
          <Button variant="ai">
            <MotionIcon icon={SparklesIcon} className="h-4 w-4" />
            Ask AI
          </Button>
          <Button variant="ai" disabled>
            Disabled
          </Button>
        </Row>
      </Section>

      <Section title="Badges" description="The sticker exception to the rounded-corner rule.">
        <Row label="Variants">
          <Badge variant="primary">Primary</Badge>
          <Badge variant="secondary">Live</Badge>
          <Badge variant="danger">Past due</Badge>
          <Badge variant="ai">AI Powered</Badge>
          <Badge variant="accent">New</Badge>
          <Badge variant="success">Published</Badge>
          <Badge variant="outline">Draft</Badge>
        </Row>
      </Section>
    </>
  );
}
