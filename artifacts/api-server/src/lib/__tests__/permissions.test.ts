import { describe, expect, it } from 'vitest';

import { canManageUser, canSetWorkflow, isManagerOrAdmin } from '../permissions';

// Same-company role-hierarchy edge cases for canManageUser/canSetWorkflow.
// Cross-company scoping is covered separately (tenant-isolation.test.ts);
// these tests assume actor and target are already confirmed same-company
// and focus purely on the role-hierarchy decision logic.

describe('canManageUser', () => {
  it('prevents self-management, even for admins', () => {
    expect(canManageUser('admin', 'u1', 'u1', 'admin')).toBe(false);
    expect(canManageUser('manager', 'u1', 'u1', 'manager')).toBe(false);
  });

  it('lets admins manage anyone else, including other admins and managers', () => {
    expect(canManageUser('admin', 'admin-1', 'admin-2', 'admin')).toBe(true);
    expect(canManageUser('admin', 'admin-1', 'mgr-1', 'manager')).toBe(true);
    expect(canManageUser('admin', 'admin-1', 'rep-1', 'field_rep')).toBe(true);
  });

  it('lets admins promote/demote to any role', () => {
    expect(canManageUser('admin', 'admin-1', 'rep-1', 'field_rep', 'manager')).toBe(true);
    expect(canManageUser('admin', 'admin-1', 'mgr-1', 'manager', 'field_rep')).toBe(true);
    expect(canManageUser('admin', 'admin-1', 'mgr-1', 'manager', 'admin')).toBe(true);
  });

  it('blocks a manager from managing another manager (peer-to-peer)', () => {
    expect(canManageUser('manager', 'mgr-1', 'mgr-2', 'manager')).toBe(false);
  });

  it('blocks a manager from managing an admin', () => {
    expect(canManageUser('manager', 'mgr-1', 'admin-1', 'admin')).toBe(false);
  });

  it('lets a manager manage a field rep', () => {
    expect(canManageUser('manager', 'mgr-1', 'rep-1', 'field_rep')).toBe(true);
  });

  it('blocks a manager from promoting a field rep to manager or admin', () => {
    expect(canManageUser('manager', 'mgr-1', 'rep-1', 'field_rep', 'manager')).toBe(false);
    expect(canManageUser('manager', 'mgr-1', 'rep-1', 'field_rep', 'admin')).toBe(false);
  });

  it('lets a manager keep a field rep as a field rep (no-op role change)', () => {
    expect(canManageUser('manager', 'mgr-1', 'rep-1', 'field_rep', 'field_rep')).toBe(true);
  });

  it('blocks a manager from acting on a manager even if attempting to demote them to field rep', () => {
    // Guards against a lower-tier peer "demoting" a departing manager to
    // strip their access, or removing them outright.
    expect(canManageUser('manager', 'mgr-1', 'mgr-2', 'manager', 'field_rep')).toBe(false);
  });

  it('field reps cannot manage anyone, including other field reps', () => {
    expect(canManageUser('field_rep', 'rep-1', 'rep-2', 'field_rep')).toBe(false);
    expect(canManageUser('field_rep', 'rep-1', 'mgr-1', 'manager')).toBe(false);
    expect(canManageUser('field_rep', 'rep-1', 'admin-1', 'admin')).toBe(false);
  });
});

describe('canSetWorkflow', () => {
  it('lets admins set anyone’s workflow, including their own', () => {
    expect(canSetWorkflow('admin', 'admin-1', 'admin-1', 'admin')).toBe(true);
    expect(canSetWorkflow('admin', 'admin-1', 'mgr-1', 'manager')).toBe(true);
    expect(canSetWorkflow('admin', 'admin-1', 'rep-1', 'field_rep')).toBe(true);
  });

  it('blocks a manager from setting their own workflow', () => {
    expect(canSetWorkflow('manager', 'mgr-1', 'mgr-1', 'manager')).toBe(false);
  });

  it('blocks a manager from setting another manager’s workflow (peer-to-peer)', () => {
    expect(canSetWorkflow('manager', 'mgr-1', 'mgr-2', 'manager')).toBe(false);
  });

  it('blocks a manager from setting an admin’s workflow', () => {
    expect(canSetWorkflow('manager', 'mgr-1', 'admin-1', 'admin')).toBe(false);
  });

  it('lets a manager set a field rep’s workflow', () => {
    expect(canSetWorkflow('manager', 'mgr-1', 'rep-1', 'field_rep')).toBe(true);
  });

  it('blocks field reps from setting anyone’s workflow, including their own', () => {
    expect(canSetWorkflow('field_rep', 'rep-1', 'rep-1', 'field_rep')).toBe(false);
    expect(canSetWorkflow('field_rep', 'rep-1', 'rep-2', 'field_rep')).toBe(false);
  });
});

describe('isManagerOrAdmin', () => {
  it('classifies roles correctly', () => {
    expect(isManagerOrAdmin('admin')).toBe(true);
    expect(isManagerOrAdmin('manager')).toBe(true);
    expect(isManagerOrAdmin('field_rep')).toBe(false);
  });
});
