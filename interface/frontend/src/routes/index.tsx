import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Play, Boxes } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { api, isActive, type AppSummary } from "@/lib/api";
import { useCurrentJob, useStartRun } from "@/hooks/useJob";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Apps — perftest console" },
      {
        name: "description",
        content:
          "All configured apps with their CPU and memory sweep matrices, plus local prerequisite status.",
      },
      { property: "og:title", content: "Apps — perftest console" },
      {
        property: "og:description",
        content: "Configured apps and their Kubernetes resource sweep matrices.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: apps, isLoading, error } = useQuery({ queryKey: ["apps"], queryFn: api.listApps });
  const { data: job } = useCurrentJob();
  const startRun = useStartRun();
  const running = isActive(job?.status);

  const del = useMutation({
    mutationFn: (name: string) => api.deleteApp(name),
    onSuccess: (_d, name) => {
      toast.success(`Deleted ${name}`);
      qc.invalidateQueries({ queryKey: ["apps"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Apps</h1>
          <p className="text-sm text-muted-foreground">
            Sweep k6 load tests across CPU/memory tiers in a disposable kind cluster.
          </p>
        </div>
        <Button asChild>
          <Link to="/apps/new">
            <Plus className="size-4" /> New app
          </Link>
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {(error as Error).message}
        </div>
      )}

      {isLoading && <p className="font-mono text-sm text-muted-foreground">loading apps…</p>}

      {apps && apps.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <Boxes className="mx-auto size-8 text-muted-foreground" />
          <h2 className="mt-3 font-medium">No apps configured yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Create your first app — you can start from the bundled httpbin example and tweak it.
          </p>
          <Button asChild className="mt-4">
            <Link to="/apps/new">
              <Plus className="size-4" /> Create from example
            </Link>
          </Button>
        </div>
      )}

      {apps && apps.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 font-mono text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">name</th>
                <th className="px-4 py-2 text-left">container</th>
                <th className="px-4 py-2 text-left">memory</th>
                <th className="px-4 py-2 text-left">cpu</th>
                <th className="px-4 py-2 text-right">tiers</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {apps.map((app: AppSummary) => (
                <tr
                  key={app.name}
                  onClick={() => navigate({ to: "/apps/$name", params: { name: app.name } })}
                  className="cursor-pointer border-t border-border hover:bg-muted/40"
                >
                  <td className="px-4 py-2 font-mono font-medium">{app.name}</td>
                  <td className="px-4 py-2 font-mono text-muted-foreground">{app.container}</td>
                  <td className="px-4 py-2 font-mono text-xs">{app.resources.memory.join(", ")}</td>
                  <td className="px-4 py-2 font-mono text-xs">{app.resources.cpu.join(", ")}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {app.resources.memory.length * app.resources.cpu.length}
                  </td>
                  <td className="px-4 py-2">
                    <div
                      className="flex justify-end gap-1"
                      onClick={(e) => e.stopPropagation()}
                      role="presentation"
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={running || startRun.isPending}
                        title={running ? "Another run is already in progress" : "Start run"}
                        onClick={() => startRun.mutate(app.name)}
                      >
                        <Play className="size-3.5" /> Run
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" aria-label={`Delete ${app.name}`}>
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {app.name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This removes the app's config, manifest and k6 script. Past run
                              outputs on disk are not affected.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => del.mutate(app.name)}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
