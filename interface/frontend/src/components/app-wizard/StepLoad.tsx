import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "./FieldError";
import type { AppDetail } from "@/lib/api";

export function StepLoad({
  value,
  onChange,
  errors,
}: {
  value: AppDetail;
  onChange: (v: AppDetail) => void;
  errors: Record<string, string>;
}) {
  const set = (patch: Partial<AppDetail>) => onChange({ ...value, ...patch });
  const setStages = (stages: AppDetail["load"]["stages"]) =>
    set({ load: { ...value.load, stages } });

  return (
    <div className="grid gap-4">
      <div className="max-w-40">
        <Label htmlFor="vus">Usuários virtuais (VUs)</Label>
        <Input
          id="vus"
          type="number"
          min={1}
          className="mt-1.5 font-mono"
          value={value.load.vus}
          onChange={(e) => set({ load: { ...value.load, vus: Number(e.target.value) } })}
        />
        <FieldError message={errors.vus} />
      </div>

      <div>
        <Label>Estágios</Label>
        <div className="mt-1.5 grid gap-2">
          {value.load.stages.map((stage, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                aria-label={`Duração do estágio ${i + 1}`}
                className="w-32 font-mono"
                placeholder="30s"
                value={stage.duration}
                onChange={(e) =>
                  setStages(
                    value.load.stages.map((s, j) =>
                      j === i ? { ...s, duration: e.target.value } : s,
                    ),
                  )
                }
              />
              <Input
                aria-label={`Alvo do estágio ${i + 1}`}
                type="number"
                className="w-32 font-mono"
                placeholder="alvo"
                value={stage.target}
                onChange={(e) =>
                  setStages(
                    value.load.stages.map((s, j) =>
                      j === i ? { ...s, target: Number(e.target.value) } : s,
                    ),
                  )
                }
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Mover estágio para cima"
                disabled={i === 0}
                onClick={() => {
                  const next = [...value.load.stages];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  setStages(next);
                }}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Mover estágio para baixo"
                disabled={i === value.load.stages.length - 1}
                onClick={() => {
                  const next = [...value.load.stages];
                  [next[i + 1], next[i]] = [next[i], next[i + 1]];
                  setStages(next);
                }}
              >
                <ArrowDown className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Remover estágio"
                onClick={() => setStages(value.load.stages.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setStages([...value.load.stages, { duration: "30s", target: 10 }])}
            >
              <Plus className="size-3.5" /> Adicionar estágio
            </Button>
          </div>
        </div>
        <FieldError message={errors.stages} />
      </div>
    </div>
  );
}
