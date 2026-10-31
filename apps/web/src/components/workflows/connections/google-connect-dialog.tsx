'use client';

/**
 * Connect Google (Module 13). Google connects by signing in, so there is no
 * link to paste:
 *
 * - **Connect With Google** goes to Google's consent screen and back, when
 *   PostGear has Google keys (`googleReady`).
 * - **Add A Simulated Google Connection** makes a stand-in that never calls
 *   Google, when the server runs in simulation (local testing only).
 * - Neither: "Ask a workspace admin to set up Google."
 *
 * The flags come from `GET /automation-connections`; a caller that already
 * has them passes `setup`, otherwise the dialog asks once it opens.
 */
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormErrorMessage,
  FormField,
  FormLabel,
  Input,
  Text,
} from '@postgear/ui';
import { Info } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { ApiError, connectionOAuthUrl } from '@/lib/api';
import { addSimulatedGoogle, listConnections } from '@/lib/workflows-api';
import type { Connection } from '@/types/workflows';
import { AppIcon } from '../app-icon';
import {
  appIcon,
  GOOGLE_NOT_SET_UP,
  type GoogleSetup,
  MAX_CONNECTION_NAME_LENGTH,
  SIMULATED_GOOGLE_NAME,
} from './connections-view-model';

export const DRIVE_FILE_PROMISE =
  'PostGear can only open spreadsheets you pick with Google’s file picker, or ones PostGear created.';

export function GoogleConnectDialog({
  open,
  onOpenChange,
  onSaved,
  returnTo,
  setup: given = null,
  reconnect = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (connection: Connection) => void;
  /** Where Google's sign-in lands back. */
  returnTo: string;
  /** The flags, when the caller has them. */
  setup?: GoogleSetup | null;
  /** Reconnecting this connection: only signing in again applies. */
  reconnect?: Connection | null;
}) {
  const formId = useId();
  const [fetched, setFetched] = useState<GoogleSetup | null>(null);
  const setup = given ?? fetched;
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState(SIMULATED_GOOGLE_NAME);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const known = given !== null;
  useEffect(() => {
    if (!open) return;
    setProblem(null);
    setName(SIMULATED_GOOGLE_NAME);
    if (known) return;
    let live = true;
    setFailed(false);
    listConnections()
      .then((list) => {
        if (live) setFetched({ simulation: list.simulation, googleReady: list.googleReady });
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [open, known]);

  async function addSimulated(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setProblem('Enter a name for this connection.');
      return;
    }
    setSaving(true);
    setProblem(null);
    try {
      const connection = await addSimulatedGoogle(trimmed);
      onSaved(connection);
      onOpenChange(false);
    } catch (cause) {
      setProblem(cause instanceof ApiError ? cause.message : 'That could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const signIn = () =>
    window.location.assign(connectionOAuthUrl('google', returnTo, reconnect?.id ?? undefined));
  const simulation = setup?.simulation === true && reconnect === null;
  const ready = setup?.googleReady === true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AppIcon icon={appIcon('google')} className="h-5 w-5" />
            {reconnect ? `Reconnect ${reconnect.name}` : 'Connect Google'}
          </DialogTitle>
          <DialogDescription>{DRIVE_FILE_PROMISE}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4" data-testid="google-connect">
          {failed ? (
            <Text size="sm" className="text-dangerInk">
              Google&apos;s setup could not be checked. Close this and try again.
            </Text>
          ) : !setup ? (
            <Text size="sm" muted>
              Checking how Google can be connected...
            </Text>
          ) : null}

          {ready ? (
            <div className="flex flex-col items-start gap-2">
              <Button type="button" onClick={signIn} data-testid="google-sign-in">
                Connect With Google
              </Button>
              <Text size="xs" muted>
                You sign in on Google&apos;s own page, then come back here.
              </Text>
            </div>
          ) : null}

          {simulation ? (
            <form
              id={formId}
              onSubmit={addSimulated}
              noValidate
              className="flex flex-col gap-3 rounded-md border-2 border-outline bg-chrome p-3"
            >
              <Text size="sm">
                This server runs in simulation, so you can add a Google connection that never calls
                Google. It makes up spreadsheets and rows for testing.
              </Text>
              <FormField>
                <FormLabel htmlFor={`${formId}-name`} required>
                  Connection name
                </FormLabel>
                <Input
                  id={`${formId}-name`}
                  value={name}
                  maxLength={MAX_CONNECTION_NAME_LENGTH}
                  placeholder="Enter your connection name"
                  variant={problem ? 'error' : 'default'}
                  onChange={(event) => setName(event.target.value)}
                />
                {problem ? <FormErrorMessage>{problem}</FormErrorMessage> : null}
              </FormField>
              <div>
                <Button
                  type="submit"
                  variant={ready ? 'secondary' : 'primary'}
                  disabled={saving}
                  data-testid="google-simulated"
                >
                  {saving ? 'Adding...' : 'Add A Simulated Google Connection'}
                </Button>
              </div>
            </form>
          ) : null}

          {setup && !ready && !simulation ? (
            <Alert variant="info" className="items-center p-3" data-testid="google-not-set-up">
              <Info aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2.5} />
              <span>{GOOGLE_NOT_SET_UP}</span>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
