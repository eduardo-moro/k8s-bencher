import type { ReactNode } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogView } from "@/components/LogView";
import type { AppDetail } from "@/lib/api";
import type { StepKey } from "./AppWizard";

function lineCount(text: string): number {
  return text ? text.split("\n").length : 0;
}

function Row({
  step,
  title,
  onEditStep,
  children,
}: {
  step: StepKey;
  title: string;
  onEditStep: (step: StepKey) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs uppercase text-muted-foreground">{title}</p>
        <div className="mt-1 text-sm">{children}</div>
      </div>
      <Button type="button" size="sm" variant="ghost" onClick={() => onEditStep(step)}>
        <Pencil className="size-3.5" /> editar
      </Button>
    </div>
  );
}

export function StepReview({
  value,
  onEditStep,
  onSave,
  saving,
}: {
  value: AppDetail;
  onEditStep: (step: StepKey) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div>
      <Row step="identidade" title="Identidade" onEditStep={onEditStep}>
        <p className="font-mono">
          {value.name || "—"} <span className="text-muted-foreground">/</span>{" "}
          {value.container || "—"}
        </p>
      </Row>
      <Row step="recursos" title="Matriz de recursos" onEditStep={onEditStep}>
        <p className="font-mono text-xs">
          memória: {value.resources.memory.join(", ") || "—"}
          <br />
          cpu: {value.resources.cpu.join(", ") || "—"}
        </p>
      </Row>
      <Row step="carga" title="Perfil de carga" onEditStep={onEditStep}>
        <p className="font-mono text-xs">
          {value.load.vus} VUs ·{" "}
          {value.load.stages.map((s) => `${s.duration}→${s.target}`).join("  ") || "—"}
        </p>
      </Row>
      <Row step="manifest" title="Manifest (manifest.yaml)" onEditStep={onEditStep}>
        <p className="mb-1 text-xs text-muted-foreground">
          {lineCount(value.manifestContent)} linhas
        </p>
        <LogView
          text={value.manifestContent.split("\n").slice(0, 3).join("\n")}
          className="max-h-20"
        />
      </Row>
      <Row step="script" title="Script do k6" onEditStep={onEditStep}>
        <p className="mb-1 text-xs text-muted-foreground">
          {lineCount(value.scriptContent)} linhas
        </p>
        <LogView
          text={value.scriptContent.split("\n").slice(0, 3).join("\n")}
          className="max-h-20"
        />
      </Row>

      <div className="mt-4 flex justify-end">
        <Button type="button" onClick={onSave} disabled={saving}>
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </div>
  );
}
