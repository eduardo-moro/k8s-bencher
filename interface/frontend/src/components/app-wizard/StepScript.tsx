import { Textarea } from "@/components/ui/textarea";
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
      <Textarea
        aria-label="Script do k6"
        spellCheck={false}
        className="min-h-72 bg-terminal font-mono text-xs text-terminal-foreground"
        value={value.scriptContent}
        onChange={(e) => onChange({ ...value, scriptContent: e.target.value })}
      />
      <FieldError message={errors.scriptContent} />
    </div>
  );
}
