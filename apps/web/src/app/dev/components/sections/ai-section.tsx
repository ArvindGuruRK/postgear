'use client';

import { SparklesIcon } from '@animateicons/react/lucide/sparkles-icon';
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  MotionIcon,
  SpeechBubble,
  TypingIndicator,
} from '@postgear/ui';
import { Sparkles } from 'lucide-react';
import { Row, Section, Spec } from '../shared';

const VARIANTS = ['default', 'primary', 'ai'] as const;
const TAILS = ['none', 'left', 'right'] as const;

/**
 * Sprint 6's AI surfaces, kept out of Data Display on purpose: that section
 * is the restrained profile (§15) and the speech bubble is the one comic
 * accent the system sanctions for chat (§16b). The matrix shows every
 * variant × tail; the chat sample shows the only composition the rules
 * allow: user on `primary` tail-right, assistant on `default` tail-left,
 * violet reserved for what the model produced.
 */
export function AiSection() {
  return (
    <Section
      title="AI Surfaces"
      description="Speech bubbles and the copilot chat composition: actionAi violet marks what the model produced; the user's own messages stay primary."
    >
      <Row label="Speech Bubble (variant × tail)">
        <div className="grid w-full gap-x-6 gap-y-5 sm:grid-cols-3">
          {VARIANTS.map((variant) =>
            TAILS.map((tail) => (
              <SpeechBubble key={`${variant}-${tail}`} variant={variant} tail={tail}>
                <span className="font-semibold">{variant}</span>, tail {tail}
              </SpeechBubble>
            )),
          )}
        </div>
        <Spec>
          rounded-lg border-2 border-outline shadow-surfaceSm p-4 font-sans text-sm; tail = rotated
          bordered square, border-t-0 border-l-0, in the variant&apos;s fill
        </Spec>
      </Row>
      <Row label="Copilot chat composition">
        <div className="flex w-full max-w-md flex-col gap-4">
          <div className="flex items-end gap-3">
            <Avatar size="sm">
              <AvatarFallback className="bg-actionAi text-onActionAi">
                <Sparkles className="h-4 w-4" strokeWidth={2.5} />
              </AvatarFallback>
            </Avatar>
            <SpeechBubble tail="left" className="mb-2 whitespace-pre-wrap">
              You have two channels connected: LinkedIn and Instagram. Want a post for either?
            </SpeechBubble>
          </div>
          <SpeechBubble variant="primary" tail="right" className="mb-2 self-end">
            Write a LinkedIn post about our new release.
          </SpeechBubble>
          <div className="flex items-center gap-3">
            <Badge variant="ai">Hook</Badge>
            <SpeechBubble variant="ai" className="flex-1">
              Shipping is the easy part. Here&apos;s what we learned keeping it shipped.
            </SpeechBubble>
          </div>
          <div className="flex items-center gap-3">
            <TypingIndicator />
            <Button size="sm" variant="highlight">
              <MotionIcon icon={SparklesIcon} className="h-4 w-4" />
              Generate
            </Button>
          </div>
        </div>
        <Spec>
          user primary tail=right; assistant default tail=left + Sparkles avatar; hook ai; mb-2
          clears the tail
        </Spec>
      </Row>
    </Section>
  );
}
