'use client';

import { WorkspaceSwitcher } from '@postgear/ui';
import { useState } from 'react';

const DEMO_ORGS = [
  { id: '1', name: 'Acme Media' },
  { id: '2', name: 'Nova Studio' },
];

export function OrgSwitcher() {
  const [activeId, setActiveId] = useState(DEMO_ORGS[0].id);

  return (
    <WorkspaceSwitcher
      workspaces={DEMO_ORGS}
      activeId={activeId}
      onActiveChange={setActiveId}
      label="Organizations"
      createLabel="Create organization"
      onCreate={() => {}}
    />
  );
}
