import { Container, Heading, Stack, Text } from '@postgear/ui';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/navigation/theme-toggle';

// Unauthenticated shell: centered column, product wordmark above the card each
// auth screen supplies. Sprint 2 adds the "already signed in → redirect to the
// dashboard" guard here, once there is a session to check.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex justify-end p-4">
        <ThemeToggle />
      </div>
      <Container size="sm" className="flex flex-1 items-center justify-center pb-20">
        <Stack gap="lg" align="center" className="w-full">
          <Stack gap="xs" align="center" className="text-center">
            {/* No colour override: Heading already defaults to text-ink, the
                system's normal foreground. The wordmark previously forced
                text-actionPrimary, which put the page's loudest colour on
                something you only read, competing with the primary button
                below it — the one thing on these screens meant to be blue. */}
            <Heading as="h1" level="h1">
              PostGear
            </Heading>
            <Text muted size="sm">
              Schedule, publish and analyze — everywhere your audience is.
            </Text>
          </Stack>
          <div className="w-full max-w-md">{children}</div>
        </Stack>
      </Container>
    </div>
  );
}
