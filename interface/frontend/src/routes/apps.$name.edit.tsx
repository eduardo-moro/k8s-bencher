import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AppForm, emptyApp, validateApp } from "@/components/AppForm";
import { api, type AppDetail } from "@/lib/api";

export const Route = createFileRoute("/apps/$name/edit")({
  head: () => ({
    meta: [
      { title: "Edit app — perftest console" },
      {
        name: "description",
        content: "Edit an app's container, resource sweep matrix, manifest and k6 script.",
      },
      { property: "og:title", content: "Edit app — perftest console" },
      { property: "og:description", content: "Edit an app's perftest configuration." },
    ],
  }),
  component: EditApp,
});

function EditApp() {
  const { name } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [value, setValue] = useState<AppDetail | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ["app", name],
    queryFn: () => api.getApp(name),
  });

  useEffect(() => {
    if (data) setValue(data);
  }, [data]);

  const save = useMutation({
    mutationFn: (body: AppDetail) => api.updateApp(name, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["apps"] });
      qc.invalidateQueries({ queryKey: ["app", name] });
      toast.success(`Saved ${name}`);
      navigate({ to: "/apps/$name", params: { name } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = () => {
    if (!value) return;
    const errs = validateApp(value);
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.error("Fix the highlighted fields first");
      return;
    }
    save.mutate(value);
  };

  if (error)
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {(error as Error).message}
      </div>
    );
  if (isLoading || !value)
    return <p className="font-mono text-sm text-muted-foreground">loading {name}…</p>;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            to="/apps/$name"
            params={{ name }}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> {name}
          </Link>
          <h1 className="font-mono text-xl font-semibold tracking-tight">edit {name}</h1>
        </div>
        <Button onClick={submit} disabled={save.isPending}>
          <Save className="size-4" /> Save changes
        </Button>
      </div>

      <AppForm
        value={value ?? emptyApp}
        onChange={setValue}
        errors={errors}
        lockName
      />
    </div>
  );
}
