import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const apiBase = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/admin`;

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
    } catch (e) {}
    throw new Error(err);
  }
  return res.json();
}

export type TrialQueueItem = {
  id: string;
  company: string;
  email: string;
  state: string;
  county: string;
  sequenceNum: number;
  status: string;
  submittedAt: string;
  createdAt: string;
  ageDays: number;
};

export type AhjCoverage = {
  id: string;
  state: string;
  county: string;
  status: 'covered' | 'in_progress' | 'none';
  codeCycle?: string;
  updatedAt: string;
};

export function useTrialQueue(status?: string) {
  return useQuery({
    queryKey: ["admin", "trial-queue", { status }],
    queryFn: async () => {
      const url = new URL(`${apiBase}/trial-queue`, window.location.origin);
      if (status && status !== "all") {
        url.searchParams.set("status", status);
      }
      const data = await fetchAuth(url.toString());
      return data.items as TrialQueueItem[];
    },
  });
}

export function useTrialDetail(id: string) {
  return useQuery({
    queryKey: ["admin", "trial-queue", id],
    queryFn: async () => {
      const data = await fetchAuth(`${apiBase}/trial-queue/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useApproveTrial() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => fetchAuth(`${apiBase}/trial-queue/${id}/approve`, { method: "POST" }),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "trial-queue"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "trial-queue", id] });
    },
  });
}

export function useRejectTrial() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => 
      fetchAuth(`${apiBase}/trial-queue/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "trial-queue"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "trial-queue", id] });
    },
  });
}

export function useUpdateTrialStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      fetchAuth(`${apiBase}/trial-queue/${id}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "trial-queue"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "trial-queue", id] });
    },
  });
}

export function useUpdateTrialNotes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) =>
      fetchAuth(`${apiBase}/trial-queue/${id}/notes`, {
        method: "POST",
        body: JSON.stringify({ notes }),
      }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "trial-queue", id] });
    },
  });
}

export function useUploadDeliverable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const { uploadURL, objectPath } = await fetchAuth(`${apiBase}/trial-queue/${id}/deliverable/request-url`, { method: "POST" });
      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!uploadRes.ok) throw new Error("Failed to upload file to storage");
      await fetchAuth(`${apiBase}/trial-queue/${id}/deliverable`, {
        method: "POST",
        body: JSON.stringify({ objectPath }),
      });
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "trial-queue", id] });
    },
  });
}

export function useSendDeliverable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => fetchAuth(`${apiBase}/trial-queue/${id}/send-deliverable`, { method: "POST" }),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "trial-queue"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "trial-queue", id] });
    },
  });
}

export function useAhjCoverage() {
  return useQuery({
    queryKey: ["admin", "ahj-coverage"],
    queryFn: async () => {
      const data = await fetchAuth(`${apiBase}/ahj-coverage`);
      return data.items as AhjCoverage[];
    },
  });
}

export function useUpsertAhjCoverage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<AhjCoverage> & { state: string; county: string }) =>
      fetchAuth(`${apiBase}/ahj-coverage`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "ahj-coverage"] });
    },
  });
}
