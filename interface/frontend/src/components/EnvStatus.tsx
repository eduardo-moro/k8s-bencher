import { useQuery } from "@tanstack/react-query";
import { ChevronDown, RefreshCw } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { LogView } from "@/components/LogView";

export function EnvStatus() {
  const [open, setOpen] = useState(false);
  const { data, isFetching, refetch, isError } = useQuery({
    queryKey: ["check"],
    queryFn: api.check,
    refetchOnWindowFocus: false,
  });

  const ready = data?.ready === true;
  const label = isError ? "api unreachable" : data ? (ready ? "env ready" : "env not ready") : "checking…";

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs",
            isError || (data && !ready)
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : ready
                ? "border-success/40 bg-success/10 text-success"
                : "border-border bg-muted text-muted-foreground",
          )}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {label}
          <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
        </button>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
          aria-label="Re-run prerequisite check"
        >
          <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
        </button>
      </div>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(90vw,34rem)] rounded-lg border border-border bg-popover p-3 shadow-lg">
          <p className="mb-2 text-xs text-muted-foreground">
            Prerequisites: kind, kubectl, k6, docker, powershell-yaml
          </p>
          <LogView text={data?.output ?? "No check output."} className="max-h-72" />
        </div>
      )}
    </div>
  );
}
