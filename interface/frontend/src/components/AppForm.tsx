import { useState } from "react";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChipListInput } from "@/components/ChipListInput";
import type { AppDetail } from "@/lib/api";

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
  if (!v.name.trim()) errors.name = "Name is required";
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(v.name))
    errors.name = "Use lowercase letters, digits and dashes";
  if (!v.container.trim()) errors.container = "Container name is required";
  if (!v.resources.memory.length) errors.memory = "Add at least one memory tier";
  if (!v.resources.cpu.length) errors.cpu = "Add at least one CPU tier";
  if (!Number.isFinite(v.load.vus) || v.load.vus < 1) errors.vus = "VUs must be at least 1";
  if (!v.load.stages.length) errors.stages = "Add at least one stage";
  if (v.load.stages.some((s) => !s.duration.trim()))
    errors.stages = "Every stage needs a duration (e.g. 30s)";
  if (!v.manifestContent.trim()) errors.manifestContent = "Manifest YAML is required";
  if (!v.scriptContent.trim()) errors.scriptContent = "k6 script is required";
  return errors;
}

export function AppForm({
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
  const [dragless] = useState(true);
  void dragless;
  const set = (patch: Partial<AppDetail>) => onChange({ ...value, ...patch });
  const setStages = (stages: AppDetail["load"]["stages"]) =>
    set({ load: { ...value.load, stages } });

  const Err = ({ k }: { k: string }) =>
    errors[k] ? <p className="mt-1 text-xs text-destructive">{errors[k]}</p> : null;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="font-mono text-sm">Identity</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="name">App name</Label>
            <Input
              id="name"
              className="mt-1.5 font-mono"
              value={value.name}
              disabled={lockName}
              placeholder="httpbin"
              onChange={(e) => set({ name: e.target.value })}
            />
            {lockName && (
              <p className="mt-1 text-xs text-muted-foreground">Name is locked after creation.</p>
            )}
            <Err k="name" />
          </div>
          <div>
            <Label htmlFor="container">Container name</Label>
            <Input
              id="container"
              className="mt-1.5 font-mono"
              value={value.container}
              placeholder="httpbin"
              onChange={(e) => set({ container: e.target.value })}
            />
            <Err k="container" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="font-mono text-sm">Resource matrix</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Memory tiers</Label>
            <div className="mt-1.5">
              <ChipListInput
                label="memory tiers"
                values={value.resources.memory}
                placeholder="128Mi"
                onChange={(memory) => set({ resources: { ...value.resources, memory } })}
              />
            </div>
            <Err k="memory" />
          </div>
          <div>
            <Label>CPU tiers</Label>
            <div className="mt-1.5">
              <ChipListInput
                label="cpu tiers"
                values={value.resources.cpu}
                placeholder="250m"
                onChange={(cpu) => set({ resources: { ...value.resources, cpu } })}
              />
            </div>
            <Err k="cpu" />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            The run sweeps every memory × CPU combination:{" "}
            <span className="font-mono text-foreground">
              {value.resources.memory.length * value.resources.cpu.length}
            </span>{" "}
            tiers.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="font-mono text-sm">Load profile</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="max-w-40">
            <Label htmlFor="vus">Virtual users (VUs)</Label>
            <Input
              id="vus"
              type="number"
              min={1}
              className="mt-1.5 font-mono"
              value={value.load.vus}
              onChange={(e) => set({ load: { ...value.load, vus: Number(e.target.value) } })}
            />
            <Err k="vus" />
          </div>

          <div>
            <Label>Stages</Label>
            <div className="mt-1.5 grid gap-2">
              {value.load.stages.map((stage, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    aria-label={`Stage ${i + 1} duration`}
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
                    aria-label={`Stage ${i + 1} target`}
                    type="number"
                    className="w-32 font-mono"
                    placeholder="target"
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
                    aria-label="Move stage up"
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
                    aria-label="Move stage down"
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
                    aria-label="Remove stage"
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
                  <Plus className="size-3.5" /> Add stage
                </Button>
              </div>
            </div>
            <Err k="stages" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="font-mono text-sm">manifest.yaml</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            aria-label="Manifest YAML"
            spellCheck={false}
            className="min-h-72 bg-terminal font-mono text-xs text-terminal-foreground"
            value={value.manifestContent}
            onChange={(e) => set({ manifestContent: e.target.value })}
          />
          <Err k="manifestContent" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="font-mono text-sm">k6 script.js</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            aria-label="k6 script"
            spellCheck={false}
            className="min-h-72 bg-terminal font-mono text-xs text-terminal-foreground"
            value={value.scriptContent}
            onChange={(e) => set({ scriptContent: e.target.value })}
          />
          <Err k="scriptContent" />
        </CardContent>
      </Card>
    </div>
  );
}
