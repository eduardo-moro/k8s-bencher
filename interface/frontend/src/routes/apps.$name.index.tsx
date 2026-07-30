import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeft, FolderClock, Pencil, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogView } from "@/components/LogView";
import { StatusBadge } from "@/components/StatusBadge";
import { useCancelRun, useCurrentJob, useStartRun } from "@/hooks/useJob";
import { api, formatElapsed, isActive } from "@/lib/api";

export const Route = createFileRoute("/apps/$name/")({
  head: () => ({
    meta: [
      { title: "App detail — perftest console" },
      {
        name: "description",
        content: "Review an app's sweep config, start a run, watch the live log and past results.",
      },
      { property: "og:title", content: "App detail — perftest console" },
      {
        property: "og:description",
        content: "Start a resource sweep and watch the live k6 run log.",
      },
    ],
  }),
  component: AppDetailPage,
});

function AppDetailPage() {
  const { name } = Route.useParams();
  const { data: app, isLoading, error } = useQuery({
    queryKey: ["app", name],
    queryFn: () => api.getApp(name),
  });
  const { data: outputs } = useQuery({
    queryKey: ["outputs", name],
    queryFn: () => api.outputs(name),
  });
  const { data: job } = useCurrentJob();
  const startRun = useStartRun();
  const cancel = useCancelRun();
  const [, tick] = useState(0);

  const globallyRunning = isActive(job?.status);
  const thisJob = job?.appName === name ? job : undefined;

  useEffect(() => {
    if (!isActive(thisJob?.status)) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [thisJob?.status]);

  if (error)
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {(error as Error).message}
      </div>
    );
  if (isLoading || !app)
    return <p className="font-mono text-sm text-muted-foreground">loading {name}…</p>;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Apps
          </Link>
          <h1 className="font-mono text-xl font-semibold tracking-tight">{app.name}</h1>
          <p className="text-sm text-muted-foreground">
            container <span className="font-mono text-foreground">{app.container}</span> ·{" "}
            {app.resources.memory.length * app.resources.cpu.length} tiers
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/apps/$name/edit" params={{ name }}>
              <Pencil className="size-4" /> Edit
            </Link>
          </Button>
          <Button
            disabled={globallyRunning || startRun.isPending}
            title={
              globallyRunning
                ? "A run is already in progress — only one kind cluster exists"
                : "Start a full resource-matrix run"
            }
            onClick={() => startRun.mutate(name)}
          >
            <Play className="size-4" /> Start run
          </Button>
        </div>
      </div>

      {thisJob && (
        <Card className="border-border">
          <CardHeader className="flex flex-row flex-wrap items-center gap-3 pb-3">
            <CardTitle className="font-mono text-sm">Run</CardTitle>
            <StatusBadge status={thisJob.status} />
            <span className="font-mono text-xs text-muted-foreground">
              {formatElapsed(thisJob.startedAt, thisJob.finishedAt)}
              {thisJob.exitCode !== undefined && ` · exit ${thisJob.exitCode}`}
            </span>
            <div className="ml-auto flex gap-2">
              {isActive(thisJob.status) && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate()}
                >
                  <X className="size-3.5" /> Cancel
                </Button>
              )}
              {!isActive(thisJob.status) && thisJob.outputDir && (
                <Button size="sm" variant="outline" asChild>
                  <Link
                    to="/apps/$name/outputs/$folder"
                    params={{ name, folder: thisJob.outputDir }}
                  >
                    View results
                  </Link>
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <LogView text={thisJob.logTail} autoScroll={isActive(thisJob.status)} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="font-mono text-sm">Config</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
          <Field label="memory tiers" value={app.resources.memory.join("  ")} />
          <Field label="cpu tiers" value={app.resources.cpu.join("  ")} />
          <Field label="vus" value={String(app.load.vus)} />
          <Field
            label="stages"
            value={app.load.stages.map((s) => `${s.duration} → ${s.target}`).join("   ")}
          />
          <div className="sm:col-span-2">
            <p className="mb-1 font-mono text-xs uppercase text-muted-foreground">manifest.yaml</p>
            <LogView text={app.manifestContent} />
          </div>
          <div className="sm:col-span-2">
            <p className="mb-1 font-mono text-xs uppercase text-muted-foreground">script.js</p>
            <LogView text={app.scriptContent} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="font-mono text-sm">Past runs</CardTitle>
        </CardHeader>
        <CardContent>
          {!outputs?.length ? (
            <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              <FolderClock className="mx-auto size-6" />
              <p className="mt-2">No runs yet — hit “Start run” to sweep the resource matrix.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {outputs.map((o) => (
                <li key={o.folder}>
                  <Link
                    to="/apps/$name/outputs/$folder"
                    params={{ name, folder: o.folder }}
                    className="flex items-center justify-between gap-3 py-2 hover:text-primary"
                  >
                    <span className="font-mono text-sm">{o.folder}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {new Date(o.timestamp).toLocaleString()}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-xs uppercase text-muted-foreground">{label}</p>
      <p className="font-mono text-sm">{value || "—"}</p>
    </div>
  );
}
