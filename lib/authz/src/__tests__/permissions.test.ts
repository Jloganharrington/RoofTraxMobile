import { describe, expect, it } from 'vitest';

import {
  canAccessInspectionModule,
  canDeletePin,
  canEditPin,
  canManageUser,
  canSetRoleDeptSpec,
  canSetWorkflow,
  canWriteInspection,
  isManagerOrAdmin,
  roleRank,
} from '../permissions';

// Same-company role-hierarchy edge cases. Cross-company scoping is covered
// separately (tenant-isolation.test.ts); these tests assume actor and
// target are already confirmed same-company and focus purely on the
// role-hierarchy decision logic.

describe('roleRank', () => {
  it('ranks strictly field_rep < manager < admin < super_admin', () => {
    expect(roleRank('field_rep')).toBeLessThan(roleRank('manager'));
    expect(roleRank('manager')).toBeLessThan(roleRank('admin'));
    expect(roleRank('admin')).toBeLessThan(roleRank('super_admin'));
  });
});

describe('canManageUser', () => {
  it('prevents self-management, even for the top rank', () => {
    expect(canManageUser('super_admin', 'u1', 'u1', 'super_admin')).toBe(false);
    expect(canManageUser('admin', 'u1', 'u1', 'admin')).toBe(false);
    expect(canManageUser('manager', 'u1', 'u1', 'manager')).toBe(false);
  });

  it('lets super_admin manage anyone else, including admins', () => {
    expect(canManageUser('super_admin', 'sa-1', 'admin-1', 'admin')).toBe(true);
    expect(canManageUser('super_admin', 'sa-1', 'mgr-1', 'manager')).toBe(true);
    expect(canManageUser('super_admin', 'sa-1', 'rep-1', 'field_rep')).toBe(true);
  });

  it('blocks an admin from managing another admin or a super_admin (peer/above)', () => {
    expect(canManageUser('admin', 'admin-1', 'admin-2', 'admin')).toBe(false);
    expect(canManageUser('admin', 'admin-1', 'sa-1', 'super_admin')).toBe(false);
  });

  it('lets admins manage managers and field reps', () => {
    expect(canManageUser('admin', 'admin-1', 'mgr-1', 'manager')).toBe(true);
    expect(canManageUser('admin', 'admin-1', 'rep-1', 'field_rep')).toBe(true);
  });

  it('blocks an admin from promoting anyone to admin or super_admin', () => {
    expect(canManageUser('admin', 'admin-1', 'mgr-1', 'manager', 'admin')).toBe(false);
    expect(canManageUser('admin', 'admin-1', 'mgr-1', 'manager', 'super_admin')).toBe(false);
  });

  it('lets admins promote/demote below their own rank', () => {
    expect(canManageUser('admin', 'admin-1', 'rep-1', 'field_rep', 'manager')).toBe(true);
    expect(canManageUser('admin', 'admin-1', 'mgr-1', 'manager', 'field_rep')).toBe(true);
  });

  it('blocks a manager from managing another manager (peer-to-peer)', () => {
    expect(canManageUser('manager', 'mgr-1', 'mgr-2', 'manager')).toBe(false);
  });

  it('blocks a manager from managing an admin or super_admin', () => {
    expect(canManageUser('manager', 'mgr-1', 'admin-1', 'admin')).toBe(false);
    expect(canManageUser('manager', 'mgr-1', 'sa-1', 'super_admin')).toBe(false);
  });

  it('lets a manager manage a field rep', () => {
    expect(canManageUser('manager', 'mgr-1', 'rep-1', 'field_rep')).toBe(true);
  });

  it('blocks a manager from promoting a field rep to manager or above', () => {
    expect(canManageUser('manager', 'mgr-1', 'rep-1', 'field_rep', 'manager')).toBe(false);
    expect(canManageUser('manager', 'mgr-1', 'rep-1', 'field_rep', 'admin')).toBe(false);
  });

  it('lets a manager keep a field rep as a field rep (no-op role change)', () => {
    expect(canManageUser('manager', 'mgr-1', 'rep-1', 'field_rep', 'field_rep')).toBe(true);
  });

  it('field reps cannot manage anyone, including other field reps', () => {
    expect(canManageUser('field_rep', 'rep-1', 'rep-2', 'field_rep')).toBe(false);
    expect(canManageUser('field_rep', 'rep-1', 'mgr-1', 'manager')).toBe(false);
    expect(canManageUser('field_rep', 'rep-1', 'admin-1', 'admin')).toBe(false);
  });
});

describe('canSetRoleDeptSpec', () => {
  it('prevents self-edits', () => {
    expect(canSetRoleDeptSpec('super_admin', 'u1', 'u1', 'super_admin')).toBe(false);
  });

  it('mirrors canManageUser rank rules for role changes', () => {
    expect(canSetRoleDeptSpec('admin', 'admin-1', 'mgr-1', 'manager', { role: 'admin' })).toBe(
      false,
    );
    expect(canSetRoleDeptSpec('admin', 'admin-1', 'mgr-1', 'manager', { role: 'field_rep' })).toBe(
      true,
    );
  });

  it('allows department-only changes (no role change) under the same outranking rule', () => {
    expect(canSetRoleDeptSpec('manager', 'mgr-1', 'rep-1', 'field_rep')).toBe(true);
    expect(canSetRoleDeptSpec('manager', 'mgr-1', 'mgr-2', 'manager')).toBe(false);
  });
});

