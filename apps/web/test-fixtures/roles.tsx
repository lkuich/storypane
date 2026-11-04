import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import type { SpaceRole } from '@storypane/core';
import { RoleSettings } from '../src/features/spaces/role-settings';
import { api } from '../src/features/editor/api';
import '../src/app/globals.css';
import '../src/features/spaces/spaces.css';

function Harness() {
  const [roles, setRoles] = useState<SpaceRole[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <RoleSettings
        roles={roles}
        canManage
        onChange={async () => setRoles(await api<SpaceRole[]>('/roles'))}
        onBusy={setBusy}
      />
      <output aria-label="Role request state">{busy ? 'Busy' : 'Ready'}</output>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Harness />);
