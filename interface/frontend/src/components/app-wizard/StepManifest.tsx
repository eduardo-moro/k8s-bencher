import { CodeEditor } from "@/components/CodeEditor";
import { FieldError } from "./FieldError";
import type { AppDetail } from "@/lib/api";

export function StepManifest({
  value,
  onChange,
  errors,
}: {
  value: AppDetail;
  onChange: (v: AppDetail) => void;
  errors: Record<string, string>;
}) {
  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">
        Cole aqui o manifesto do Kubernetes (Deployment, Service etc.) que descreve o app.
      </p>
      <CodeEditor
        ariaLabel="Manifest YAML"
        language="yaml"
        value={value.manifestContent}
        onChange={(manifestContent) => onChange({ ...value, manifestContent })}
      />
      <FieldError message={errors.manifestContent} />
    </div>
  );
}
