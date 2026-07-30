import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AppForm, emptyApp, validateApp } from "@/components/AppForm";
import { api, type AppDetail } from "@/lib/api";

export const Route = createFileRoute("/apps/new")({
  head: () => ({
    meta: [
      { title: "New app — perftest console" },
      {
        name: "description",
        content: "Configure a new app: container, resource sweep matrix, k6 load profile.",
      },
      { property: "og:title", content: "New app — perftest console" },
      {
        property: "og:description",
        content: "Configure a new app for Kubernetes resource sweeps.",
      },
    ],
  }),
  component: NewApp,
});

function NewApp() {
  const [value, setValue] = useState<AppDetail>(emptyApp);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const navigate = useNavigate();
  const qc = useQueryClient();

  const loadTemplate = useMutation({
    mutationFn: api.template,
    onSuccess: (tpl) => {
      setValue(tpl);
      setErrors({});
      toast.success("Loaded the httpbin example");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const create = useMutation({
    mutationFn: (body: AppDetail) => api.createApp(body),
    onSuccess: (app) => {
      qc.invalidateQueries({ queryKey: ["apps"] });
      toast.success(`Created ${app.name}`);
      navigate({ to: "/apps/$name", params: { name: app.name } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = () => {
    const errs = validateApp(value);
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.error("Fix the highlighted fields first");
      return;
    }
    create.mutate(value);
  };

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
          <h1 className="text-xl font-semibold tracking-tight">New app</h1>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => loadTemplate.mutate()}
            disabled={loadTemplate.isPending}
          >
            <Sparkles className="size-4" /> Start from httpbin example
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            <Save className="size-4" /> Create app
          </Button>
        </div>
      </div>

      <AppForm value={value} onChange={setValue} errors={errors} />
    </div>
  );
}
