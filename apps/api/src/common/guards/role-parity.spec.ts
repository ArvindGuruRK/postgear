import { Role } from '@postgear/db';
import { WORKSPACE_ROLE_NAMES } from '@postgear/entitlements';
import { ROLE_PARITY, ROLES_AGREE } from './role-parity';

describe('Role and the capability table', () => {
  it('name the same four roles at run time too', () => {
    expect([...Object.values(Role)].sort()).toEqual([...WORKSPACE_ROLE_NAMES].sort());
    expect(Object.keys(ROLE_PARITY).sort()).toEqual([...WORKSPACE_ROLE_NAMES].sort());
    expect(ROLES_AGREE).toBe(true);
  });
});
