import { X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";

export function ChipListInput({
  values,
  onChange,
  placeholder,
  label,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  label: string;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const v = draft.trim();
    if (!v || values.includes(v)) {
      setDraft("");
      return;
    }
    onChange([...values, v]);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background p-2">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 font-mono text-xs text-secondary-foreground"
          >
            {v}
            <button
              type="button"
              aria-label={`Remover ${v} de ${label}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={add}
          placeholder={placeholder}
          className="h-7 w-32 flex-1 border-0 bg-transparent px-1 font-mono text-xs shadow-none focus-visible:ring-0"
        />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Pressione Enter para adicionar.</p>
    </div>
  );
}
