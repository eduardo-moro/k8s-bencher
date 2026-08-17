import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine } from "lucide-react";
import { cn } from "@/lib/utils";

// Distance (px) from the bottom that still counts as "at the bottom" - a
// pixel-perfect check would flip on/off from sub-pixel rounding as content
// wraps.
const BOTTOM_THRESHOLD_PX = 24;

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
  const [following, setFollowing] = useState(autoScroll);

  // A caller re-enabling autoScroll (e.g. a new run starting) re-arms
  // following - a previous run's manual "stop following" shouldn't carry
  // over silently into the next one.
  useEffect(() => {
    setFollowing(autoScroll);
  }, [autoScroll]);

  useEffect(() => {
    if (following && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [text, following]);

  function handleScroll() {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
    // Only manual scrolling turns following OFF; turning it back on is the
    // button's job below - otherwise scrolling to exactly the last line by
    // hand would re-subscribe on its own, and the next appended chunk would
    // yank the view right when the user just got there manually.
    if (!atBottom && following) setFollowing(false);
  }

  function scrollToBottom() {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setFollowing(true);
  }

  return (
    <div className="relative">
      <pre
        ref={ref}
        onScroll={handleScroll}
        className={cn(
          "max-h-96 overflow-auto rounded-md border border-border bg-terminal p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-terminal-foreground",
          className,
        )}
      >
        {text?.trim() ? text : "— sem saída ainda —"}
      </pre>
      <button
        type="button"
        onClick={scrollToBottom}
        aria-pressed={following}
        title={following ? "acompanhando o final do log" : "ir para o final"}
        className={cn(
          "absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full border px-2 py-1 font-mono text-[10px] uppercase shadow-sm transition-colors",
          following
            ? "border-running/40 bg-running/15 text-running"
            : "border-border bg-background/90 text-muted-foreground hover:bg-muted",
        )}
      >
        <ArrowDownToLine className="size-3" />
        {following ? "ao vivo" : "ir ao final"}
      </button>
    </div>
  );
}
