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
      { title: "Apps — console perftest" },
      {
        name: "description",
        content:
          "Todos os apps configurados com suas matrizes de varredura de CPU e memória, além do status dos pré-requisitos locais.",
      },
      { property: "og:title", content: "Apps — console perftest" },
      {
        property: "og:description",
        content: "Apps configurados e suas matrizes de varredura de recursos no Kubernetes.",
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
      toast.success(`Excluído ${name}`);
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
            Varra testes de carga k6 por níveis de CPU/memória em um cluster kind descartável.
          </p>
        </div>
        <Button asChild>
          <Link to="/apps/new">
            <Plus className="size-4" /> Novo app
          </Link>
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {(error as Error).message}
        </div>
      )}

      {isLoading && <p className="font-mono text-sm text-muted-foreground">carregando apps…</p>}

      {apps && apps.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <Boxes className="mx-auto size-8 text-muted-foreground" />
          <h2 className="mt-3 font-medium">Nenhum app configurado ainda</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Crie seu primeiro app — você pode começar pelo exemplo httpbin incluso e ajustar depois.
          </p>
          <Button asChild className="mt-4">
            <Link to="/apps/new">
              <Plus className="size-4" /> Criar a partir do exemplo
            </Link>
          </Button>
        </div>
      )}

      {apps && apps.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 font-mono text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">nome</th>
                <th className="px-4 py-2 text-left">container</th>
                <th className="px-4 py-2 text-left">memória</th>
                <th className="px-4 py-2 text-left">cpu</th>
                <th className="px-4 py-2 text-right">níveis</th>
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
                        title={running ? "Já existe uma execução em andamento" : "Iniciar execução"}
                        onClick={() => startRun.mutate(app.name)}
                      >
                        <Play className="size-3.5" /> Executar
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" aria-label={`Excluir ${app.name}`}>
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir {app.name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Isso remove a config, o manifest e o script k6 do app. Os resultados
                              de execuções passadas no disco não são afetados.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => del.mutate(app.name)}>
                              Excluir
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
