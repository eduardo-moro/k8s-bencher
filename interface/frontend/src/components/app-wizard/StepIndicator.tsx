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
