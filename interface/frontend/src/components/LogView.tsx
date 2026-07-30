import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export function LogView({
  text,
  autoScroll = false,
  className,
}: {
  text: string;
  autoScroll?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (autoScroll && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [text, autoScroll]);

  return (
    <pre
      ref={ref}
      className={cn(
        "max-h-96 overflow-auto rounded-md border border-border bg-terminal p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-terminal-foreground",
        className,
      )}
    >
      {text?.trim() ? text : "— sem saída ainda —"}
    </pre>
  );
}
