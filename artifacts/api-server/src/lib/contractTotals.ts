/**
 * Shared contract-totals computation.
 *
 * betterments_cents    = SUM(contract_selections.extended_delta_cents)
 * total_contract_cents = covered_scope_cents + betterments_cents
 *
 * NEVER accept either value from a client. Recompute on every selection write.
 * This is the ONLY place those fields are derived — three implementations would diverge.
 */
import { eq, sum } from 'drizzle-orm';
import { db, contractsTable, contractSelectionsTable } from '@workspace/db';

export async function recomputeContractTotals(
  contractId: string,
): Promise<{ bettermentsCents: number; totalContractCents: number }> {
  const [agg] = await db
    .select({ total: sum(contractSelectionsTable.extendedDeltaCents) })
    .from(contractSelectionsTable)
    .where(eq(contractSelectionsTable.contractId, contractId));

  const bettermentsCents = Number(agg?.total ?? 0);

  const [contractRow] = await db
    .select({ coveredScopeCents: contractsTable.coveredScopeCents })
    .from(contractsTable)
    .where(eq(contractsTable.id, contractId));

  const totalContractCents = (contractRow?.coveredScopeCents ?? 0) + bettermentsCents;

  await db
    .update(contractsTable)
    .set({ bettermentsCents, totalContractCents, updatedAt: new Date() })
    .where(eq(contractsTable.id, contractId));

  return { bettermentsCents, totalContractCents };
}
