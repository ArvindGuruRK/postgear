import {
  AspectRatio,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Container,
  Grid,
  Heading,
  Panel,
  Stack,
  Text,
} from '@postgear/ui';
import { Row, Section } from '../shared';

export function LayoutSection() {
  return (
    <Section
      title="Layout"
      description="Container, Stack, Grid, AspectRatio, and Card — the structural primitives every screen composes from."
    >
      <Row label="Container (size caps max-width, always centered)">
        <Container size="sm" className="border-2 border-dashed border-outline px-2 py-3 text-center">
          <Text size="xs">size=&quot;sm&quot;</Text>
        </Container>
      </Row>
      <Row label="Stack (row/column + gap scale)">
        <Stack direction="row" gap="sm" className="rounded-md border-2 border-dashed border-outline p-3">
          <Badge3 />
        </Stack>
      </Row>
      <Row label="Grid (responsive column counts)">
        <Grid cols={3} gap="sm" className="w-full">
          {[1, 2, 3].map((n) => (
            <div key={n} className="rounded-md border-2 border-dashed border-outline p-3 text-center">
              <Text size="xs">Col {n}</Text>
            </div>
          ))}
        </Grid>
      </Row>
      <Row label="Aspect Ratio (16:9)">
        <div className="w-56">
          <AspectRatio ratio={16 / 9} className="overflow-hidden rounded-md border-2 border-outline bg-actionPrimary/10">
            <div className="flex h-full items-center justify-center">
              <Text size="xs">16 / 9</Text>
            </div>
          </AspectRatio>
        </div>
      </Row>
      <Row label="Card (the workhorse container)">
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>Analytics Overview</CardTitle>
            <CardDescription>Last 7 days across all connected channels</CardDescription>
          </CardHeader>
          <CardContent>
            <Text size="sm">
              Engagement is up 24% this week. Your AI-drafted captions are outperforming manual posts by 3x.
            </Text>
          </CardContent>
          <CardFooter>
            <Button size="sm">View Report</Button>
            <Button size="sm" variant="secondary">
              Export
            </Button>
          </CardFooter>
        </Card>
      </Row>
      <Row label="Panel (comic frame — marketing/onboarding, not app UI)">
        <Panel className="max-w-sm p-6">
          <Heading level="h4">You&apos;re all set!</Heading>
          <Text size="sm" className="mt-1">
            Your first channel is connected. Time to schedule a post.
          </Text>
        </Panel>
        <Panel halftone className="max-w-sm p-6">
          <Heading level="h4">Halftone variant</Heading>
          <Text size="sm" className="mt-1">
            Same frame, with the bg-halftone texture layered on top.
          </Text>
        </Panel>
      </Row>
    </Section>
  );
}

function Badge3() {
  return (
    <>
      <div className="rounded-md border-2 border-outline bg-secondary px-3 py-1.5 text-xs">A</div>
      <div className="rounded-md border-2 border-outline bg-secondary px-3 py-1.5 text-xs">B</div>
      <div className="rounded-md border-2 border-outline bg-secondary px-3 py-1.5 text-xs">C</div>
    </>
  );
}
