import { Link } from "@tanstack/react-router";
import { Activity, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { useCancelRun, useCurrentJob } from "@/hooks/useJob";
import { formatElapsed, isActive } from "@/lib/api";

export function RunBanner() {
  const { data: job } = useCurrentJob();
  const cancel = useCancelRun();
  const [, tick] = useState(0);

  useEffect(() => {
    if (!isActive(job?.status)) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [job?.status]);

  if (!job || !isActive(job.status)) return null;

  return (
    <div className="border-b border-running/40 bg-running/10">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2 text-sm">
        <Activity className="size-4 animate-pulse text-running" />
        <StatusBadge status={job.status} />
        <span className="font-mono">{job.appName}</span>
        <span className="font-mono text-muted-foreground">
          {formatElapsed(job.startedAt)} elapsed
        </span>
        <Link
          to="/apps/$name"
          params={{ name: job.appName }}
          className="text-running underline underline-offset-4"
        >
          View live log
        </Link>
        <Button
          size="sm"
          variant="destructive"
          className="ml-auto"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          <X className="size-3.5" /> Cancel run
        </Button>
      </div>
    </div>
  );
}
