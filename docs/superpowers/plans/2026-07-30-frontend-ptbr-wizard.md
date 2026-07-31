# Frontend PT-BR Translation + App Config Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Translate every user-facing string in `interface/frontend/` to Brazilian Portuguese, and replace the single-page app config editor (`AppForm.tsx`) with a step-by-step wizard (`app-wizard/`) that walks a first-time user through one concern at a time.

**Architecture:** A new `src/components/app-wizard/` folder holds one "dumb" leaf component per step (fields only, no title/Card chrome) plus an `AppWizard.tsx` orchestrator that owns step navigation, free jump-to-any-step, and the validate-then-save flow. `AppWizard` takes `onSave`/`onCancel`/`onLoadTemplate` as injected callbacks so it owns no router/query-client dependency itself — the two route files (`apps.new.tsx`, `apps.$name.edit.tsx`) keep owning mutations/navigation, same split as today's `AppForm`. Everything else (Dashboard, App detail, Results, RunBanner, EnvStatus, 404/error pages) gets its strings translated in place, no structural changes.

**Tech Stack:** React 19, TanStack Start/Router, TanStack Query, Tailwind, shadcn/ui (`interface/frontend/`) — no test framework in this project (confirmed: no Vitest/Jest config or test files), so verification is `tsc --noEmit` + `grep` for the new strings + live curl checks against the dev server's SSR output, not automated tests.

## Global Constraints

- Brazilian Portuguese throughout; no i18n library, no language switcher — strings are hardcoded in place.
- Technical loanwords stay as commonly used in PT-BR dev contexts: "app", "container", "deploy", "cluster", "script", "manifest" are NOT translated; full sentences and labels around them are.
- `JobStatus` wire values (`"starting" | "running" | "done" | "failed"`) stay in English in code/types — only their *displayed* label translates, via a lookup map.
- Error text that originates from the API response body (`{error: "..."}` / `{message: "..."}`, e.g. "App 'x' not found") is backend-authored and stays in English — translating it would mean touching `interface/API` route handlers, which is out of scope. Only frontend-authored strings (labels, buttons, toasts, the one hardcoded network-failure message in `lib/api.ts`) get translated.
- No change to `lib/api.ts`'s function signatures, `interface/API` (any backend file), or the validation *rules* in `validateApp` — only their message text and when they're surfaced.
- No localStorage draft persistence — matches today's no-persistence behavior, not a regression.
- Step navigation is free (no validation gate on Próximo/Voltar/stepper clicks); only "Salvar e sair" / the Revisão step's Salvar button run `validateApp` and, on failure, jump to the first step owning an invalid field.
- Step keys stored in the URL (`?passo=identidade`) and used internally are Portuguese slugs: `inicio`, `identidade`, `recursos`, `carga`, `manifest`, `script`, `revisao` (`manifest`/`script` unchanged since they name real files).

---

### Task 1: `FieldError` helper + `StepIdentity`

**Files:**
- Create: `interface/frontend/src/components/app-wizard/FieldError.tsx`
- Create: `interface/frontend/src/components/app-wizard/StepIdentity.tsx`

**Interfaces:**
- Consumes: `AppDetail` from `@/lib/api` (existing type, unchanged).
- Produces: `FieldError({ message }: { message?: string })`, used by every step task below. `StepIdentity({ value, onChange, errors, lockName }: { value: AppDetail; onChange: (v: AppDetail) => void; errors: Record<string, string>; lockName?: boolean })`, used by Task 8 (`AppWizard`).

- [ ] **Step 1: Create `FieldError.tsx`**

```tsx
export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-destructive">{message}</p>;
}
```

- [ ] **Step 2: Create `StepIdentity.tsx`**

```tsx
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
```

- [ ] **Step 3: Typecheck**

```bash
cd interface/frontend
npx tsc --noEmit
```
Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
git add interface/frontend/src/components/app-wizard/FieldError.tsx interface/frontend/src/components/app-wizard/StepIdentity.tsx
git commit -m "Add FieldError helper and StepIdentity wizard step"
```

---

### Task 2: `StepResources`

**Files:**
- Create: `interface/frontend/src/components/app-wizard/StepResources.tsx`

**Interfaces:**
- Consumes: `AppDetail` from `@/lib/api`, `FieldError` from Task 1, existing `ChipListInput` from `@/components/ChipListInput` (unchanged).
- Produces: `StepResources({ value, onChange, errors }: { value: AppDetail; onChange: (v: AppDetail) => void; errors: Record<string, string> })`, used by Task 8.

- [ ] **Step 1: Create `StepResources.tsx`**

```tsx
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
    <div className="grid gap-4 sm:grid-cols-2">
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
      <p className="text-xs text-muted-foreground sm:col-span-2">
        A execução varre todas as combinações de memória × CPU:{" "}
        <span className="font-mono text-foreground">
          {value.resources.memory.length * value.resources.cpu.length}
        </span>{" "}
        níveis.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd interface/frontend
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add interface/frontend/src/components/app-wizard/StepResources.tsx
git commit -m "Add StepResources wizard step"
```

---

### Task 3: `StepLoad`

**Files:**
- Create: `interface/frontend/src/components/app-wizard/StepLoad.tsx`

**Interfaces:**
- Consumes: `AppDetail` from `@/lib/api`, `FieldError` from Task 1.
- Produces: `StepLoad({ value, onChange, errors }: { value: AppDetail; onChange: (v: AppDetail) => void; errors: Record<string, string> })`, used by Task 8.

- [ ] **Step 1: Create `StepLoad.tsx`**

```tsx
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
```

- [ ] **Step 2: Typecheck**

```bash
cd interface/frontend
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add interface/frontend/src/components/app-wizard/StepLoad.tsx
git commit -m "Add StepLoad wizard step"
```

---

### Task 4: `StepManifest` + `StepScript`

**Files:**
- Create: `interface/frontend/src/components/app-wizard/StepManifest.tsx`
- Create: `interface/frontend/src/components/app-wizard/StepScript.tsx`

**Interfaces:**
- Consumes: `AppDetail` from `@/lib/api`, `FieldError` from Task 1.
- Produces: `StepManifest({ value, onChange, errors })`, `StepScript({ value, onChange, errors })` — both `{ value: AppDetail; onChange: (v: AppDetail) => void; errors: Record<string, string> }` — used by Task 8.

- [ ] **Step 1: Create `StepManifest.tsx`**

```tsx
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
```

- [ ] **Step 2: Create `StepScript.tsx`**

```tsx
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
```

- [ ] **Step 3: Typecheck**

```bash
cd interface/frontend
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add interface/frontend/src/components/app-wizard/StepManifest.tsx interface/frontend/src/components/app-wizard/StepScript.tsx
git commit -m "Add StepManifest and StepScript wizard steps"
```

---

### Task 5: `StepStart`

**Files:**
- Create: `interface/frontend/src/components/app-wizard/StepStart.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks (self-contained, no `AppDetail`).
- Produces: `StepStart({ onPickBlank, onPickExample, loadingExample }: { onPickBlank: () => void; onPickExample: () => void; loadingExample: boolean })`, used by Task 8.

- [ ] **Step 1: Create `StepStart.tsx`**

