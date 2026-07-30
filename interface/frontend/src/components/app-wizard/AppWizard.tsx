import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StepIndicator } from "./StepIndicator";
import { StepStart } from "./StepStart";
import { StepIdentity } from "./StepIdentity";
import { StepResources } from "./StepResources";
import { StepLoad } from "./StepLoad";
import { StepManifest } from "./StepManifest";
import { StepScript } from "./StepScript";
import { StepReview } from "./StepReview";
import type { AppDetail } from "@/lib/api";

export type StepKey =
  | "inicio"
  | "identidade"
  | "recursos"
  | "carga"
  | "manifest"
  | "script"
  | "revisao";

export const emptyApp: AppDetail = {
  name: "",
  container: "",
  resources: { memory: [], cpu: [] },
  load: { vus: 10, stages: [{ duration: "30s", target: 10 }] },
  manifestContent: "",
  scriptContent: "",
};

export function validateApp(v: AppDetail): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!v.name.trim()) errors.name = "O nome é obrigatório";
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(v.name))
    errors.name = "Use letras minúsculas, números e hífens";
  if (!v.container.trim()) errors.container = "O nome do container é obrigatório";
  if (!v.resources.memory.length) errors.memory = "Adicione pelo menos um nível de memória";
  if (!v.resources.cpu.length) errors.cpu = "Adicione pelo menos um nível de CPU";
  if (!Number.isFinite(v.load.vus) || v.load.vus < 1)
    errors.vus = "O número de VUs precisa ser pelo menos 1";
  if (!v.load.stages.length) errors.stages = "Adicione pelo menos um estágio";
  if (v.load.stages.some((s) => !s.duration.trim()))
    errors.stages = "Todo estágio precisa de uma duração (ex.: 30s)";
  if (!v.manifestContent.trim()) errors.manifestContent = "O manifest.yaml é obrigatório";
  if (!v.scriptContent.trim()) errors.scriptContent = "O script do k6 é obrigatório";
  return errors;
}

const FIELD_STEP: Record<string, StepKey> = {
  name: "identidade",
  container: "identidade",
  memory: "recursos",
  cpu: "recursos",
  vus: "carga",
  stages: "carga",
  manifestContent: "manifest",
  scriptContent: "script",
};

const STEP_META: Record<Exclude<StepKey, "revisao">, { label: string; title: string; subtitle: string }> = {
  inicio: {
    label: "Início",
    title: "Vamos começar",
    subtitle: "Você pode começar do zero ou usar o exemplo pronto para já ver tudo funcionando.",
  },
  identidade: {
    label: "Identidade",
    title: "Identidade",
    subtitle: "Como o app se chama e qual container dentro do Deployment vamos ajustar.",
  },
  recursos: {
    label: "Recursos",
    title: "Matriz de recursos",
    subtitle:
      "Escolha os níveis de memória e CPU que você quer testar — vamos rodar o k6 em cada combinação.",
  },
  carga: {
    label: "Carga",
    title: "Perfil de carga",
    subtitle: "Quantos usuários virtuais e por quanto tempo o k6 deve gerar tráfego.",
  },
  manifest: {
    label: "Manifest",
    title: "Manifest (manifest.yaml)",
    subtitle: "O YAML do Kubernetes que descreve o Deployment/Service do app.",
  },
  script: {
    label: "Script k6",
    title: "Script do k6",
    subtitle: "O script que faz as requisições contra o app durante a execução.",
  },
};

function stepsForMode(mode: "create" | "edit"): StepKey[] {
  const base: StepKey[] = ["identidade", "recursos", "carga", "manifest", "script", "revisao"];
  return mode === "create" ? ["inicio", ...base] : base;
}

