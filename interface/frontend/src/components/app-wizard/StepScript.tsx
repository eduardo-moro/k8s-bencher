import { CodeEditor } from "@/components/CodeEditor";
import { FieldError } from "./FieldError";
import type { AppDetail } from "@/lib/api";

export function StepScript({
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
        Este é o script k6 que vai gerar carga contra o app durante a execução.
      </p>
      <CodeEditor
        ariaLabel="Script do k6"
        language="javascript"
        value={value.scriptContent}
        onChange={(scriptContent) => onChange({ ...value, scriptContent })}
      />
      <FieldError message={errors.scriptContent} />
    </div>
  );
}