```tsx
import { Sparkles, FilePlus2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function StepStart({
  onPickBlank,
  onPickExample,
  loadingExample,
}: {
  onPickBlank: () => void;
  onPickExample: () => void;
  loadingExample: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card
        className="cursor-pointer transition-colors hover:border-primary"
        onClick={onPickBlank}
      >
        <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
          <FilePlus2 className="size-6 text-muted-foreground" />
          <p className="font-medium">Começar do zero</p>
          <p className="text-xs text-muted-foreground">
            Você preenche cada campo do seu jeito, passo a passo.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onPickBlank}>
            Começar do zero
          </Button>
        </CardContent>
      </Card>
      <Card
        className="cursor-pointer transition-colors hover:border-primary"
        onClick={onPickExample}
      >
        <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
          <Sparkles className="size-6 text-muted-foreground" />
          <p className="font-medium">Usar o exemplo httpbin</p>
          <p className="text-xs text-muted-foreground">
            Não sabe por onde começar? Comece pelo exemplo pronto e ajuste depois.
          </p>
          <Button type="button" size="sm" disabled={loadingExample} onClick={onPickExample}>
            {loadingExample ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            Usar o exemplo
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd interface/frontend
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add interface/frontend/src/components/app-wizard/StepStart.tsx
git commit -m "Add StepStart wizard step (blank vs example choice)"
```

---

### Task 6: `StepReview`

**Files:**
- Create: `interface/frontend/src/components/app-wizard/StepReview.tsx`

**Interfaces:**
- Consumes: `AppDetail` from `@/lib/api`, existing `LogView` from `@/components/LogView` (unchanged this task — its own translation is Task 13), `StepKey` type from Task 8 (`AppWizard.tsx` — declared there; this file only imports the type, no runtime circular dependency since `AppWizard.tsx` doesn't import `StepReview` until its own step; TypeScript resolves type-only circular imports fine, but to avoid any ordering fragility this task defines `StepKey` locally as a duplicate-free re-export is NOT needed — see note in Step 1).
- Produces: `StepReview({ value, onEditStep, onSave, saving }: { value: AppDetail; onEditStep: (step: StepKey) => void; onSave: () => void; saving: boolean })`, used by Task 8.

- [ ] **Step 1: Create `StepReview.tsx`**

Note: this file imports `type { StepKey }` from `./AppWizard`, which doesn't exist until Task 8. That's fine — TypeScript only needs the type at check time, and Task 8's typecheck step (which runs after both files exist) is what actually validates this. Skip typechecking this file in isolation; go straight to the commit.

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add interface/frontend/src/components/app-wizard/StepReview.tsx
git commit -m "Add StepReview wizard step"
```

---

### Task 7: `StepIndicator`

**Files:**
- Create: `interface/frontend/src/components/app-wizard/StepIndicator.tsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils` (existing), `StepKey` type from Task 8.
- Produces: `StepIndicator({ steps, current, visited, onSelect }: { steps: { key: StepKey; label: string }[]; current: StepKey; visited: Set<StepKey>; onSelect: (step: StepKey) => void })`, used by Task 8.

Note: this file imports `type { StepKey }` from `./AppWizard`, which doesn't exist until Task 8 — same forward reference as Task 6. Running `tsc --noEmit` now would fail with "Cannot find module './AppWizard'", so skip typechecking this file in isolation; Task 8's typecheck step is what validates it once both files exist.

- [ ] **Step 1: Create `StepIndicator.tsx`**

```tsx
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StepKey } from "./AppWizard";

