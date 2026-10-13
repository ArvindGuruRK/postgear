/**
 * AI Copilot — generate a post from a topic, or talk to an assistant that
 * acts in the workspace (Sprint 6).
 *
 * A server component that loads what the island needs in one round of
 * parallel requests: the channels (the generate form's targets), the
 * providers with their rules (the character limit), whether a model is
 * configured at all, and the credit balance. Each has a safe fallback so a
 * single failed request degrades one part of the page rather than all of
 * it: no channels is a state the form already handles, no status renders an
 * error with a retry, and no balance leaves the meter saying so.
 */
import type { Metadata } from 'next';
import { AiStudio } from '@/components/ai/ai-studio';
import { serverApi } from '@/lib/api';
import { getSessionCookieHeader } from '@/lib/session';
import type { AiCredits, AiStatus } from '@/types/ai';
import type { Channel, ProviderSummary } from '@/types/channel';

export const metadata: Metadata = { title: 'AI Copilot' };

export default async function AiCopilotPage({ params }: PageProps<'/[orgId]/ai-copilot'>) {
  const { orgId } = await params;
  const cookie = await getSessionCookieHeader();

  const [{ channels }, { providers }, status, credits] = await Promise.all([
    serverApi<{ channels: Channel[] }>('/channels', { cookie }).catch(() => ({
      channels: [] as Channel[],
    })),
    serverApi<{ providers: ProviderSummary[] }>('/channels/providers', { cookie }).catch(() => ({
      providers: [] as ProviderSummary[],
    })),
    serverApi<{ status: AiStatus }>('/ai/status', { cookie })
      .then((result) => result.status)
      .catch(() => null),
    serverApi<{ credits: AiCredits }>('/ai/credits', { cookie })
      .then((result) => result.credits)
      .catch(() => null),
  ]);

  return (
    <AiStudio
      orgId={orgId}
      channels={channels}
      providers={providers}
      status={status}
      credits={credits}
    />
  );
}
