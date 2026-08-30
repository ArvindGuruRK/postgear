import { Badge, Button, Button2 } from '@postgear/ui';
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

      <Section
        title="Buttons — 3D Push (Button2)"
        description="A separate, parallel exploration living in button2.tsx, not a Button variant: shadow-brutalBtn is bottom-only (no x-offset), grows to shadow-brutalBtnHover on hover (lifts off its base), then collapses to shadow-brutalPressed on click (sinks flush)."
      >
        <Row label="Primary">
          <Button2 size="sm">Connect Channel</Button2>
          <Button2 size="md">Connect Channel</Button2>
          <Button2 size="lg">Connect Channel</Button2>
          <Button2 disabled>Disabled</Button2>
        </Row>
        <Row label="Secondary">
          <Button2 variant="secondary">Schedule Post</Button2>
          <Button2 variant="secondary" disabled>
            Disabled
          </Button2>
        </Row>
        <Row label="Danger">
          <Button2 variant="danger">Delete</Button2>
          <Button2 variant="danger" disabled>
            Disabled
          </Button2>
        </Row>
        <Row label="AI">
          <Button2 variant="ai">
            <Sparkles className="h-4 w-4" strokeWidth={2.5} />
            Ask AI
          </Button2>
          <Button2 variant="ai" disabled>
            Disabled
          </Button2>
        </Row>
        <Row label="Pressed state (static — the shadow sinks flush, hover/press disabled below)">
          <Button2 className="pointer-events-none translate-y-1 shadow-brutalPressed">
            Connect Channel
          </Button2>
          <Button2 variant="secondary" className="pointer-events-none translate-y-1 shadow-brutalPressed">
            Schedule Post
          </Button2>
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
