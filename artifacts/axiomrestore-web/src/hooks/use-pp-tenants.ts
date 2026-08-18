import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const apiBase = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/admin`;

async function fetchAuth(url: string, options?: RequestInit) {
  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    let err = "API Error";
    try {
      const data = await res.json();
      err = data.error || data.message || err;
    } catch (_) {}
    throw new Error(err);
  }
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type PPTenantReadiness = {
  hasLicenses: boolean;
  hasQualifications: boolean;
  hasJurisdictionPack: boolean;
  hasAhjPack: boolean;
};

export type PPTenantSummary = {
  id: string;
  name: string;
  createdAt: string;
  workType: string | null;
  tradeTypes: string[] | null;
  founderUserId: string | null;
  ahjPackCount: number;
  jurisdictionPackCount: number;
  inspectionCount: number;
  compiledPackageCount: number;
  readiness: PPTenantReadiness;
};

export type PPTenantDetail = {
  company: {
    id: string;
    name: string;
    createdAt: string;
    workType: string | null;
    tradeTypes: string[] | null;
    contractorLicenses: unknown[] | null;
    qualificationsText: string | null;
    pricingBasisStatement: string | null;
    reportBranding: unknown | null;
    logoUrl: string | null;
    ahjCoverageId: string | null;
  };
  founder: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    emailVerifiedAt: string | null;
    createdAt: string;
  } | null;
  jurisdictionPacks: Array<{
    id: string;
    jurisdiction: string;
    state: string;
    updatedAt: string;
  }>;
  adoptions: Array<{
    id: string;
    masterPackId: string;
    adoptedPackId: string;
    adoptedAt: string;
    isStale: boolean;
    masterPack: {
      id: string;
      state: string;
      county: string | null;
      packType: string;
      version: number;
      codeCycle: string | null;
      supersededById: string | null;
    } | null;
    adoptedPack: {
      id: string;
      jurisdiction: string;
      packType: string;
      version: number;
    } | null;
  }>;
  allAhjPacks: Array<{
    id: string;
    packType: string;
    jurisdiction: string;
    state: string | null;
    version: number;
  }>;
  recentInspections: Array<{
    id: string;
    address: string | null;
    insuredName: string | null;
    status: string;
    phase: string;
    createdAt: string;
    hasCompiledReport: boolean;
  }>;
};

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function usePPTenants() {
  return useQuery({
    queryKey: ["admin", "pp-tenants"],
    queryFn: async () => {
      const data = await fetchAuth(`${apiBase}/pp-tenants`);
      return data.tenants as PPTenantSummary[];
    },
  });
}

export function usePPTenantDetail(companyId: string | null) {
  return useQuery({
    queryKey: ["admin", "pp-tenants", companyId],
    queryFn: async () => {
      const data = await fetchAuth(`${apiBase}/pp-tenants/${companyId}`);
      return data as PPTenantDetail;
    },
    enabled: Boolean(companyId),
  });
}

export function useReAdoptMasterPack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      companyId,
      masterPackId,
    }: {
      companyId: string;
      masterPackId: string;
    }) =>
      fetchAuth(`${apiBase}/pp-tenants/${companyId}/re-adopt`, {
        method: "POST",
        body: JSON.stringify({ masterPackId }),
      }),
    onSuccess: (_, { companyId }) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "pp-tenants"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "pp-tenants", companyId] });
    },
  });
}
