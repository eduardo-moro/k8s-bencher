import { Label } from "@/components/ui/label";
import { ChipListInput } from "@/components/ChipListInput";
import { FieldError } from "./FieldError";
import type { AppDetail } from "@/lib/api";

export function StepResources({
  value,
  onChange,
  errors,
}: {
  value: AppDetail;
  onChange: (v: AppDetail) => void;
  errors: Record<string, string>;
}) {
  const set = (patch: Partial<AppDetail>) => onChange({ ...value, ...patch });

  return (
    <div className="grid gap-4">
      <div>
        <Label>Níveis de memória</Label>
        <div className="mt-1.5">
          <ChipListInput
            label="níveis de memória"
            values={value.resources.memory}
            placeholder="128Mi"
            onChange={(memory) => set({ resources: { ...value.resources, memory } })}
          />
        </div>
        <FieldError message={errors.memory} />
      </div>
      <div>
        <Label>Níveis de CPU</Label>
        <div className="mt-1.5">
          <ChipListInput
            label="níveis de cpu"
            values={value.resources.cpu}
            placeholder="250m"
            onChange={(cpu) => set({ resources: { ...value.resources, cpu } })}
          />
        </div>
        <FieldError message={errors.cpu} />
      </div>
      <p className="text-xs text-muted-foreground">
        A execução varre todas as combinações de memória × CPU:{" "}
        <span className="font-mono text-foreground">
          {value.resources.memory.length * value.resources.cpu.length}
        </span>{" "}
        níveis.
      </p>
    </div>
  );
}