export function AppWizard({
  mode,
  initialValue,
  onSave,
  onCancel,
  onLoadTemplate,
  initialStep,
  onStepChange,
}: {
  mode: "create" | "edit";
  initialValue: AppDetail;
  onSave: (app: AppDetail) => Promise<void>;
  onCancel: () => void;
  onLoadTemplate?: () => Promise<AppDetail>;
  initialStep?: StepKey;
  onStepChange?: (step: StepKey) => void;
}) {
  const order = stepsForMode(mode);
  const [value, setValue] = useState<AppDetail>(initialValue);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [step, setStepState] = useState<StepKey>(
    initialStep && order.includes(initialStep) ? initialStep : order[0],
  );
  const [visited, setVisited] = useState<Set<StepKey>>(new Set([step]));
  const [saving, setSaving] = useState(false);
  const [loadingExample, setLoadingExample] = useState(false);

  const setStep = (next: StepKey) => {
    setStepState(next);
    setVisited((v) => new Set(v).add(next));
    onStepChange?.(next);
  };

  const index = order.indexOf(step);
  const isFirst = index === 0;
  const isLastContentStep = order[index + 1] === "revisao";
  const isReview = step === "revisao";
  const meta = step === "revisao" ? null : STEP_META[step];

  const goBack = () => index > 0 && setStep(order[index - 1]);
  const goNext = () => index < order.length - 1 && setStep(order[index + 1]);

  const runSave = async () => {
    const errs = validateApp(value);
    setErrors(errs);
    const errorKeys = Object.keys(errs);
    if (errorKeys.length) {
      const firstBadStep = order.find((s) => errorKeys.some((k) => FIELD_STEP[k] === s));
      if (firstBadStep) setStep(firstBadStep);
      const otherStepsAlsoBad = errorKeys.some((k) => FIELD_STEP[k] !== firstBadStep);
      toast.error(
        otherStepsAlsoBad
          ? "Encontramos um problema aqui — corrija para continuar. Há mais pendências em outras etapas."
          : "Encontramos um problema aqui — corrija para continuar.",
      );
      return;
    }
    setSaving(true);
    try {
      await onSave(value);
    } finally {
      setSaving(false);
    }
  };

  const pickBlank = () => goNext();
  const pickExample = async () => {
    if (!onLoadTemplate) {
      goNext();
      return;
    }
    setLoadingExample(true);
    try {
      const tpl = await onLoadTemplate();
      setValue(tpl);
      toast.success("Exemplo httpbin carregado");
      goNext();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingExample(false);
    }
  };

  const stepperSteps = order
    .filter((s): s is Exclude<StepKey, "revisao"> => s !== "revisao")
    .map((s) => ({ key: s as StepKey, label: STEP_META[s].label }))
    .concat({ key: "revisao" as StepKey, label: "Revisão" });

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StepIndicator steps={stepperSteps} current={step} visited={visited} onSelect={setStep} />
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Cancelar
        </button>
      </div>

      {meta && (
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{meta.title}</h2>
          <p className="text-sm text-muted-foreground">{meta.subtitle}</p>
        </div>
      )}
      {isReview && (
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Revisão</h2>
          <p className="text-sm text-muted-foreground">
            Confira tudo antes de salvar. Clique em "editar" para voltar a qualquer etapa.
          </p>
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          {step === "inicio" && (
            <StepStart
              onPickBlank={pickBlank}
              onPickExample={pickExample}
              loadingExample={loadingExample}
            />
          )}
          {step === "identidade" && (
            <StepIdentity value={value} onChange={setValue} errors={errors} lockName={mode === "edit"} />
          )}
          {step === "recursos" && <StepResources value={value} onChange={setValue} errors={errors} />}
          {step === "carga" && <StepLoad value={value} onChange={setValue} errors={errors} />}
          {step === "manifest" && <StepManifest value={value} onChange={setValue} errors={errors} />}
          {step === "script" && <StepScript value={value} onChange={setValue} errors={errors} />}
          {step === "revisao" && (
            <StepReview value={value} onEditStep={setStep} onSave={runSave} saving={saving} />
          )}
        </CardContent>
      </Card>

      {step !== "inicio" && step !== "revisao" && (
        <div className="flex items-center justify-between">
          <div>
            {!isFirst && (
              <Button type="button" variant="ghost" onClick={goBack}>
                Voltar
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={saving} onClick={runSave}>
              {saving ? "Salvando…" : "Salvar e sair"}
            </Button>
            <Button type="button" onClick={goNext}>
              {isLastContentStep ? "Ir para revisão" : "Próximo"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
