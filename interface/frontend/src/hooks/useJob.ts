import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, isActive, type JobState } from "@/lib/api";

export const jobQueryKey = ["jobs", "current"] as const;

export function useCurrentJob() {
  return useQuery<JobState | null>({
    queryKey: jobQueryKey,
    queryFn: async () => {
      try {
        return await api.currentJob();
      } catch {
        return null;
      }
    },
    refetchInterval: (q) => (isActive(q.state.data?.status) ? 2000 : 5000),
    refetchOnWindowFocus: true,
  });
}

export function useStartRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.startRun(name),
    onSuccess: (job) => {
      qc.setQueryData(jobQueryKey, job);
      toast.success(`Execução iniciada para ${job.appName}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCancelRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.cancelJob(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: jobQueryKey });
      toast.success("Execução cancelada — cluster removido");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