describe('canEditPin', () => {
  it('lets an owner edit their own pin regardless of role', () => {
    expect(canEditPin('field_rep', 'rep-1', 'rep-1')).toBe(true);
  });

  it('blocks a field rep from editing someone else\u2019s pin', () => {
    expect(canEditPin('field_rep', 'rep-1', 'rep-2')).toBe(false);
  });

  it('lets managers and above edit anyone\u2019s pin', () => {
    expect(canEditPin('manager', 'mgr-1', 'rep-2')).toBe(true);
    expect(canEditPin('admin', 'admin-1', 'rep-2')).toBe(true);
    expect(canEditPin('super_admin', 'sa-1', 'rep-2')).toBe(true);
  });
});

describe('canDeletePin', () => {
  it('blocks field reps from deleting pins, even their own', () => {
    expect(canDeletePin('field_rep')).toBe(false);
  });

  it('lets managers and above delete pins', () => {
    expect(canDeletePin('manager')).toBe(true);
    expect(canDeletePin('admin')).toBe(true);
    expect(canDeletePin('super_admin')).toBe(true);
  });
});

describe('canSetWorkflow', () => {
  it('lets admins and super_admins set anyone\u2019s workflow, including their own', () => {
    expect(canSetWorkflow('admin', 'admin-1', 'admin-1', 'admin')).toBe(true);
    expect(canSetWorkflow('super_admin', 'sa-1', 'sa-1', 'super_admin')).toBe(true);
    expect(canSetWorkflow('admin', 'admin-1', 'mgr-1', 'manager')).toBe(true);
    expect(canSetWorkflow('admin', 'admin-1', 'rep-1', 'field_rep')).toBe(true);
  });

  it('blocks a manager from setting their own workflow', () => {
    expect(canSetWorkflow('manager', 'mgr-1', 'mgr-1', 'manager')).toBe(false);
  });

  it('blocks a manager from setting another manager\u2019s workflow (peer-to-peer)', () => {
    expect(canSetWorkflow('manager', 'mgr-1', 'mgr-2', 'manager')).toBe(false);
  });

  it('blocks a manager from setting an admin\u2019s workflow', () => {
    expect(canSetWorkflow('manager', 'mgr-1', 'admin-1', 'admin')).toBe(false);
  });

  it('lets a manager set a field rep\u2019s workflow', () => {
    expect(canSetWorkflow('manager', 'mgr-1', 'rep-1', 'field_rep')).toBe(true);
  });

  it('blocks field reps from setting anyone\u2019s workflow, including their own', () => {
    expect(canSetWorkflow('field_rep', 'rep-1', 'rep-1', 'field_rep')).toBe(false);
    expect(canSetWorkflow('field_rep', 'rep-1', 'rep-2', 'field_rep')).toBe(false);
  });
});

describe('canAccessInspectionModule', () => {
  it('grants access to the inspector_canvasser department, at any role', () => {
    expect(canAccessInspectionModule('field_rep', 'inspector_canvasser')).toBe(true);
    expect(canAccessInspectionModule('manager', 'inspector_canvasser')).toBe(true);
  });

  it('grants super_admin access regardless of department', () => {
    expect(canAccessInspectionModule('super_admin', 'canvasser')).toBe(true);
  });

  it('blocks canvasser-department non-super_admins', () => {
    expect(canAccessInspectionModule('field_rep', 'canvasser')).toBe(false);
    expect(canAccessInspectionModule('admin', 'canvasser')).toBe(false);
  });

  it('blocks office department for non-super_admins', () => {
    expect(canAccessInspectionModule('field_rep', 'office')).toBe(false);
    expect(canAccessInspectionModule('manager', 'office')).toBe(false);
    expect(canAccessInspectionModule('admin', 'office')).toBe(false);
  });
});

describe('canWriteInspection', () => {
  it('lets the assigned inspector write their own inspection', () => {
    expect(canWriteInspection('field_rep', 'insp-1', 'insp-1')).toBe(true);
  });

  it('blocks a same-company peer field rep from writing another inspector\u2019s inspection', () => {
    expect(canWriteInspection('field_rep', 'insp-2', 'insp-1')).toBe(false);
  });

  it('lets managers and above write anyone\u2019s inspection in the company', () => {
    expect(canWriteInspection('manager', 'mgr-1', 'insp-1')).toBe(true);
    expect(canWriteInspection('admin', 'admin-1', 'insp-1')).toBe(true);
    expect(canWriteInspection('super_admin', 'sa-1', 'insp-1')).toBe(true);
  });

  it('never lets a peer field rep claim a null-owner (unassigned/legacy) inspection', () => {
    expect(canWriteInspection('field_rep', 'insp-2', null)).toBe(false);
    // ...but a manager+ can still act on it.
    expect(canWriteInspection('manager', 'mgr-1', null)).toBe(true);
  });
});

describe('isManagerOrAdmin', () => {
  it('classifies roles correctly', () => {
    expect(isManagerOrAdmin('super_admin')).toBe(true);
    expect(isManagerOrAdmin('admin')).toBe(true);
    expect(isManagerOrAdmin('manager')).toBe(true);
    expect(isManagerOrAdmin('field_rep')).toBe(false);
  });
});
