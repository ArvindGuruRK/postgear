'use client';

/**
 * The connection field of a step (blueprint 5.4), built in Module 04 and
 * dropped into the step panel by Module 06.
 *
 * Shows the workspace's connections of one app with their status in words,
 * and writes only the chosen id. With none (or only broken ones) it offers
 * **Connect {App}** to admins, which opens the connect dialog (or, for apps
 * that connect by signing in, goes to the app and back to `returnTo`), and
 * tells members "Ask a workspace admin to connect {app}."
 *
 * `connections` and `canManage` are optional: by default it loads the list
 * itself and reads the role from the workspace; the playground and tests pass
 * them in.
 */
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import type { ConnectionKind } from '@postgear/automation';
import {
  Badge,
  Button,
  MotionIcon,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusIndicator,
  Text,
} from '@postgear/ui';
import { useEffect, useState } from 'react';
import { api, connectionOAuthUrl } from '@/lib/api';
import type { Connection, ConnectionStatus } from '@/types/workflows';
import { useOptionalWorkspace } from '../navigation/workspace-provider';
import { AppIcon } from './app-icon';
import { ConnectDialog, type ConnectDialogMode } from './connections/connect-dialog';
import {
  appIcon,
  appInSentence,
  appTitle,
  isFormApp,
  isSimulated,
  STATUS_WORDS,
} from './connections/connections-view-model';
import { GoogleConnectDialog } from './connections/google-connect-dialog';

export interface ConnectionPickerProps {
  kind: ConnectionKind;
  /** The chosen connection id, or '' for none. */
  value: string;
  onChange: (connectionId: string) => void;
  /** Where an OAuth connect lands back: the step's deep link (`/[orgId]/workflows/abc?step=...`). */
  returnTo: string;
  /** The workspace's connections; loaded from the API when left out. */
  connections?: Connection[];
  /** Whether the viewer may add connections; read from the workspace role when left out. */
  canManage?: boolean;
}

const DOT: Record<ConnectionStatus, 'online' | 'away' | 'busy'> = {
  CONNECTED: 'online',
  NEEDS_RECONNECT: 'away',
  ERROR: 'busy',
};

export function ConnectionPicker({
  kind,
  value,
  onChange,
  returnTo,
  connections: given,
  canManage: canManageGiven,
}: ConnectionPickerProps) {
  // Outside a workspace (the playground) there is no role: the caller passes `canManage`.
  const role = useOptionalWorkspace()?.role ?? null;
  const canManage = canManageGiven ?? (role !== null && role !== 'USER');
  const [loaded, setLoaded] = useState<Connection[] | null>(given ?? null);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState<ConnectDialogMode | null>(null);
  const [google, setGoogle] = useState(false);

  useEffect(() => {
    if (given) {
      setLoaded(given);
      return;
    }
    let live = true;
    api<{ connections: Connection[] }>('/automation-connections')
      .then((result) => {
        if (live) setLoaded(result.connections);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [given]);

  const app = appTitle(kind);
  const options = (loaded ?? []).filter((connection) => connection.provider === kind);
  const chosen = options.find((connection) => connection.id === value) ?? null;
  const healthy = options.some((connection) => connection.status === 'CONNECTED');

  function connect() {
    if (isFormApp(kind)) setDialog({ kind: 'add', app: kind });
    // Google: sign in, or a simulated stand-in, or "ask an admin", decided by the server's setup.
    else if (kind === 'google') setGoogle(true);
    else window.location.assign(connectionOAuthUrl(kind, returnTo));
  }

  function added(connection: Connection) {
    setLoaded((current) => [...(current ?? []), connection]);
    onChange(connection.id);
  }

  if (failed) {
    return (
      <Text size="sm" muted>
        The connections could not be loaded. Close the step and open it again.
      </Text>
    );
  }
  if (!loaded) {
    return (
      <Text size="sm" muted>
        Loading connections...
      </Text>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="connection-picker">
      {options.length > 0 ? (
        <Select value={chosen ? chosen.id : undefined} onValueChange={onChange}>
          <SelectTrigger aria-label={`${app} connection`}>
            <SelectValue placeholder={`Choose a ${appInSentence(kind)} connection`} />
          </SelectTrigger>
          <SelectContent>
            {options.map((connection) => (
              <SelectItem key={connection.id} value={connection.id}>
                <span className="flex items-center gap-2">
                  <AppIcon icon={appIcon(kind)} />
                  <span>{connection.name}</span>
                  {isSimulated(connection) ? <Badge variant="secondary">Simulated</Badge> : null}
                  <StatusIndicator
                    status={DOT[connection.status]}
                    label={STATUS_WORDS[connection.status].label}
                    className="text-xs"
                  />
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {value && !chosen ? (
        <Text size="sm" className="text-dangerInk">
          This {app} connection was removed. Choose another one.
        </Text>
      ) : null}
      {chosen && chosen.status !== 'CONNECTED' ? (
        <Text size="sm" className="text-dangerInk">
          {chosen.lastError ?? `${chosen.name} needs to be reconnected.`}
        </Text>
      ) : null}

      {!healthy || options.length === 0 ? (
        canManage ? (
          <div>
            <Button type="button" variant="secondary" size="sm" onClick={connect}>
              <MotionIcon icon={PlusIcon} className="h-4 w-4" />
              Connect {app}
            </Button>
          </div>
        ) : (
          <Text size="sm" muted>
            Ask a workspace admin to connect {appInSentence(kind)}.
          </Text>
        )
      ) : canManage ? (
        <div>
          <Button type="button" variant="secondary" size="sm" onClick={connect}>
            <MotionIcon icon={PlusIcon} className="h-4 w-4" />
            Add Another
          </Button>
        </div>
      ) : null}

      <ConnectDialog
        mode={dialog}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        onSaved={added}
      />
      {kind === 'google' ? (
        <GoogleConnectDialog
          open={google}
          onOpenChange={setGoogle}
          onSaved={added}
          returnTo={returnTo}
        />
      ) : null}
    </div>
  );
}
