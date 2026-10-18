'use client';

/**
 * The email preferences (Sprint 8): two toggles over the inherited
 * `sendSuccessEmails` / `sendFailureEmails`, saved as they are switched.
 *
 * Each change is optimistic (the toggle moves at once) and reverted if
 * the save fails, with the failure in an alert whose "Try again" repeats
 * the same change. The server page passes what it loaded; when it could not
 * (`initial` is null) the island loads for itself, and the same alert covers
 * that failure with a retry of the load.
 */
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Skeleton,
  Stack,
  Toggle,
  toast,
} from '@postgear/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { NotificationPreferences } from '@/types/notifications';

type PreferenceKey = keyof NotificationPreferences;

const FIELDS: Array<{
  key: PreferenceKey;
  label: string;
  help: string;
  savedAs: (on: boolean) => string;
}> = [
  {
    key: 'successEmails',
    label: 'Success emails',
    help: 'An email each time a post is published to one of your channels.',
    savedAs: (on) => (on ? "You'll be emailed when a post is published." : 'No more emails for published posts.'),
  },
  {
    key: 'failureEmails',
    label: 'Failure emails',
    help: 'An email when a post cannot be published, or a channel needs reconnecting.',
    savedAs: (on) =>
      on ? "You'll be emailed when a post fails." : 'No more emails for failed posts or channels.',
  },
];

const PATH = '/users/me/notification-preferences';

function describe(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function NotificationPreferencesForm({
  initial,
}: {
  /** Null when the server page could not load them; the island then loads for itself. */
  initial: NotificationPreferences | null;
}) {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(initial);
  const [saving, setSaving] = useState<PreferenceKey | null>(null);
  const [loading, setLoading] = useState(initial === null);
  const [error, setError] = useState<string | null>(null);
  const retry = useRef<(() => Promise<void>) | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<{ preferences: NotificationPreferences }>(PATH);
      setPreferences(result.preferences);
      setError(null);
      retry.current = null;
    } catch (cause) {
      setError(describe(cause, "Couldn't load your notification settings."));
      retry.current = load;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initial === null) {
      void load();
    }
  }, [initial, load]);

  const change = useCallback(
    async (key: PreferenceKey, value: boolean) => {
      if (!preferences) {
        return;
      }
      const previous = preferences;
      setPreferences({ ...previous, [key]: value });
      setSaving(key);

      try {
        const result = await api<{ preferences: NotificationPreferences }>(PATH, {
          method: 'PATCH',
          body: { [key]: value },
        });
        setPreferences(result.preferences);
        setError(null);
        retry.current = null;
        const field = FIELDS.find((candidate) => candidate.key === key);
        toast({ title: 'Saved', description: field?.savedAs(value) });
      } catch (cause) {
        setPreferences(previous);
        setError(describe(cause, "Couldn't save that change."));
        retry.current = () => change(key, value);
      } finally {
        setSaving(null);
      }
    },
    [preferences],
  );

  return (
    <Stack gap="lg">
      {error && (
        <Alert variant="danger" data-testid="notification-preferences-error">
          <div className="flex flex-1 flex-col gap-1">
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void retry.current?.()}
            disabled={loading || saving !== null}
          >
            Try again
          </Button>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Email</CardTitle>
          <CardDescription>
            These apply to every workspace you belong to. The bell and the activity feed are
            always on.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Stack gap="md">
            {FIELDS.map((field) => {
              const id = `pref-${field.key}`;
              const checked = preferences?.[field.key] ?? true;
              const busy = loading || saving !== null;

              return (
                <div
                  key={field.key}
                  className="flex items-start justify-between gap-6 border-t-2 border-outline pt-4 first:border-t-0 first:pt-0"
                >
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={id}>{field.label}</Label>
                    <p className="font-sans text-xs font-medium text-ink opacity-70">{field.help}</p>
                  </div>
                  {loading && !preferences ? (
                    <Skeleton className="h-7 w-12 shrink-0 rounded-full" />
                  ) : (
                    <Toggle
                      id={id}
                      checked={checked}
                      disabled={busy}
                      aria-busy={saving === field.key || undefined}
                      data-testid={`toggle-${field.key}`}
                      onCheckedChange={(value) => void change(field.key, value)}
                    />
                  )}
                </div>
              );
            })}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
