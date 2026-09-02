import { Card, CardContent, Container, Heading, Link, Stack, Text } from '@postgear/ui';

// Root 404. Empty/error states get the "full comic treatment" per
// design-system-rules.md §15 — this is exactly the kind of surface the
// halftone texture and oversized display type are meant for, unlike the
// dense data screens the rest of the app is made of.
export default function NotFound() {
  return (
    <Container size="sm" className="flex min-h-screen items-center py-16">
      <Card className="w-full bg-halftone">
        <CardContent>
          <Stack gap="lg" align="center" className="py-10 text-center">
            <Stack gap="xs" align="center">
              <span className="font-display text-8xl leading-none tracking-wide text-actionPrimary">
                404
              </span>
              <Heading as="h1" level="h2">
                Nothing scheduled here
              </Heading>
            </Stack>
            <Text muted className="max-w-sm">
              This page doesn&apos;t exist — it may have been moved, or the link that brought
              you here is out of date.
            </Text>
            <Link href="/login">Back to sign in</Link>
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}
