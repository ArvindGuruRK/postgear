/**
 * What the AI studio shows when no model is configured.
 *
 * `/ai/status` says `configured: false` when neither an OpenAI key nor
 * simulation mode is set, and every generation endpoint would answer 503.
 * Rendering the forms anyway would invite a request that cannot succeed, so
 * this takes their place and names the two ways out — the same two the
 * local testing guide gives. Nothing here spends a credit.
 */
import { EmptyState, Text } from '@postgear/ui';
import { Sparkles } from 'lucide-react';

export function AiUnavailable() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border-4 border-outline bg-secondary p-6 shadow-brutalMd">
      <EmptyState
        icon={Sparkles}
        title="AI isn't set up yet"
        description="PostGear needs a model to write with. Set one of these in the API's environment and restart it."
        className="p-2"
      />
      <ul className="m-0 flex w-full max-w-md list-none flex-col gap-3 p-0">
        <li className="rounded-md border-2 border-outline p-4">
          <code className="font-sans text-sm font-bold text-ink">OPENAI_API_KEY</code>
          <Text size="sm" muted>
            A real key: posts, research (with <code>TAVILY_API_KEY</code>) and images, paid per
            call.
          </Text>
        </li>
        <li className="rounded-md border-2 border-outline p-4">
          <code className="font-sans text-sm font-bold text-ink">AI_SIMULATION="true"</code>
          <Text size="sm" muted>
            A free local stand-in: deterministic output, real credits, real streaming. Refused in
            production.
          </Text>
        </li>
      </ul>
    </div>
  );
}
