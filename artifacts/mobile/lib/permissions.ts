import type { Role } from '@workspace/api-client-react';

// Mirrors the server's `canEditPin` rule: owners may edit their own pins;
// managers and above may edit any pin in the company. Deleting is stricter
// server-side (managers+ only, even for owners) but no client UI currently
// exposes pin delete, so there is nothing to mirror here yet.
export function canEditPin(role: Role, userId: string | undefined, pinOwnerId: string): boolean {
  if (!userId) return false;
  return (
    userId === pinOwnerId || role === 'manager' || role === 'admin' || role === 'super_admin'
  );
}