export function StepIndicator({
  steps,
  current,
  visited,
  onSelect,
}: {
  steps: { key: StepKey; label: string }[];
  current: StepKey;
  visited: Set<StepKey>;
  onSelect: (step: StepKey) => void;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs">
      {steps.map((step, i) => {
        const isCurrent = step.key === current;
        const isVisited = visited.has(step.key);
        return (
          <li key={step.key} className="flex items-center gap-1">
            {i > 0 && <span className="mx-1 text-muted-foreground">→</span>}
            <button
              type="button"
              onClick={() => onSelect(step.key)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono transition-colors",
                isCurrent
                  ? "border-primary bg-primary/10 text-primary"
                  : isVisited
                    ? "border-success/40 text-success hover:bg-success/10"
                    : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {isVisited && !isCurrent && <Check className="size-3" />}
              {i + 1}. {step.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add interface/frontend/src/components/app-wizard/StepIndicator.tsx
git commit -m "Add StepIndicator wizard stepper"
```

---

### Task 8: `AppWizard` orchestrator

**Files:**
- Create: `interface/frontend/src/components/app-wizard/AppWizard.tsx`

**Interfaces:**
- Consumes: `AppDetail` from `@/lib/api`; `StepIdentity` (Task 1), `StepResources` (Task 2), `StepLoad` (Task 3), `StepManifest`/`StepScript` (Task 4), `StepStart` (Task 5), `StepReview` (Task 6), `StepIndicator` (Task 7); `toast` from `sonner`; `Button`/`Card`/`CardContent` from `@/components/ui/*`.
- Produces: `export type StepKey`, `export const emptyApp: AppDetail`, `export function validateApp(v: AppDetail): Record<string, string>`, `export function AppWizard(props: { mode: "create" | "edit"; initialValue: AppDetail; onSave: (app: AppDetail) => Promise<void>; onCancel: () => void; onLoadTemplate?: () => Promise<AppDetail>; initialStep?: StepKey; onStepChange?: (step: StepKey) => void })` — all consumed by Task 9 and Task 10 (route files), which is also where `AppForm.tsx` (today's `emptyApp`/`validateApp` source) gets its imports redirected before deletion.

- [ ] **Step 1: Create `AppWizard.tsx`**

```tsx
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
```

- [ ] **Step 2: Typecheck (validates this file plus Tasks 6 and 7's forward type references)**

```bash
cd interface/frontend
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add interface/frontend/src/components/app-wizard/AppWizard.tsx
git commit -m "Add AppWizard orchestrator: step navigation, validate-and-jump save flow"
```

---

### Task 9: Wire `apps.new.tsx` to `AppWizard`

**Files:**
- Modify: `interface/frontend/src/routes/apps.new.tsx` (full rewrite)

**Interfaces:**
- Consumes: `AppWizard`, `emptyApp`, `StepKey` from Task 8; `api`, `AppDetail` from `@/lib/api` (unchanged).
- Produces: nothing new consumed elsewhere — this is a route leaf.

- [ ] **Step 1: Replace `apps.new.tsx`**

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppWizard, emptyApp, type StepKey } from "@/components/app-wizard/AppWizard";
import { api, type AppDetail } from "@/lib/api";

type NewAppSearch = { passo?: string };

export const Route = createFileRoute("/apps/new")({
  validateSearch: (search: Record<string, unknown>): NewAppSearch => ({
    passo: typeof search.passo === "string" ? search.passo : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Novo app — console perftest" },
      {
        name: "description",
        content: "Configure um novo app: container, matriz de recursos e perfil de carga do k6.",
      },
      { property: "og:title", content: "Novo app — console perftest" },
      {
        property: "og:description",
        content: "Configure um novo app para varreduras de recursos no Kubernetes.",
      },
    ],
  }),
  component: NewApp,
});

function NewApp() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { passo } = Route.useSearch();

  const create = useMutation({ mutationFn: (body: AppDetail) => api.createApp(body) });

  return (
    <AppWizard
      mode="create"
      initialValue={emptyApp}
      initialStep={passo as StepKey | undefined}
      onStepChange={(next) => navigate({ to: "/apps/new", search: { passo: next }, replace: true })}
      onLoadTemplate={api.template}
      onSave={async (app) => {
        const created = await create.mutateAsync(app);
        qc.invalidateQueries({ queryKey: ["apps"] });
        toast.success(`App ${created.name} criado`);
        navigate({ to: "/apps/$name", params: { name: created.name } });
      }}
      onCancel={() => navigate({ to: "/" })}
    />
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd interface/frontend
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 3: Start the dev server and verify the wizard renders**

```bash
cd interface/frontend
npm run dev > /tmp-frontend-dev.log 2>&1 &
sleep 6
grep -oE ':[0-9]{4}' /tmp-frontend-dev.log | head -1
```
Note the port printed (e.g. `8080`), then:

```bash
curl -s "http://localhost:<PORT>/apps/new" | grep -o "Vamos começar"
curl -s "http://localhost:<PORT>/apps/new" | grep -o "Começar do zero"
curl -s "http://localhost:<PORT>/apps/new" | grep -o "Usar o exemplo httpbin"
```
Expected: each `grep` prints the matched text (confirms the wizard's `inicio` step renders server-side with the right Portuguese copy). Then stop the server:

```bash
netstat -ano | grep LISTENING | grep ':<PORT> ' # find the PID
taskkill //PID <pid> //F
rm -f /tmp-frontend-dev.log
```

- [ ] **Step 4: Commit**

```bash
git add interface/frontend/src/routes/apps.new.tsx
git commit -m "Wire /apps/new to AppWizard"
```

---

### Task 10: Wire `apps.$name.edit.tsx` to `AppWizard`, delete `AppForm.tsx`

**Files:**
- Modify: `interface/frontend/src/routes/apps.$name.edit.tsx` (full rewrite)
- Delete: `interface/frontend/src/components/AppForm.tsx`

**Interfaces:**
- Consumes: `AppWizard`, `StepKey` from Task 8; `api`, `AppDetail` from `@/lib/api` (unchanged).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Replace `apps.$name.edit.tsx`**

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppWizard, type StepKey } from "@/components/app-wizard/AppWizard";
import { api, type AppDetail } from "@/lib/api";

type EditAppSearch = { passo?: string };

export const Route = createFileRoute("/apps/$name/edit")({
  validateSearch: (search: Record<string, unknown>): EditAppSearch => ({
    passo: typeof search.passo === "string" ? search.passo : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Editar app — console perftest" },
      {
        name: "description",
        content: "Edite o container, a matriz de recursos, o manifest e o script k6 de um app.",
      },
      { property: "og:title", content: "Editar app — console perftest" },
      { property: "og:description", content: "Edite a configuração de perftest de um app." },
    ],
  }),
  component: EditApp,
});

function EditApp() {
  const { name } = Route.useParams();
  const { passo } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["app", name],
    queryFn: () => api.getApp(name),
  });

  const save = useMutation({ mutationFn: (body: AppDetail) => api.updateApp(name, body) });

  if (error)
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {(error as Error).message}
      </div>
    );
  if (isLoading || !data)
    return <p className="font-mono text-sm text-muted-foreground">carregando {name}…</p>;

  return (
    <AppWizard
      mode="edit"
      initialValue={data}
      initialStep={passo as StepKey | undefined}
      onStepChange={(next) =>
        navigate({ to: "/apps/$name/edit", params: { name }, search: { passo: next }, replace: true })
      }
      onSave={async (app) => {
        await save.mutateAsync(app);
        qc.invalidateQueries({ queryKey: ["apps"] });
        qc.invalidateQueries({ queryKey: ["app", name] });
        toast.success(`Alterações salvas em ${name}`);
        navigate({ to: "/apps/$name", params: { name } });
      }}
      onCancel={() => navigate({ to: "/apps/$name", params: { name } })}
    />
  );
}
```

- [ ] **Step 2: Delete `AppForm.tsx`**

```bash
git rm interface/frontend/src/components/AppForm.tsx
```

- [ ] **Step 3: Typecheck**

```bash
cd interface/frontend
npx tsc --noEmit
```
Expected: no output. (Confirms nothing else still imports the deleted `AppForm.tsx`.)

- [ ] **Step 4: Start the dev server and verify the edit wizard renders for an existing app**

This machine already has `configs/example.yaml` (app name `example`) from earlier manual testing — reuse it, or substitute any app name that exists in your `configs/` directory.

```bash
cd interface/frontend
npm run dev > /tmp-frontend-dev.log 2>&1 &
sleep 6
grep -oE ':[0-9]{4}' /tmp-frontend-dev.log | head -1
```
Note the port, then:

```bash
curl -s "http://localhost:<PORT>/apps/example/edit" | grep -o "Identidade"
curl -s "http://localhost:<PORT>/apps/example/edit" | grep -o "O nome fica travado"
```
Expected: both `grep`s print matches (confirms edit mode starts at Identidade, not Início, and the name field shows the locked-name hint). Then stop the server the same way as Task 9 Step 3.

- [ ] **Step 5: Commit**

```bash
git add interface/frontend/src/routes/apps.$name.edit.tsx
git commit -m "Wire /apps/:name/edit to AppWizard, remove AppForm"
```

---

### Task 11: Translate `__root.tsx` and `index.tsx` (Dashboard)

**Files:**
- Modify: `interface/frontend/src/routes/__root.tsx`
- Modify: `interface/frontend/src/routes/index.tsx`

**Interfaces:**
- Consumes: nothing new — pure string edits to existing files.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Edit `__root.tsx`** — replace every English string with its Portuguese equivalent, and `lang="en"` with `lang="pt-BR"`:

| Find | Replace with |
|---|---|
| `lang="en"` | `lang="pt-BR"` |
| `{ title: "perftest-api — Kubernetes resource right-sizing" }` | `{ title: "perftest-api — ajuste fino de recursos no Kubernetes" }` |
| `content: "Local dev console for sweeping k6 load tests across Kubernetes CPU/memory tiers in a disposable kind cluster."` | `content: "Console local para varrer testes de carga k6 por níveis de CPU/memória do Kubernetes em um cluster kind descartável."` |
| `{ property: "og:title", content: "perftest-api console" }` | `{ property: "og:title", content: "console perftest-api" }` |
| `content: "Right-size Kubernetes CPU/memory requests with k6 load-test sweeps."` | `content: "Ajuste fino de CPU/memória no Kubernetes com varreduras de testes de carga k6."` |
| `<h1 className="text-7xl font-bold text-foreground">404</h1>` | unchanged (just the number) |
| `<h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>` | `<h2 className="mt-4 text-xl font-semibold text-foreground">Página não encontrada</h2>` |
| `The page you're looking for doesn't exist or has been moved.` | `A página que você procura não existe ou foi movida.` |
| `Go home` (both occurrences: 404 link and error page link) | `Voltar ao início` |
| `This page didn't load` | `Esta página não carregou` |
| `Something went wrong on our end. You can try refreshing or head back home.` | `Algo deu errado do nosso lado. Tente atualizar a página ou volte para o início.` |
| `Try again` | `Tentar novamente` |
| `k8s resource right-sizing` | `ajuste fino de recursos k8s` |

Apply each replacement with the Edit tool against the actual file content (the table above is the authoritative source text/target text pairing — read the file first since exact surrounding JSX must match for the tool's exact-match replacement).

- [ ] **Step 2: Edit `index.tsx`** — replace every English string:

| Find | Replace with |
|---|---|
| `{ title: "Apps — perftest console" }` | `{ title: "Apps — console perftest" }` |
| `"All configured apps with their CPU and memory sweep matrices, plus local prerequisite status."` | `"Todos os apps configurados com suas matrizes de varredura de CPU e memória, além do status dos pré-requisitos locais."` |
| `{ property: "og:title", content: "Apps — perftest console" }` | `{ property: "og:title", content: "Apps — console perftest" }` |
| `"Configured apps and their Kubernetes resource sweep matrices."` | `"Apps configurados e suas matrizes de varredura de recursos no Kubernetes."` |
| `Sweep k6 load tests across CPU/memory tiers in a disposable kind cluster.` | `Varra testes de carga k6 por níveis de CPU/memória em um cluster kind descartável.` |
| `<Plus className="size-4" /> New app` | `<Plus className="size-4" /> Novo app` |
| `loading apps…` | `carregando apps…` |
| `No apps configured yet` | `Nenhum app configurado ainda` |
| `Create your first app — you can start from the bundled httpbin example and tweak it.` | `Crie seu primeiro app — você pode começar pelo exemplo httpbin incluso e ajustar depois.` |
| `<Plus className="size-4" /> Create from example` | `<Plus className="size-4" /> Criar a partir do exemplo` |
| `title={running ? "Another run is already in progress" : "Start run"}` | `title={running ? "Já existe uma execução em andamento" : "Iniciar execução"}` |
| `<Play className="size-3.5" /> Run` | `<Play className="size-3.5" /> Executar` |
| `Delete {app.name}?` | `` Excluir {app.name}? `` |
| `This removes the app's config, manifest and k6 script. Past run outputs on disk are not affected.` | `Isso remove a config, o manifest e o script k6 do app. Os resultados de execuções passadas no disco não são afetados.` |
| `<AlertDialogCancel>Cancel</AlertDialogCancel>` | `<AlertDialogCancel>Cancelar</AlertDialogCancel>` |
| `Delete` (the `AlertDialogAction` button text) | `Excluir` |
| `` toast.success(`Deleted ${name}`) `` | `` toast.success(`Excluído ${name}`) `` |

Note: `aria-label={`Delete ${app.name}`}` is an accessibility string, not visible UI chrome — translate it too for a fully Portuguese screen-reader experience: `` aria-label={`Excluir ${app.name}`} ``.

The table header cells are explicit `<th>` elements, not a mapped array — replace this exact block:

```tsx
              <tr>
                <th className="px-4 py-2 text-left">name</th>
                <th className="px-4 py-2 text-left">container</th>
                <th className="px-4 py-2 text-left">memory</th>
                <th className="px-4 py-2 text-left">cpu</th>
                <th className="px-4 py-2 text-right">tiers</th>
                <th className="px-4 py-2" />
              </tr>
```

with:

```tsx
              <tr>
                <th className="px-4 py-2 text-left">nome</th>
                <th className="px-4 py-2 text-left">container</th>
                <th className="px-4 py-2 text-left">memória</th>
                <th className="px-4 py-2 text-left">cpu</th>
                <th className="px-4 py-2 text-right">níveis</th>
                <th className="px-4 py-2" />
              </tr>
```

- [ ] **Step 3: Typecheck**

```bash
cd interface/frontend
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 4: Grep-verify the new strings landed**

```bash
grep -c "Página não encontrada" interface/frontend/src/routes/__root.tsx
grep -c "Novo app" interface/frontend/src/routes/index.tsx
```
Expected: both print `1`.

- [ ] **Step 5: Commit**

```bash
git add interface/frontend/src/routes/__root.tsx interface/frontend/src/routes/index.tsx
git commit -m "Translate root shell and dashboard to pt-BR"
```

---

### Task 12: Translate `apps.$name.index.tsx`, `StatusBadge.tsx`, `RunBanner.tsx`, `useJob.ts`

**Files:**
- Modify: `interface/frontend/src/routes/apps.$name.index.tsx`
- Modify: `interface/frontend/src/components/StatusBadge.tsx`
- Modify: `interface/frontend/src/components/RunBanner.tsx`
- Modify: `interface/frontend/src/hooks/useJob.ts`

**Interfaces:**
- Consumes: nothing new — string edits only. `StatusBadge`'s prop type (`JobStatus`) is unchanged.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Edit `StatusBadge.tsx`** — add a label lookup, keep the `status` value (used for the `styles` map key and any future logic) untranslated in code, only change what's rendered:

```tsx
import { cn } from "@/lib/utils";
import type { JobStatus } from "@/lib/api";

const styles: Record<JobStatus, string> = {
  starting: "bg-muted text-muted-foreground border-border",
  running: "bg-running/15 text-running border-running/40",
  done: "bg-success/15 text-success border-success/40",
  failed: "bg-destructive/15 text-destructive border-destructive/40",
};

const labels: Record<JobStatus, string> = {
  starting: "iniciando",
  running: "executando",
  done: "concluído",
  failed: "falhou",
};

export function StatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-xs uppercase tracking-wide",
        styles[status],
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full bg-current",
          (status === "running" || status === "starting") && "animate-pulse",
        )}
      />
      {labels[status]}
    </span>
  );
}
```

- [ ] **Step 2: Edit `RunBanner.tsx`** — translate the rendered strings:

| Find | Replace with |
|---|---|
| `{formatElapsed(job.startedAt)} elapsed` | `` {formatElapsed(job.startedAt)} decorrido `` |
| `View live log` | `Ver log ao vivo` |
| `<X className="size-3.5" /> Cancel run` | `<X className="size-3.5" /> Cancelar execução` |

- [ ] **Step 3: Edit `useJob.ts`** — translate the two toast strings:

| Find | Replace with |
|---|---|
| `` toast.success(`Run started for ${job.appName}`); `` | `` toast.success(`Execução iniciada para ${job.appName}`); `` |
| `toast.success("Run cancelled — cluster torn down");` | `toast.success("Execução cancelada — cluster removido");` |

- [ ] **Step 4: Edit `apps.$name.index.tsx`** — translate:

| Find | Replace with |
|---|---|
| `{ title: "App detail — perftest console" }` | `{ title: "Detalhes do app — console perftest" }` |
| `"Review an app's sweep config, start a run, watch the live log and past results."` | `"Veja a configuração de varredura de um app, inicie uma execução, acompanhe o log ao vivo e resultados anteriores."` |
| `{ property: "og:title", content: "App detail — perftest console" }` | `{ property: "og:title", content: "Detalhes do app — console perftest" }` |
| `"Start a resource sweep and watch the live k6 run log."` | `"Inicie uma varredura de recursos e acompanhe o log da execução k6 ao vivo."` |
| `loading {name}…` | `carregando {name}…` |
| `<ArrowLeft className="size-3.5" /> Apps` | unchanged (`Apps` stays — same as Dashboard heading, a proper noun for the section) |
| `container <span ...>{app.container}</span> ·{" "} {app.resources.memory.length * app.resources.cpu.length} tiers` | `container <span ...>{app.container}</span> ·{" "} {app.resources.memory.length * app.resources.cpu.length} níveis` |
| `<Pencil className="size-4" /> Edit` | `<Pencil className="size-4" /> Editar` |
| `title={globallyRunning ? "A run is already in progress — only one kind cluster exists" : "Start a full resource-matrix run"}` | `title={globallyRunning ? "Já existe uma execução em andamento — só existe um cluster kind" : "Iniciar uma execução completa da matriz de recursos"}` |
| `<Play className="size-4" /> Start run` | `<Play className="size-4" /> Iniciar execução` |
| `<CardTitle className="font-mono text-sm">Run</CardTitle>` | `<CardTitle className="font-mono text-sm">Execução</CardTitle>` |
| `· exit ${thisJob.exitCode}` | `` · saída ${thisJob.exitCode} `` |
| `<X className="size-3.5" /> Cancel` | `<X className="size-3.5" /> Cancelar` |
| `View results` | `Ver resultados` |
| `<CardTitle className="font-mono text-sm">Config</CardTitle>` | `<CardTitle className="font-mono text-sm">Configuração</CardTitle>` |
| `<Field label="memory tiers" .../>` | `<Field label="níveis de memória" .../>` |
| `<Field label="cpu tiers" .../>` | `<Field label="níveis de cpu" .../>` |
| `<Field label="vus" .../>` | unchanged (`vus` stays, matches wizard's own field naming) |
| `<Field label="stages" .../>` | `<Field label="estágios" .../>` |
| `<CardTitle className="font-mono text-sm">Past runs</CardTitle>` | `<CardTitle className="font-mono text-sm">Execuções anteriores</CardTitle>` |
| `No runs yet — hit "Start run" to sweep the resource matrix.` | `` Nenhuma execução ainda — clique em "Iniciar execução" para varrer a matriz de recursos. `` |

- [ ] **Step 5: Typecheck**

```bash
cd interface/frontend
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 6: Grep-verify**

```bash
grep -c "executando" interface/frontend/src/components/StatusBadge.tsx
grep -c "Ver log ao vivo" interface/frontend/src/components/RunBanner.tsx
grep -c "Execuções anteriores" interface/frontend/src/routes/apps.\$name.index.tsx
```
Expected: all print `1`.

- [ ] **Step 7: Commit**

```bash
git add interface/frontend/src/routes/apps.\$name.index.tsx interface/frontend/src/components/StatusBadge.tsx interface/frontend/src/components/RunBanner.tsx interface/frontend/src/hooks/useJob.ts
git commit -m "Translate app detail page, status badge, run banner to pt-BR"
```

---

### Task 13: Translate `apps.$name.outputs.$folder.tsx`, `EnvStatus.tsx`, `LogView.tsx`, `ChipListInput.tsx`, `lib/api.ts`

**Files:**
- Modify: `interface/frontend/src/routes/apps.$name.outputs.$folder.tsx`
- Modify: `interface/frontend/src/components/EnvStatus.tsx`
- Modify: `interface/frontend/src/components/LogView.tsx`
- Modify: `interface/frontend/src/components/ChipListInput.tsx`
- Modify: `interface/frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: nothing new — string edits only.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Edit `lib/api.ts`** — the one frontend-authored error string (leave the `body?.message ?? body?.error ?? msg` fallback and `res.statusText` untouched — those carry backend-authored or HTTP-protocol text, out of scope per the Global Constraints):

| Find | Replace with |
|---|---|
| `` throw new ApiError(`Cannot reach perftest-api at ${API_BASE}`, 0); `` | `` throw new ApiError(`Não foi possível conectar à perftest-api em ${API_BASE}`, 0); `` |

- [ ] **Step 2: Edit `LogView.tsx`**:

| Find | Replace with |
|---|---|
| `{text?.trim() ? text : "— no output yet —"}` | `` {text?.trim() ? text : "— sem saída ainda —"} `` |

- [ ] **Step 3: Edit `ChipListInput.tsx`**:

| Find | Replace with |
|---|---|
| `<p className="mt-1 text-xs text-muted-foreground">Press Enter to add.</p>` | `<p className="mt-1 text-xs text-muted-foreground">Pressione Enter para adicionar.</p>` |
| `` aria-label={`Remove ${v} from ${label}`} `` | `` aria-label={`Remover ${v} de ${label}`} `` |

- [ ] **Step 4: Edit `EnvStatus.tsx`**:

| Find | Replace with |
|---|---|
| `` isError ? "api unreachable" : data ? (ready ? "env ready" : "env not ready") : "checking…" `` | `` isError ? "api inacessível" : data ? (ready ? "ambiente pronto" : "ambiente não pronto") : "verificando…" `` |
| `aria-label="Re-run prerequisite check"` | `aria-label="Executar novamente a verificação de pré-requisitos"` |
| `Prerequisites: kind, kubectl, k6, docker, powershell-yaml` | `Pré-requisitos: kind, kubectl, k6, docker, powershell-yaml` |
| `text={data?.output ?? "No check output."}` | `text={data?.output ?? "Nenhuma saída de verificação."}` |

- [ ] **Step 5: Edit `apps.$name.outputs.$folder.tsx`**:

| Find | Replace with |
|---|---|
| `{ title: "Run results — perftest console" }` | `{ title: "Resultados da execução — console perftest" }` |
| `"p95/p99 latency, error rate and OOM findings for every CPU/memory tier in a sweep."` | `"Latência p95/p99, taxa de erro e ocorrências de OOM para cada nível de CPU/memória de uma varredura."` |
| `{ property: "og:title", content: "Run results — perftest console" }` | `{ property: "og:title", content: "Resultados da execução — console perftest" }` |
| `"Latency and OOM results per resource tier from a k6 sweep."` | `"Resultados de latência e OOM por nível de recursos de uma varredura k6."` |
| `<Download className="size-4" /> Download raw CSV` | `<Download className="size-4" /> Baixar CSV bruto` |
| `loading results…` | `carregando resultados…` |
| `p95 latency by tier (cpu/memory)` | `latência p95 por nível (cpu/memória)` |
| `Sweet spot:{" "}` | `` Melhor combinação:{" "} `` |
| `This run produced no result rows.` | `Esta execução não produziu linhas de resultado.` |
| `this tier broke the app` | `este nível quebrou o app` |
| `{r.oom_killed ? "OOMKilled" : "no"}` | `` {r.oom_killed ? "OOMKilled" : "não"} `` |

The table header cells come from a mapped array — replace this exact block:

```tsx
                {[
                  "memory",
                  "cpu",
                  "p95 ms",
                  "p99 ms",
                  "error rate",
                  "http reqs",
                  "oom",
                  "restarts",
                  "duration s",
                ].map((h) => (
```

with:

```tsx
                {[
                  "memória",
                  "cpu",
                  "p95 ms",
                  "p99 ms",
                  "taxa de erro",
                  "reqs http",
                  "oom",
                  "reinícios",
                  "duração s",
                ].map((h) => (
```

- [ ] **Step 6: Typecheck**

```bash
cd interface/frontend
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 7: Live-verify the results page and the resources wizard step together**

```bash
cd interface/frontend
npm run dev > /tmp-frontend-dev.log 2>&1 &
sleep 6
grep -oE ':[0-9]{4}' /tmp-frontend-dev.log | head -1
```
Note the port, then:

```bash
curl -s "http://localhost:<PORT>/" | grep -o "verificando…"
curl -s "http://localhost:<PORT>/apps/new?passo=recursos" | grep -o "Pressione Enter para adicionar."
```
Expected: both print a match (confirms `EnvStatus`'s initial-load label and `ChipListInput`'s hint text, reached this time via the wizard's `recursos` step deep-linked directly through the `passo` search param). Then stop the server the same way as Task 9 Step 3.

- [ ] **Step 8: Commit**

```bash
git add interface/frontend/src/routes/apps.\$name.outputs.\$folder.tsx interface/frontend/src/components/EnvStatus.tsx interface/frontend/src/components/LogView.tsx interface/frontend/src/components/ChipListInput.tsx interface/frontend/src/lib/api.ts
git commit -m "Translate results page, env status, log view, chip input to pt-BR"
```

---

### Task 14: Wizard layout rework — centered, fixed footer, vertical fields, stable-width step pills

Added mid-plan per explicit user request after seeing Tasks 1-10 build the wizard. Purely visual/CSS — no logic changes, no new props, no behavior changes to navigation or validation.

**Files:**
- Modify: `interface/frontend/src/components/app-wizard/AppWizard.tsx` (full replacement)
- Modify: `interface/frontend/src/components/app-wizard/StepIndicator.tsx` (full replacement)
- Modify: `interface/frontend/src/components/app-wizard/StepIdentity.tsx` (full replacement)
- Modify: `interface/frontend/src/components/app-wizard/StepResources.tsx` (full replacement)
- Modify: `interface/frontend/src/components/app-wizard/StepStart.tsx` (full replacement)

**Interfaces:**
- Consumes: nothing new — same props/exports as Tasks 1-8 established, unchanged.
- Produces: nothing new — no exported signature changes anywhere in this task.

- [ ] **Step 1: Replace `AppWizard.tsx`** — two className changes only: the outer wrapper becomes a centered, width-capped column (`mx-auto max-w-3xl`, plus bottom padding so content never sits behind the now-sticky footer), and the Voltar/Salvar e sair/Próximo footer becomes `sticky bottom-0` so its position on screen never changes as step content scrolls (mirrors the existing `sticky top-0` header pattern in `__root.tsx`).

```tsx
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
    <div className="mx-auto grid max-w-3xl gap-5 pb-28">
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
        <div className="sticky bottom-0 z-30 flex items-center justify-between gap-3 border-t border-border bg-background/95 px-4 py-4 backdrop-blur">
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
```

- [ ] **Step 2: Replace `StepIndicator.tsx`** — wrap the conditional Check icon in a fixed-size slot (`size-3 shrink-0`) that always renders, empty or not, so a given pill's own width never changes as it moves between not-visited → current → visited (previously the icon only existed in the DOM when visited-and-not-current, so that transition added/removed width).

```tsx
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StepKey } from "./AppWizard";

export function StepIndicator({
  steps,
  current,
  visited,
  onSelect,
}: {
  steps: { key: StepKey; label: string }[];
  current: StepKey;
  visited: Set<StepKey>;
  onSelect: (step: StepKey) => void;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs">
      {steps.map((step, i) => {
        const isCurrent = step.key === current;
        const isVisited = visited.has(step.key);
        return (
          <li key={step.key} className="flex items-center gap-1">
            {i > 0 && <span className="mx-1 text-muted-foreground">→</span>}
            <button
              type="button"
              onClick={() => onSelect(step.key)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono transition-colors",
                isCurrent
                  ? "border-primary bg-primary/10 text-primary"
                  : isVisited
                    ? "border-success/40 text-success hover:bg-success/10"
                    : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              <span className="inline-flex size-3 shrink-0 items-center justify-center">
                {isVisited && !isCurrent && <Check className="size-3" />}
              </span>
              {i + 1}. {step.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 3: Replace `StepIdentity.tsx`** — drop the `sm:grid-cols-2` so Nome do app stacks above Nome do container instead of sitting side by side.

```tsx
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
    <div className="grid gap-4">
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
```

- [ ] **Step 4: Replace `StepResources.tsx`** — same `sm:grid-cols-2` removal, plus the now-meaningless `sm:col-span-2` on the summary line drops too (a `col-span` only matters inside a multi-column grid).

```tsx
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
```

- [ ] **Step 5: Replace `StepStart.tsx`** — same `sm:grid-cols-2` removal so the two choice cards (começar do zero / usar o exemplo) stack vertically instead of side by side.

```tsx
import { Sparkles, FilePlus2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function StepStart({
  onPickBlank,
  onPickExample,
  loadingExample,
}: {
  onPickBlank: () => void;
  onPickExample: () => void;
  loadingExample: boolean;
}) {
  return (
    <div className="grid gap-4">
      <Card
        className="cursor-pointer transition-colors hover:border-primary"
        onClick={onPickBlank}
      >
        <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
          <FilePlus2 className="size-6 text-muted-foreground" />
          <p className="font-medium">Começar do zero</p>
          <p className="text-xs text-muted-foreground">
            Você preenche cada campo do seu jeito, passo a passo.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onPickBlank}>
            Começar do zero
          </Button>
        </CardContent>
      </Card>
      <Card
        className="cursor-pointer transition-colors hover:border-primary"
        onClick={onPickExample}
      >
        <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
          <Sparkles className="size-6 text-muted-foreground" />
          <p className="font-medium">Usar o exemplo httpbin</p>
          <p className="text-xs text-muted-foreground">
            Não sabe por onde começar? Comece pelo exemplo pronto e ajuste depois.
          </p>
          <Button type="button" size="sm" disabled={loadingExample} onClick={onPickExample}>
            {loadingExample ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            Usar o exemplo
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck**

```bash
cd interface/frontend
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 7: Live-verify the centered layout, sticky footer, and stable pill widths**

```bash
cd interface/frontend
npm run dev > /tmp-frontend-dev.log 2>&1 &
sleep 6
grep -oE ':[0-9]{4}' /tmp-frontend-dev.log | head -1
```
Note the port, then:

```bash
curl -s "http://localhost:<PORT>/apps/new?passo=identidade" | grep -o "max-w-3xl"
curl -s "http://localhost:<PORT>/apps/new?passo=identidade" | grep -o "sticky bottom-0"
```
Expected: both print a match (confirms the centered-column and sticky-footer classes are present in the server-rendered markup — a real visual/behavioral check needs a browser, which Task 16's manual walkthrough covers; this is just confirming the classes shipped). Then stop the server the same way as earlier live-verification steps (`netstat`/`taskkill` on the noted port).

- [ ] **Step 8: Commit**

```bash
git add interface/frontend/src/components/app-wizard/AppWizard.tsx interface/frontend/src/components/app-wizard/StepIndicator.tsx interface/frontend/src/components/app-wizard/StepIdentity.tsx interface/frontend/src/components/app-wizard/StepResources.tsx interface/frontend/src/components/app-wizard/StepStart.tsx
git commit -m "Center wizard layout, pin footer buttons, stack fields vertically, stabilize step pill widths"
```

---

### Task 15: Run-time estimate on the app detail page

Added mid-plan per explicit user request. Shows an approximate total run duration next to the "Iniciar execução" button, computed from the app's own configured load stages and resource-tier count — the engine runs every stage in sequence, once per memory×cpu combination, so total time scales with both. A flat buffer is included for cluster/rollout overhead per combo, but the UI only ever shows the single combined number — never a breakdown or the word "setup".

**Files:**
- Create: `interface/frontend/src/lib/estimate.ts`
- Modify: `interface/frontend/src/routes/apps.$name.index.tsx`

**Interfaces:**
- Consumes: `AppDetail`'s `load.stages` (`{duration: string, target: number}[]`) and `resources.memory`/`resources.cpu` (`string[]`) from `@/lib/api` (unchanged).
- Produces: `estimateRunSeconds(app: Pick<AppDetail, "load" | "resources">): number` and `formatEstimate(totalSeconds: number): string`, both used only by `apps.$name.index.tsx` in this task (no other consumers planned).

This task runs after Task 12 (which translates `apps.$name.index.tsx` to Portuguese) — the edit below targets that file's already-translated content, not the original English version.

- [ ] **Step 1: Create `estimate.ts`**

```ts
import type { AppDetail } from "./api";

const SETUP_BUFFER_SECONDS = 30;

function parseDurationSeconds(duration: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(duration.trim());
  if (!match) return 0;
  const value = Number(match[1]);
  switch (match[2]) {
    case "ms":
      return value / 1000;
    case "s":
      return value;
    case "m":
      return value * 60;
    case "h":
      return value * 3600;
    default:
      return 0;
  }
}

export function estimateRunSeconds(app: Pick<AppDetail, "load" | "resources">): number {
  const stageSeconds = app.load.stages.reduce((sum, s) => sum + parseDurationSeconds(s.duration), 0);
  const combos = app.resources.memory.length * app.resources.cpu.length;
  return stageSeconds * combos + SETUP_BUFFER_SECONDS;
}

export function formatEstimate(totalSeconds: number): string {
  if (totalSeconds < 60) return `~${Math.round(totalSeconds)}s`;
  return `~${Math.round(totalSeconds / 60)} min`;
}
```

- [ ] **Step 2: Edit `apps.$name.index.tsx`** — add the import, and replace the button-row wrapper so the estimate sits right under the action buttons, right-aligned to match them:

Add to the top imports (alongside the existing `api`/`formatElapsed`/`isActive` import line):

```tsx
import { estimateRunSeconds, formatEstimate } from "@/lib/estimate";
```

Replace this exact block (the button row in the page header, as it reads after Task 12's translation):

```tsx
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/apps/$name/edit" params={{ name }}>
              <Pencil className="size-4" /> Editar
            </Link>
          </Button>
          <Button
            disabled={globallyRunning || startRun.isPending}
            title={
              globallyRunning
                ? "Já existe uma execução em andamento — só existe um cluster kind"
                : "Iniciar uma execução completa da matriz de recursos"
            }
            onClick={() => startRun.mutate(name)}
          >
            <Play className="size-4" /> Iniciar execução
          </Button>
        </div>
```

with:

```tsx
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/apps/$name/edit" params={{ name }}>
                <Pencil className="size-4" /> Editar
              </Link>
            </Button>
            <Button
              disabled={globallyRunning || startRun.isPending}
              title={
                globallyRunning
                  ? "Já existe uma execução em andamento — só existe um cluster kind"
                  : "Iniciar uma execução completa da matriz de recursos"
              }
              onClick={() => startRun.mutate(name)}
            >
              <Play className="size-4" /> Iniciar execução
            </Button>
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            tempo estimado: {formatEstimate(estimateRunSeconds(app))}
          </span>
        </div>
```

- [ ] **Step 3: Typecheck**

```bash
cd interface/frontend
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 4: Grep-verify**

```bash
grep -c "tempo estimado" interface/frontend/src/routes/apps.\$name.index.tsx
```
Expected: prints `1`.

- [ ] **Step 5: Commit**

```bash
git add interface/frontend/src/lib/estimate.ts interface/frontend/src/routes/apps.\$name.index.tsx
git commit -m "Add estimated run duration next to Iniciar execucao"
```

---

### Task 16: Starter manifest/k6 script content for the blank "começar do zero" flow

Added mid-plan per explicit user request: the "começar do zero" path currently gives a blank textarea for both Manifest and Script do k6, which is a rough starting point for a junior developer with no example to work from. This task gives `emptyApp` real starter content instead of empty strings, with only the comments a newcomer genuinely needs (why `Recreate`, why requests/limits match, what to change to point the k6 script at their own app) — not a line-by-line tutorial.

**Files:**
- Modify: `interface/frontend/src/components/app-wizard/AppWizard.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — `emptyApp`'s exported shape/type is unchanged, only its `manifestContent`/`scriptContent` values change from `""` to real starter text.

- [ ] **Step 1: Replace the `emptyApp` block**

The `scriptContent` value below embeds a k6 script that itself uses a template literal (`` `${BASE_URL}/` ``) inside this file's own outer template literal — the inner backticks and `$` are backslash-escaped (`` \` `` and `\$`) so they appear as literal characters in the resulting string rather than being interpreted by TypeScript. Copy this exactly; a mismatched escape will fail `tsc --noEmit` immediately (self-checking), but visually double-check the final file reads as plain, unescaped k6 JS before committing (Step 3 below has you cat the relevant lines for exactly this reason).

Replace:

```tsx
export const emptyApp: AppDetail = {
  name: "",
  container: "",
  resources: { memory: [], cpu: [] },
  load: { vus: 10, stages: [{ duration: "30s", target: 10 }] },
  manifestContent: "",
  scriptContent: "",
};
```

with:

```tsx
export const emptyApp: AppDetail = {
  name: "",
  container: "",
  resources: { memory: [], cpu: [] },
  load: { vus: 10, stages: [{ duration: "30s", target: 10 }] },
  manifestContent: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: minha-app
  labels:
    app: minha-app
spec:
  replicas: 1
  # Recreate (em vez do padrão RollingUpdate) garante que só existe 1 pod
  # por vez - importante porque o perftest troca os recursos (memória/cpu)
  # entre cada combinação testada.
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: minha-app
  template:
    metadata:
      labels:
        app: minha-app
    spec:
      containers:
        - name: minha-app
          image: minha-imagem:latest
          ports:
            - containerPort: 80
          resources:
            # requests e limits iguais: essa é a combinação que o perftest
            # sobrescreve a cada teste da matriz de recursos.
            requests:
              cpu: 250m
              memory: 128Mi
            limits:
              cpu: 250m
              memory: 128Mi
---
apiVersion: v1
kind: Service
metadata:
  name: minha-app
spec:
  selector:
    app: minha-app
  ports:
    - port: 80
      targetPort: 80
`,
  scriptContent: `import http from 'k6/http';
import { check, sleep } from 'k6';

// Troque pela URL do Service definido no manifest acima (nome do Service + porta)
const BASE_URL = 'http://minha-app:80';

export default function () {
  const res = http.get(\`\${BASE_URL}/\`);
  check(res, { 'respondeu 200': (r) => r.status === 200 });
  sleep(1);
}
`,
};
```

- [ ] **Step 2: Typecheck**

```bash
cd interface/frontend
npx tsc --noEmit
```
Expected: no output. If this fails on the `scriptContent` line specifically, the backtick/`$` escaping above was altered — restore it exactly as given, character for character.

- [ ] **Step 3: Visually confirm the embedded k6 script escaped correctly**

```bash
grep -n "BASE_URL\|http.get" interface/frontend/src/components/app-wizard/AppWizard.tsx
```
Expected output includes a line that reads literally `  const res = http.get(\`${BASE_URL}/\`);` (i.e. the *source file* shows the escaped form — that's correct, since this line is TypeScript source containing an escaped nested template literal, not the runtime string value). If instead you see doubled backslashes, missing backticks, or `undefined` anywhere near `BASE_URL`, the escaping was broken — fix it to match Step 1 exactly, don't attempt a different escaping scheme.

- [ ] **Step 4: Live-verify the blank-start flow actually shows this content**

```bash
cd interface/frontend
npm run dev > /tmp-frontend-dev.log 2>&1 &
sleep 6
grep -oE ':[0-9]{4}' /tmp-frontend-dev.log | head -1
```
Note the port, then:

```bash
curl -s "http://localhost:<PORT>/apps/new?passo=manifest" | grep -o "kind: Deployment"
curl -s "http://localhost:<PORT>/apps/new?passo=script" | grep -o "BASE_URL"
```
Expected: both print a match. Then stop the server the same way as earlier live-verification steps (`netstat`/`taskkill` on the noted port).

- [ ] **Step 5: Commit**

```bash
git add interface/frontend/src/components/app-wizard/AppWizard.tsx
git commit -m "Give the blank start flow real starter manifest/k6 script content"
```

---

### Task 17: Final verification pass

**Files:** none created/modified — this task only verifies Tasks 1-16's combined behavior against the real API.

**Interfaces:**
- Consumes: everything from Tasks 1-16.

- [ ] **Step 1: Full typecheck**

```bash
cd interface/frontend
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 2: Confirm no leftover English UI strings in the files this plan touched**

```bash
cd interface/frontend/src
grep -rnE "\b(Cancel|Delete|Save|Edit|Loading|Error|Apps|Run|Start)\b" \
  routes/__root.tsx routes/index.tsx routes/apps.new.tsx routes/apps.\$name.edit.tsx \
  routes/apps.\$name.index.tsx "routes/apps.\$name.outputs.\$folder.tsx" \
  components/RunBanner.tsx components/EnvStatus.tsx components/LogView.tsx \
  components/ChipListInput.tsx components/StatusBadge.tsx hooks/useJob.ts lib/api.ts \
  components/app-wizard/*.tsx || true
```
Expected: either no matches, or only matches that are legitimate (JS/CSS class names like `animate-spin`, or the standalone `Apps` proper-noun label kept intentionally per Task 12 Step 4 — every other hit means a string was missed and needs fixing before continuing).

- [ ] **Step 3: Run `make interface` and walk through the real flows**

```bash
cd ../../..
make interface
```
Note the ports printed for API (3001) and frontend (Vite's chosen port), then in a browser:

1. Go to `/` — confirm the Dashboard, header tagline, and env-status pill are in Portuguese.
2. Click **Novo app** → **Usar o exemplo httpbin** — confirm it loads httpbin's fields and advances to Identidade.
3. Click through Recursos, Carga, Manifest, Script via **Próximo**, then land on Revisão — confirm every field shows correctly and "editar" links jump back to the right step.
4. On Revisão, blank out the container field (click editar → Identidade → clear it), then go back to Revisão and click **Salvar** — confirm it jumps back to Identidade with an inline error and a Portuguese toast, without losing anything you'd entered in Recursos/Carga/Manifest/Script.
5. Fix the field and save for real — confirm it navigates to the new app's detail page with a Portuguese success toast.
6. From the app detail page, click **Iniciar execução**, confirm the Run card and RunBanner show Portuguese status labels while it runs, and **Cancelar** stops it cleanly.
7. Click **Editar** on an existing app — confirm it starts at Identidade (not Início) with the name field locked, and **Salvar e sair** from the middle of the wizard (e.g. from Carga, without visiting Manifest/Script) still validates the whole form and saves correctly.
8. Visit a past run's results page — confirm the table headers, "este nível quebrou o app" warning, and "Baixar CSV bruto" link are all in Portuguese.
9. While in the wizard (any create/edit flow), resize the browser window shorter and scroll a step with long content (e.g. Manifest) — confirm the Voltar/Salvar e sair/Próximo row stays pinned to the bottom of the viewport instead of scrolling away, and the whole wizard column reads as a centered, capped-width block rather than spanning the full page. Confirm Identidade, Recursos, and the Início choice cards stack their fields vertically (no side-by-side columns).
10. Click through several steps via the top stepper (not just Próximo/Voltar) and watch a given pill as it goes from not-visited to current to visited — confirm its width doesn't visibly shift when the checkmark appears/disappears.
11. On an app detail page, confirm a "tempo estimado: ~Xmin" (or "~Xs") line appears next to the Editar/Iniciar execução buttons, and that it changes if you edit the app's stages or resource tiers to be larger/smaller.
12. Click **Novo app** → **Começar do zero** → advance to Manifest and Script — confirm both already show real starter YAML/JS (not blank textareas), with the handful of Portuguese comments explaining `Recreate`, the matching requests/limits, and where to point `BASE_URL`.

Expected: every step above behaves as described, entirely in Portuguese except backend-sourced error text (per Global Constraints) and technical loanwords (app/container/cluster/manifest/script).

- [ ] **Step 4: Stop the servers**

Press Ctrl+C in the `make interface` terminal (the `trap 'kill 0'` in the Makefile stops both the API and frontend dev servers together).

- [ ] **Step 5: No commit needed** — this task is validation only, nothing to add to git beyond what Tasks 1-16 already committed.

---

## Post-plan state

`interface/frontend/` is entirely in Brazilian Portuguese, and creating or editing an app's config is a guided multi-step wizard (Início → Identidade → Recursos → Carga → Manifest → Script → Revisão) instead of one long page — with free navigation between steps, a persistent "Salvar e sair" escape hatch that validates and jumps to the first problem step, and a review screen before anything is actually saved. The wizard renders as a centered, capped-width column with a pinned footer and vertically-stacked fields, and its stepper pills hold a constant width regardless of visited/current state. The app detail page shows an approximate total run duration next to the run/edit actions, computed from the app's own load stages and resource-tier count. Starting a new app from scratch begins with real, lightly-commented example manifest/k6-script content instead of blank textareas. No backend or API-contract changes.
