import { Check, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ComboProgress } from "@/lib/runProgress";

const STATUS_STYLES: Record<ComboProgress["status"], string> = {
  pending: "border-border text-muted-foreground",
  running: "border-running/40 bg-running/15 text-running",
  done: "border-success/40 bg-success/15 text-success",
  broken: "border-destructive/40 bg-destructive/15 text-destructive",
};

const STATUS_LABELS: Record<ComboProgress["status"], string> = {
  pending: "pendente",
  running: "executando",
  done: "concluído",
  broken: "com problema",
};

export function RunPipeline({
  combos,
  selected,
  onSelect,
}: {
  combos: ComboProgress[];
  selected?: { memory: string; cpu: string } | null;
  onSelect?: (combo: ComboProgress) => void;
}) {
  const total = combos.length;
  const completed = combos.filter((c) => c.status === "done" || c.status === "broken").length;
  const pct = total ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between font-mono text-xs text-muted-foreground">
        <span>progresso da matriz</span>
        <span>
          {completed}/{total} níveis
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-running transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <ol className="flex flex-wrap items-center gap-1 text-xs">
        {combos.map((c, i) => {
          const isSelected = selected?.memory === c.memory && selected?.cpu === c.cpu;
          return (
            <li key={`${c.memory}-${c.cpu}`} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground">→</span>}
              <button
                type="button"
                onClick={() => onSelect?.(c)}
                aria-pressed={isSelected}
                title={`${c.memory}/${c.cpu} — ${STATUS_LABELS[c.status]}${onSelect ? " · ver logs do pod" : ""}`}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono transition-colors",
                  STATUS_STYLES[c.status],
                  onSelect && "cursor-pointer hover:brightness-95",
                  isSelected && "ring-2 ring-offset-1 ring-offset-background ring-current",
                )}
              >
                {c.status === "running" && (
                  <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-current" />
                )}
                {c.status === "done" && <Check className="size-3 shrink-0" />}
                {c.status === "broken" && <TriangleAlert className="size-3 shrink-0" />}
                {c.memory}/{c.cpu}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
