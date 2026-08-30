import { Heading, Label, Link, Separator, Text } from '@postgear/ui';
import { Row, Section, Spec } from '../shared';

export function FoundationsSection() {
  return (
    <Section
      title="Foundations"
      description="Typography hierarchy, links, labels, and separators — the raw material every other component is built from."
    >
      <Row label="Heading levels">
        <div className="flex flex-col gap-3">
          <div>
            <Heading level="h1">Heading H1</Heading>
            <Spec>font-display tracking-wide text-5xl md:text-6xl</Spec>
          </div>
          <div>
            <Heading level="h2">Heading H2</Heading>
            <Spec>font-display tracking-wide text-3xl md:text-4xl</Spec>
          </div>
          <div>
            <Heading level="h3">Heading H3</Heading>
            <Spec>font-display tracking-wide text-2xl md:text-3xl</Spec>
          </div>
          <div>
            <Heading level="h4">Heading H4</Heading>
            <Spec>font-display tracking-wide text-lg md:text-xl</Spec>
          </div>
        </div>
      </Row>
      <Row label="Text sizes & weights">
        <div className="flex flex-col gap-2">
          <div>
            <Text size="lg">Large body text</Text>
            <Spec>font-sans text-lg font-medium</Spec>
          </div>
          <div>
            <Text size="md">Medium body text (default)</Text>
            <Spec>font-sans text-base font-medium</Spec>
          </div>
          <div>
            <Text size="sm">Small body text</Text>
            <Spec>font-sans text-sm font-medium</Spec>
          </div>
          <div>
            <Text size="xs">Extra-small body text</Text>
            <Spec>font-sans text-xs font-medium</Spec>
          </div>
          <div>
            <Text weight="bold">Bold weight</Text>
            <Spec>font-sans text-base font-bold</Spec>
          </div>
          <div>
            <Text muted>Muted text (opacity-70)</Text>
            <Spec>font-sans text-base font-medium opacity-70</Spec>
          </div>
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
