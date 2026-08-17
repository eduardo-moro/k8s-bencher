import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDownToLine } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const PAGE_LINES = 500;
const LIVE_POLL_MS = 3000;
const BOTTOM_THRESHOLD_PX = 24;
const TOP_THRESHOLD_PX = 48;

// A combo's app log can reach multiple MB of verbose framework logging
// (EF Core query text, request tracing, ...) - fetching and rendering all
// of it at once is what made opening a big log lag the whole page. This
// loads only the tail (newest PAGE_LINES) up front, and fetches the
// preceding page on demand when the user scrolls near the top, same as any
// infinite-scroll list. Live mode re-polls just the tail while "following"
// (see the scroll-to-bottom toggle below); once you scroll up to read
// history, polling stops so it can't yank you back down or fight the
// scroll-up pagination.
function SingleLogPanel({
  name,
  folder,
  memory,
  cpu,
  kind,
  label,
  live,
}: {
  name: string;
  folder: string;
  memory: string;
  cpu: string;
  kind: "app" | "k6";
  label: string;
  live: boolean;
}) {
  const ref = useRef<HTMLPreElement>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [following, setFollowing] = useState(true);
  const loadingOlderRef = useRef(false);
  // Absolute index of the oldest line currently loaded - what "load older"
  // pages backwards from. Must be an absolute index, not lines.length: the
  // file keeps growing while a combo is live-tailing, so "N lines from the
  // (moving) end" silently drifts and re-fetches/duplicates already-loaded
  // lines. An absolute index is stable regardless of how much the file has
  // grown since it was captured (see logPagination.ts on the API side).
  const oldestIndexRef = useRef(0);
  // Set right before a prepend's fetch, read by the layout effect below to
  // tell "just prepended older content" (compensate scroll) apart from
  // "tail replaced" (scroll to bottom) - both change `lines`.
  const prependAdjustRef = useRef<number | null>(null);

  // A fresh panel (new combo/kind) - reset and load the tail.
  useEffect(() => {
    let cancelled = false;
    setFollowing(true);
    setLines([]);
    setHasMore(false);
    api.comboLogsPage(name, folder, memory, cpu, kind, undefined, PAGE_LINES).then((page) => {
      if (cancelled) return;
      setLines(page.lines);
      setHasMore(page.hasMore);
      oldestIndexRef.current = page.startIndex;
    });
    return () => {
      cancelled = true;
    };
  }, [name, folder, memory, cpu, kind]);

  // While following live, periodically refresh to the current tail. Once
  // the user scrolls away (following -> false), this stops on its own.
  useEffect(() => {
    if (!live || !following) return;
    const id = setInterval(() => {
      api.comboLogsPage(name, folder, memory, cpu, kind, undefined, PAGE_LINES).then((page) => {
        setLines(page.lines);
        setHasMore(page.hasMore);
        oldestIndexRef.current = page.startIndex;
      });
    }, LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [live, following, name, folder, memory, cpu, kind]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prependAdjustRef.current !== null) {
      // Keep the viewport pinned to what the user was already looking at,
      // instead of the browser leaving scrollTop fixed and the content
      // jumping downward by the height just added above it.
      el.scrollTop += el.scrollHeight - prependAdjustRef.current;
      prependAdjustRef.current = null;
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines]);

  function loadOlder() {
    if (loadingOlderRef.current || !hasMore) return;
    loadingOlderRef.current = true;
    prependAdjustRef.current = ref.current?.scrollHeight ?? null;
    api.comboLogsPage(name, folder, memory, cpu, kind, oldestIndexRef.current, PAGE_LINES).then((page) => {
      setLines((prev) => [...page.lines, ...prev]);
      setHasMore(page.hasMore);
      oldestIndexRef.current = page.startIndex;
      loadingOlderRef.current = false;
    });
  }

  function handleScroll() {
    const el = ref.current;
    if (!el) return;
    if (el.scrollTop < TOP_THRESHOLD_PX) loadOlder();

    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
    if (!atBottom && following) setFollowing(false);
  }

  function jumpToLive() {
    setFollowing(true);
    api.comboLogsPage(name, folder, memory, cpu, kind, undefined, PAGE_LINES).then((page) => {
      setLines(page.lines);
      setHasMore(page.hasMore);
      oldestIndexRef.current = page.startIndex;
    });
  }

  const text = lines.join("\n");

  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between font-mono text-xs text-muted-foreground">
        <span>{label}</span>
        {live && following && (
          <span className="inline-flex items-center gap-1 text-running">
            <span className="size-1.5 animate-pulse rounded-full bg-current" /> ao vivo
          </span>
        )}
      </div>
      {hasMore && (
        <p className="text-center font-mono text-[10px] text-muted-foreground">
          role para cima para carregar mais
        </p>
      )}
      <div className="relative">
        <pre
          ref={ref}
          onScroll={handleScroll}
          className="max-h-96 overflow-auto rounded-md border border-border bg-terminal p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-terminal-foreground"
        >
          {text.trim() ? text : "— sem saída ainda —"}
        </pre>
        <button
          type="button"
          onClick={jumpToLive}
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
    </div>
  );
}

// Two separate pods produce two separate logs: the app under test, and the
// k6 job itself (HTTP errors, check failures, request-level detail) - a
// combo can look fine in one and be the problem in the other, so both are
// shown together rather than making the user guess which to check.
export function PodLogView({
  name,
  folder,
  memory,
  cpu,
  live = false,
}: {
  name: string;
  folder: string;
  memory: string;
  cpu: string;
  live?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <SingleLogPanel
        name={name}
        folder={folder}
        memory={memory}
        cpu={cpu}
        kind="app"
        label={`logs do pod (app) — ${memory}/${cpu}`}
        live={live}
      />
      <SingleLogPanel
        name={name}
        folder={folder}
        memory={memory}
        cpu={cpu}
        kind="k6"
        label={`logs do k6 (requisições/checks) — ${memory}/${cpu}`}
        live={live}
      />
    </div>
  );
}
