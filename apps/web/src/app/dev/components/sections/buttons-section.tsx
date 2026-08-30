import { Badge, Button } from '@postgear/ui';
import { Sparkles } from 'lucide-react';
import { Row, Section } from '../shared';

export function ButtonsSection() {
  return (
    <>
      <Section
        title="Buttons"
        description="The reference press interaction: shadow-brutalMd collapses to shadow-brutalPressed on click."
      >
        <Row label="Primary">
          <Button size="sm">Connect Channel</Button>
          <Button size="md">Connect Channel</Button>
          <Button size="lg">Connect Channel</Button>
          <Button disabled>Disabled</Button>
        </Row>
        <Row label="Secondary">
          <Button variant="secondary">Schedule Post</Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
        </Row>
        <Row label="Danger">
          <Button variant="danger">Delete</Button>
          <Button variant="danger" disabled>
            Disabled
          </Button>
        </Row>
        <Row label="AI">
          <Button variant="ai">
            <Sparkles className="h-4 w-4" strokeWidth={2.5} />
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
          <Badge variant="outline">Draft</Badge>
        </Row>
      </Section>
    </>
  );
}
