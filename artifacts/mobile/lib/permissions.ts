import type { Role } from '@workspace/api-client-react';

// Mirrors the server's `canEditPin` rule: owners may edit/delete their own
// pins; managers/admins may edit/delete any pin in the company.
export function canEditPin(role: Role, userId: string | undefined, pinOwnerId: string): boolean {
  if (!userId) return false;
  return userId === pinOwnerId || role === 'manager' || role === 'admin';
}
