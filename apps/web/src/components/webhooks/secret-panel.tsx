'use client';

/**
 * The one time a signing secret is shown (Sprint 8).
 *
 * A warning-toned `Alert` rather than a plain field, because the thing to
 * understand is not the value but that it will not be shown again. Copy is a
 * real clipboard write with a fallback message when the browser refuses
 * (no secure context, no permission): the person can still select the text.
 */
import { Alert, AlertDescription, AlertTitle, Button, Input, Stack, Text } from '@postgear/ui';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

export function SecretPanel({
  secret,
  title = 'Signing secret',
  description = 'Copy it now: PostGear stores it encrypted and will not show it again. Use it to verify the X-PostGear-Signature header on every delivery.',
  testId = 'webhook-secret',
}: {
  secret: string;
  title?: string;
  description?: string;
  testId?: string;
}) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
  }

  return (
    <Alert variant="warning" data-testid={testId} data-secret={secret}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <Stack gap="sm">
          <Text size="sm">{description}</Text>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={secret}
              aria-label={title}
              className="font-mono text-xs"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button variant="secondary" size="sm" onClick={copy} aria-label="Copy secret">
              {copied === 'copied' ? (
                <Check className="h-4 w-4" strokeWidth={3} />
              ) : (
                <Copy className="h-4 w-4" strokeWidth={2.5} />
              )}
              {copied === 'copied' ? 'Copied' : 'Copy'}
            </Button>
          </div>
          {copied === 'failed' ? (
            <Text size="xs" muted>
              The browser refused the clipboard; select the text and copy it yourself.
            </Text>
          ) : null}
        </Stack>
      </AlertDescription>
    </Alert>
  );
}
