import { companyCrmConfigTable, db, type CompanyCrmConfig } from '@workspace/db';
import { eq } from 'drizzle-orm';

// M-F (F4) — CRM seam. The CRM linkage (scheduled-inspection queue inbound,
// appointment-completion + report ingest outbound) is keyed by a per-tenant
// field key issued by the external CRM. No external CRM keys exist in the
// platform yet, so this seam stays disabled by default: reads report "pending"
// and return empty/null rather than fabricating data. When a real key is
// provisioned (config row with enabled=true and a fieldKey), the threads flip
// to "active" and the actual integration can be dropped in behind this helper.

export type CrmThreadStatus = 'pending' | 'active';

export interface CrmSeamStatus {
  enabled: boolean;
  scheduledFeed: CrmThreadStatus;
  appointmentSync: CrmThreadStatus;
  reportIngest: CrmThreadStatus;
}

/** Loads a company's CRM config, or a disabled default when none exists. */
export async function getCompanyCrmConfig(companyId: string): Promise<CompanyCrmConfig> {
  const [config] = await db
    .select()
    .from(companyCrmConfigTable)
    .where(eq(companyCrmConfigTable.companyId, companyId));

  if (config) return config;

  return {
    companyId,
    enabled: false,
    fieldKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** A seam thread is "active" only when the tenant is enabled AND has a field
 * key provisioned; otherwise it is "pending". No fabrication: a pending thread
 * yields empty inbound reads and null outbound metrics. */
export function isCrmActive(config: CompanyCrmConfig): boolean {
  return config.enabled && !!config.fieldKey;
}

export function crmSeamStatus(config: CompanyCrmConfig): CrmSeamStatus {
  const thread: CrmThreadStatus = isCrmActive(config) ? 'active' : 'pending';
  return {
    enabled: config.enabled,
    scheduledFeed: thread,
    appointmentSync: thread,
    reportIngest: thread,
  };
}
