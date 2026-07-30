import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "./FieldError";
import type { AppDetail } from "@/lib/api";

export function StepIdentity({
  value,
  onChange,
  errors,
  lockName,
}: {
  value: AppDetail;
  onChange: (v: AppDetail) => void;
  errors: Record<string, string>;
  lockName?: boolean;
}) {
  const set = (patch: Partial<AppDetail>) => onChange({ ...value, ...patch });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor="name">Nome do app</Label>
        <Input
          id="name"
          className="mt-1.5 font-mono"
          value={value.name}
          disabled={lockName}
          placeholder="httpbin"
          onChange={(e) => set({ name: e.target.value })}
        />
        {lockName && (
          <p className="mt-1 text-xs text-muted-foreground">
            O nome fica travado depois que o app é criado.
          </p>
        )}
        <FieldError message={errors.name} />
      </div>
      <div>
        <Label htmlFor="container">Nome do container</Label>
        <Input
          id="container"
          className="mt-1.5 font-mono"
          value={value.container}
          placeholder="httpbin"
          onChange={(e) => set({ container: e.target.value })}
        />
        <FieldError message={errors.container} />
      </div>
    </div>
  );
}
