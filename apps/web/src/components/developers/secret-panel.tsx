'use client';

/**
 * The one-time secret, right after a key is created or rotated.
 *
 * Three things, in the order a developer needs them: the warning that this
 * is the only showing, the secret with a Copy button, and the first `curl`
 * to paste. The field is a read-only `Input` rather than a `code` block so
 * it is a focusable, selectable control (`select()` on focus) and so the
 * e2e suite reads it with `inputValue()`.
 *
 * The clipboard call can fail (an insecure origin, a denied permission)
 * and then the only honest thing is to say so and leave the text selectable.
 */
import { CopyIcon } from '@animateicons/react/lucide/copy-icon';
import {
  Alert,
  AlertDescription,
  Button,
  FormField,
  FormLabel,
  Input,
  MotionIcon,
  Stack,
  Text,
  toast,
} from '@postgear/ui';
import { Check, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { curlExample } from './api-keys-view-model';

interface SecretPanelProps {
  secret: string;
  apiUrl: string;
}

export function SecretPanel({ secret, apiUrl }: SecretPanelProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      toast({ title: 'Copied', description: 'The key is on your clipboard.' });
    } catch {
      toast({ title: "Couldn't copy", description: 'Select the key and copy it by hand.' });
    }
  }

  return (
    <Stack gap="md">
      <Alert variant="warning">
        <TriangleAlert className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
        <AlertDescription>
          Copy this key now. For your security it will not be shown again. If you lose it, rotate
          the key to get a new one.
        </AlertDescription>
      </Alert>

      <FormField>
        <FormLabel htmlFor="api-key-secret">Secret key</FormLabel>
        <div className="flex items-center gap-2">
          <Input
            id="api-key-secret"
            data-testid="api-key-secret"
            readOnly
            value={secret}
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
            aria-describedby="api-key-secret-hint"
          />
          <Button type="button" variant="secondary" onClick={copy} className="shrink-0">
            {copied ? (
              <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
            ) : (
              <MotionIcon icon={CopyIcon} className="h-4 w-4" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <Text id="api-key-secret-hint" size="xs" muted>
          Send it as <code className="font-sans">Authorization: Bearer …</code> on every call.
        </Text>
      </FormField>

      <Stack gap="xs">
        <Text size="sm" weight="bold">
          Try it
        </Text>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border-2 border-outline bg-inset p-3 font-sans text-xs text-ink">
          {curlExample(apiUrl, secret)}
        </pre>
      </Stack>
    </Stack>
  );
}
