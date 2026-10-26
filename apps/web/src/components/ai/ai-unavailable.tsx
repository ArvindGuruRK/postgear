/**
 * What the AI studio shows when no model is configured.
 *
 * `/ai/status` says `configured: false` when neither an OpenAI key nor
 * simulation mode is set, and every generation endpoint would answer 503.
 * Rendering the forms anyway would invite a request that cannot succeed, so
 * this takes their place and names the two ways out: the same two the
 * local testing guide gives. Nothing here spends a credit. On the page
 * ground like the rest of the page since the 2026-10-26 revamp.
 */
import { cn } from '@postgear/ui';
import { FlaskConical, KeyRound, Sparkles } from 'lucide-react';
import { AiSticker, INSET } from './ai-ui';

export function AiUnavailable() {
  return (
    <section className="flex flex-col items-center gap-6 px-2 py-10 text-center">
      <AiSticker icon={Sparkles} tone="ai" size="lg" className="-rotate-6" />
      <div className="flex max-w-lg flex-col gap-2">
        <p className="m-0 type-heading text-2xl text-ink">AI isn't set up yet</p>
        <p className="m-0 font-sans text-sm text-ink type-muted">
          PostGear needs a model to write with. Set one of these in the API's environment and
          restart it.
        </p>
      </div>
      <ul className="m-0 grid w-full max-w-2xl list-none gap-3 p-0 text-start sm:grid-cols-2">
        <li className={cn(INSET, 'flex gap-3 p-4')}>
          <AiSticker icon={KeyRound} tone="primary" />
          <span className="flex min-w-0 flex-col gap-1">
            <code className="font-sans text-sm font-bold text-ink">OPENAI_API_KEY</code>
            <span className="font-sans text-sm text-ink type-muted">
              A real key: posts, research (with <code>TAVILY_API_KEY</code>) and images, paid per
              call.
            </span>
          </span>
        </li>
        <li className={cn(INSET, 'flex gap-3 p-4')}>
          <AiSticker icon={FlaskConical} tone="accent" />
          <span className="flex min-w-0 flex-col gap-1">
            <code className="font-sans text-sm font-bold text-ink">AI_SIMULATION="true"</code>
            <span className="font-sans text-sm text-ink type-muted">
              A free local stand-in: deterministic output, real credits, real streaming. Refused in
              production.
            </span>
          </span>
        </li>
      </ul>
    </section>
  );
}
