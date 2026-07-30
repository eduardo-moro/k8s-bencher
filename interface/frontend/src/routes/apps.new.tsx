import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppWizard, emptyApp, type StepKey } from "@/components/app-wizard/AppWizard";
import { api, type AppDetail } from "@/lib/api";

type NewAppSearch = { passo?: string };

export const Route = createFileRoute("/apps/new")({
  validateSearch: (search: Record<string, unknown>): NewAppSearch => ({
    passo: typeof search.passo === "string" ? search.passo : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Novo app — console perftest" },
      {
        name: "description",
        content: "Configure um novo app: container, matriz de recursos e perfil de carga do k6.",
      },
      { property: "og:title", content: "Novo app — console perftest" },
      {
        property: "og:description",
        content: "Configure um novo app para varreduras de recursos no Kubernetes.",
      },
    ],
  }),
  component: NewApp,
});

function NewApp() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { passo } = Route.useSearch();

  const create = useMutation({ mutationFn: (body: AppDetail) => api.createApp(body) });

  return (
    <AppWizard
      mode="create"
      initialValue={emptyApp}
      initialStep={passo as StepKey | undefined}
      onStepChange={(next) => navigate({ to: "/apps/new", search: { passo: next }, replace: true })}
      onLoadTemplate={api.template}
      onSave={async (app) => {
        const created = await create.mutateAsync(app);
        qc.invalidateQueries({ queryKey: ["apps"] });
        toast.success(`App ${created.name} criado`);
        navigate({ to: "/apps/$name", params: { name: created.name } });
      }}
      onCancel={() => navigate({ to: "/" })}
    />
  );
}
