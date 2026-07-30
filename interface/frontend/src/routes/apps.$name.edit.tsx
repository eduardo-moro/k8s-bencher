import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppWizard, type StepKey } from "@/components/app-wizard/AppWizard";
import { api, type AppDetail } from "@/lib/api";

type EditAppSearch = { passo?: string };

export const Route = createFileRoute("/apps/$name/edit")({
  validateSearch: (search: Record<string, unknown>): EditAppSearch => ({
    passo: typeof search.passo === "string" ? search.passo : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Editar app — console perftest" },
      {
        name: "description",
        content: "Edite o container, a matriz de recursos, o manifest e o script k6 de um app.",
      },
      { property: "og:title", content: "Editar app — console perftest" },
      { property: "og:description", content: "Edite a configuração de perftest de um app." },
    ],
  }),
  component: EditApp,
});

function EditApp() {
  const { name } = Route.useParams();
  const { passo } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["app", name],
    queryFn: () => api.getApp(name),
  });

  const save = useMutation({ mutationFn: (body: AppDetail) => api.updateApp(name, body) });

  if (error)
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {(error as Error).message}
      </div>
    );
  if (isLoading || !data)
    return <p className="font-mono text-sm text-muted-foreground">carregando {name}…</p>;

  return (
    <AppWizard
      mode="edit"
      initialValue={data}
      initialStep={passo as StepKey | undefined}
      onStepChange={(next) =>
        navigate({ to: "/apps/$name/edit", params: { name }, search: { passo: next }, replace: true })
      }
      onSave={async (app) => {
        await save.mutateAsync(app);
        qc.invalidateQueries({ queryKey: ["apps"] });
        qc.invalidateQueries({ queryKey: ["app", name] });
        toast.success(`Alterações salvas em ${name}`);
        navigate({ to: "/apps/$name", params: { name } });
      }}
      onCancel={() => navigate({ to: "/apps/$name", params: { name } })}
    />
  );
}
