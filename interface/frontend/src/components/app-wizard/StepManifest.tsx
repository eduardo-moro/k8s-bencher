import { Textarea } from "@/components/ui/textarea";
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
      <Textarea
        aria-label="Manifest YAML"
        spellCheck={false}
        className="min-h-72 bg-terminal font-mono text-xs text-terminal-foreground"
        value={value.manifestContent}
        onChange={(e) => onChange({ ...value, manifestContent: e.target.value })}
      />
      <FieldError message={errors.manifestContent} />
    </div>
  );
}
