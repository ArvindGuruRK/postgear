import { Heading, Label, Link, Separator, Text } from '@postgear/ui';
import { Row, Section } from '../shared';

export function FoundationsSection() {
  return (
    <Section
      title="Foundations"
      description="Typography hierarchy, links, labels, and separators — the raw material every other component is built from."
    >
      <Row label="Heading levels">
        <div className="flex flex-col gap-2">
          <Heading level="h1">Heading H1</Heading>
          <Heading level="h2">Heading H2</Heading>
          <Heading level="h3">Heading H3</Heading>
          <Heading level="h4">Heading H4</Heading>
        </div>
      </Row>
      <Row label="Text sizes & weights">
        <div className="flex flex-col gap-1">
          <Text size="lg">Large body text</Text>
          <Text size="md">Medium body text (default)</Text>
          <Text size="sm">Small body text</Text>
          <Text size="xs">Extra-small body text</Text>
          <Text weight="bold">Bold weight</Text>
          <Text muted>Muted text (opacity-70)</Text>
        </div>
      </Row>
      <Row label="Link">
        <Link href="#">Inline link</Link>
      </Row>
      <Row label="Label">
        <Label htmlFor="foundations-demo-input">Channel name</Label>
      </Row>
      <Row label="Separator">
        <div className="flex w-full flex-col gap-3">
          <Text size="sm">Above</Text>
          <Separator />
          <Text size="sm">Below</Text>
        </div>
        <div className="flex h-12 items-center gap-3">
          <Text size="sm">Left</Text>
          <Separator orientation="vertical" />
          <Text size="sm">Right</Text>
        </div>
      </Row>
    </Section>
  );
}
