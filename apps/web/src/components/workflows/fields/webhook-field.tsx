'use client';

/**
 * The Webhook trigger's link (Module 13, `kind: 'webhookLink'`). It edits no
 * config: the link and the secret live on the server.
 *
 * - The link with **Copy**.
 * - The secret: shown **once**, right after Create Secret or Regenerate
 *   Secret, in a copy box ("Copy it now. It will not be shown again.").
 *   Afterwards only its last 4 characters. Admins create and regenerate
 *   (Regenerate asks first: the old secret stops working); members are told
 *   to ask one.
 * - A ready-made curl example, always with a placeholder secret.
 * - "Last received 3 minutes ago" from the saved sample.
 *
 * The plain secret is held in this component's state only, never in the
 * step's config, the URL or storage, and is gone when the panel closes.
 */
import { CopyIcon } from '@animateicons/react/lucide/copy-icon';
import { KeyRoundIcon } from '@animateicons/react/lucide/key-round-icon';
import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Input,
  MotionIcon,
  Text,
  toast,
} from '@postgear/ui';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { createWebhookSecret, getWebhook } from '@/lib/workflows-api';
import type { WebhookInfo } from '@/types/workflows';
import { useFieldEnv } from './field-env';
import type { FieldControlProps } from './field-types';
import {
  curlExample,
  lastReceivedWords,
  maskedSecret,
  SECRET_HEADER,
  SHOWN_ONCE,
} from './webhook-model';

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: `${what} copied` });
  } catch {
    toast({ title: 'The browser did not allow copying.', variant: 'danger' });
  }
}

function CopyButton({ text, what, label }: { text: string; what: string; label: string }) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="shrink-0"
      onClick={() => void copy(text, what)}
    >
      <MotionIcon icon={CopyIcon} className="h-4 w-4" />
      {label}
    </Button>
  );
}

type State = { status: 'loading' } | { status: 'ready'; info: WebhookInfo } | { status: 'failed' };

export function WebhookLinkField({ ids }: FieldControlProps) {
  const env = useFieldEnv();
  const automationId = env?.context.automationId ?? '';
  const canManage = env?.context.canManage ?? false;
  const [state, setState] = useState<State>({ status: 'loading' });
  const [secret, setSecret] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!automationId) return;
    let live = true;
    getWebhook(automationId)
      .then((info) => {
        if (live) setState({ status: 'ready', info });
      })
      .catch(() => {
        if (live) setState({ status: 'failed' });
      });
    return () => {
      live = false;
    };
  }, [automationId]);

  async function makeSecret() {
    setBusy(true);
    setProblem(null);
    try {
      const made = await createWebhookSecret(automationId);
      setSecret(made.secret);
      setState((current) =>
        current.status === 'ready'
          ? {
              status: 'ready',
              info: {
                ...current.info,
                url: made.url || current.info.url,
                secret: { last4: made.last4, createdAt: new Date().toISOString() },
              },
            }
          : current,
      );
    } catch (cause) {
      setProblem(cause instanceof ApiError ? cause.message : 'The secret was not made. Try again.');
    } finally {
      setBusy(false);
      setAsking(false);
    }
  }

  if (state.status === 'loading') {
    return (
      <Text size="sm" muted id={ids.control}>
        Loading the link...
      </Text>
    );
  }
  if (state.status === 'failed') {
    return (
      <Alert variant="danger" className="items-center p-3">
        <TriangleAlert aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2.5} />
        <span>The link could not be loaded. Close the step and open it again.</span>
      </Alert>
    );
  }

  const { info } = state;
  return (
    // biome-ignore lint/a11y/useSemanticElements: the link, the secret and the example, named by the field's label
    <div
      role="group"
      aria-labelledby={ids.label}
      aria-describedby={ids.message}
      className="flex flex-col gap-4"
      data-testid="webhook-link"
    >
      <div className="flex items-center gap-2">
        <Input
          id={ids.control}
          readOnly
          value={info.url}
          aria-label="Link"
          className="font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
        <CopyButton text={info.url} what="Link" label="Copy" />
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-sans text-sm font-bold text-ink">Secret</span>
        {secret ? (
          <div
            className="flex flex-col gap-2 rounded-md border-2 border-outline bg-chrome p-3"
            data-testid="webhook-secret-once"
          >
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={secret}
                aria-label="New secret"
                className="font-mono text-xs"
                onFocus={(event) => event.currentTarget.select()}
              />
              <CopyButton text={secret} what="Secret" label="Copy" />
            </div>
            <Text size="sm" className="font-bold">
              {SHOWN_ONCE}
            </Text>
          </div>
        ) : info.secret ? (
          <Text size="sm" data-testid="webhook-secret-masked">
            Secret ending in <span className="font-mono">{maskedSecret(info.secret.last4)}</span>
          </Text>
        ) : (
          <Text size="sm" muted>
            No secret yet. Other apps need it to start this workflow.
          </Text>
        )}
        {problem ? (
          <Alert variant="danger" className="items-center p-3">
            <TriangleAlert aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2.5} />
            <span>{problem}</span>
          </Alert>
        ) : null}
        {canManage ? (
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => (info.secret ? setAsking(true) : void makeSecret())}
            >
              <MotionIcon icon={KeyRoundIcon} className="h-4 w-4" />
              {busy ? 'Making...' : info.secret ? 'Regenerate Secret' : 'Create Secret'}
            </Button>
          </div>
        ) : (
          <Text size="xs" muted>
            Ask a workspace admin to {info.secret ? 'regenerate' : 'create'} the secret.
          </Text>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-sans text-sm font-bold text-ink">Example</span>
        <pre className="m-0 overflow-x-auto rounded-md border-2 border-outline bg-chrome p-3 font-mono text-xs whitespace-pre text-ink">
          {curlExample(info.url)}
        </pre>
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton text={curlExample(info.url)} what="Example" label="Copy Example" />
          <Text size="xs" muted as="span">
            Send the secret in the {SECRET_HEADER} header.
          </Text>
        </div>
      </div>

      <Text size="sm" muted data-testid="webhook-last-received">
        {lastReceivedWords(info.sampleAt)}
      </Text>

      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate the secret?</AlertDialogTitle>
            <AlertDialogDescription>
              The current secret stops working at once. Apps that send to this link need the new
              one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep It</AlertDialogCancel>
            <AlertDialogAction onClick={() => void makeSecret()} disabled={busy}>
              Regenerate Secret
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
