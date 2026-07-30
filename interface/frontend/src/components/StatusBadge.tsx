import { cn } from "@/lib/utils";
import type { JobStatus } from "@/lib/api";

const styles: Record<JobStatus, string> = {
  starting: "bg-muted text-muted-foreground border-border",
  running: "bg-running/15 text-running border-running/40",
  done: "bg-success/15 text-success border-success/40",
  failed: "bg-destructive/15 text-destructive border-destructive/40",
};

const labels: Record<JobStatus, string> = {
  starting: "iniciando",
  running: "executando",
  done: "concluído",
  failed: "falhou",
};

export function StatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-xs uppercase tracking-wide",
        styles[status],
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full bg-current",
          (status === "running" || status === "starting") && "animate-pulse",
        )}
      />
      {labels[status]}
    </span>
  );
}
