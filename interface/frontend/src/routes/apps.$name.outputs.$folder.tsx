import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { ArrowLeft, Download, FileText, Gauge, TriangleAlert } from "lucide-react";
import {
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PodLogView } from "@/components/PodLogView";
import { api, type MemorySeries, type ResultRow } from "@/lib/api";
import { cn } from "@/lib/utils";

// The design system's fixed categorical ramp only has 5 hues; a resource
// sweep commonly has more tiers than that (e.g. 4 memory x 3 cpu = 12), so
// past 5 series we add a dash pattern per lap around the ramp. Identity
// still never rests on hue alone: the legend and tooltip always show the
// tier text too.
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];
const DASH_PATTERNS = [undefined, "6 3", "2 3"];

// Recharts' shared Tooltip resolves a hovered Line's value by array *index*
// into that Line's own `data` prop, not by matching elapsedSeconds (see
// getTooltipContent in recharts/chart/generateCategoricalChart.js — it only
// matches by value when the axis has allowDuplicatedCategory=false, which
// isn't set here). Each tier is sampled independently — different combos run
// for different durations, and failed `kubectl top` samples are dropped — so
// per-tier point arrays have different lengths. Passing each tier its own
// `data` array meant hovering showed every line's value at the same array
// index, which for a short tier is a completely different point in time than
// for the run's longest tier (hence "smallest tier shows the biggest tier's
// number"). Merging into one shared row per elapsedSeconds bucket, passed as
// the chart's top-level `data`, makes the lookup unambiguous: every Line
// reads from the exact same row the cursor is hovering.
// Matches the sampler's default sampleIntervalSeconds (modules/Perftest.psm1,
// Get-PerftestConfig) - a bucket coarser than the actual sample cadence would
// silently downsample the chart (two real samples landing in the same
// bucket), a bucket finer than it buys nothing since there's at most one
// sample per real interval anyway.
const MEMORY_SAMPLE_BUCKET_SECONDS = 1;

function mergeSeriesByBucket<P extends { elapsedSeconds: number }>(
  series: { tier: string; points: P[] }[],
  valueOf: (point: P) => number | null | undefined,
) {
  const rows = new Map<number, Record<string, number>>();
  for (const s of series) {
    for (const p of s.points) {
      const value = valueOf(p);
      if (value === null || value === undefined) continue;
      const bucket = Math.round(p.elapsedSeconds / MEMORY_SAMPLE_BUCKET_SECONDS) * MEMORY_SAMPLE_BUCKET_SECONDS;
      const row = rows.get(bucket) ?? { elapsedSeconds: bucket };
      row[s.tier] = value;
      rows.set(bucket, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.elapsedSeconds - b.elapsedSeconds);
}

interface RestartMarker {
  tier: string;
  elapsedSeconds: number;
  reason: string;
}

function seriesStyle(index: number) {
  return {
    stroke: CHART_COLORS[index % CHART_COLORS.length],
    strokeDasharray: DASH_PATTERNS[Math.floor(index / CHART_COLORS.length) % DASH_PATTERNS.length],
  };
}

// Clickable legend: toggling visibility never reassigns color (each tier
// keeps the index-derived hue/dash from seriesStyle regardless of which
// others are hidden), so a tier's identity stays stable as you isolate
// runs — only the Line's presence in the chart changes.
function TierToggleLegend({
  series,
  hidden,
  onToggle,
  onShowAll,
  onHideAll,
}: {
  series: MemorySeries[];
  hidden: Set<string>;
  onToggle: (tier: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
      <button
        type="button"
        onClick={onShowAll}
        className="rounded px-1.5 py-0.5 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        mostrar todos
      </button>
      <button
        type="button"
        onClick={onHideAll}
        className="rounded px-1.5 py-0.5 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        ocultar todos
      </button>
      <span className="mx-1 text-border">|</span>
      {series.map((s, i) => {
        const isHidden = hidden.has(s.tier);
        const { stroke } = seriesStyle(i);
        return (
          <button
            key={s.tier}
            type="button"
            onClick={() => onToggle(s.tier)}
            aria-pressed={!isHidden}
            title={isHidden ? `mostrar ${s.tier}` : `ocultar ${s.tier}`}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 transition-colors",
              isHidden
                ? "border-border text-muted-foreground/60"
                : "border-border text-foreground hover:bg-muted",
            )}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: isHidden ? "var(--muted-foreground)" : stroke, opacity: isHidden ? 0.4 : 1 }}
            />
            {s.tier}
          </button>
        );
      })}
    </div>
  );
}

// Memory and CPU are different units on different scales, so they're two
// charts (each single-axis) sharing the same tier toggle state, rather than
// one chart with a second Y-axis that would invent a false visual
// correlation between them.
function TierLineChart({
  series,
  chartData,
  hiddenTiers,
  unit,
  restartMarkers,
}: {
  series: MemorySeries[];
  chartData: Record<string, number>[];
  hiddenTiers: Set<string>;
  unit: string;
  restartMarkers: RestartMarker[];
}) {
  return (
    <div className="h-96">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="elapsedSeconds"
            type="number"
            domain={["dataMin", "dataMax"]}
            tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }}
            stroke="var(--muted-foreground)"
            unit="s"
          />
          <YAxis
            tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }}
            stroke="var(--muted-foreground)"
            unit={unit}
          />
          <Tooltip
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--popover-foreground)",
            }}
            labelFormatter={(v: number) => `${v}s`}
            formatter={(v: number, tier: string) => [`${v.toFixed(0)} ${unit}`, tier]}
          />
          {series.map((s, i) =>
            hiddenTiers.has(s.tier) ? null : (
              <Line
                key={s.tier}
                dataKey={s.tier}
                name={s.tier}
                dot={false}
                strokeWidth={2}
                isAnimationActive={false}
                connectNulls
                {...seriesStyle(i)}
              />
            ),
          )}
          {restartMarkers.map((m, i) => {
            const isOom = m.reason === "OOMKilled";
            const markerColor = isOom ? "var(--destructive)" : "var(--chart-4)";
            return (
              <ReferenceLine
                key={i}
                x={m.elapsedSeconds}
                stroke={markerColor}
                strokeDasharray="2 2"
                label={{
                  value: `${m.tier} ${isOom ? "OOM" : "restart"}`,
                  fontSize: 9,
                  fill: markerColor,
                  position: "top",
                }}
              />
            );
          })}
          <Brush
            dataKey="elapsedSeconds"
            height={24}
            stroke="var(--chart-1)"
            fill="var(--muted)"
            travellerWidth={8}
            tickFormatter={(v: number) => `${v}s`}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export const Route = createFileRoute("/apps/$name/outputs/$folder")({
  head: () => ({
    meta: [
      { title: "Resultados da execução — console perftest" },
      {
        name: "description",
        content:
          "Latência p95/p99, taxa de erro, uso de RAM e CPU ao longo do tempo e ocorrências de OOM para cada nível de CPU/memória de uma varredura.",
      },
      { property: "og:title", content: "Resultados da execução — console perftest" },
      {
        property: "og:description",
        content: "Resultados de latência, uso de RAM e OOM por nível de recursos de uma varredura k6.",
      },
    ],
  }),
  component: ResultsPage,
});

const num = (v: number | null, digits = 0) =>
  v === null || v === undefined ? "—" : v.toFixed(digits);

// Stable reference so `memorySeries` doesn't change identity every render
// when there's no data yet — `?? []` would otherwise create a fresh array
// each time and defeat the useMemo below.
const EMPTY_MEMORY_SERIES: MemorySeries[] = [];

function broke(r: ResultRow) {
  return r.oom_killed || r.restart_count > 0 || r.p95_ms === null || r.p99_ms === null || r.error_rate === null;
}

// Kubernetes only sets reason=OOMKilled for a genuine out-of-memory kill;
// any other restart (surfaced here as restart_count > 0 without oom_killed)
// is typically a livenessProbe timeout - at low CPU tiers, that's usually
// the app too throttled to answer the probe in time, not a real crash.
function crashCause(r: ResultRow): string | null {
  if (r.oom_killed) return "OOMKilled";
  if (r.restart_count > 0) return "CPU (provável)";
  return null;
}

function ResultsPage() {
  const { name, folder } = Route.useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["output", name, folder],
    queryFn: () => api.outputRows(name, folder),
  });
  const { data: memoryData } = useQuery({
    queryKey: ["output-memory", name, folder],
    queryFn: () => api.outputMemory(name, folder),
  });
  // Hidden (not selected) tiers, not the other way round: an empty set means
  // "show everything", so newly-loaded series appear visible by default
  // without needing to wait on memorySeries to seed a "select all" state.
  const [hiddenTiers, setHiddenTiers] = useState<Set<string>>(new Set());
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);

  const rows = data?.rows ?? [];
  const memorySeries = memoryData?.series ?? EMPTY_MEMORY_SERIES;
  const memoryChartData = useMemo(() => mergeSeriesByBucket(memorySeries, (p) => p.memoryMi), [memorySeries]);
  const cpuChartData = useMemo(() => mergeSeriesByBucket(memorySeries, (p) => p.cpuMillicores), [memorySeries]);

  // One request per tier - throughput isn't part of /memory since it comes
  // from a different pod's log (k6, not the app), so it can't ride along
  // with the memory/CPU series fetch.
  const tierKey = memorySeries.map((s) => s.tier).join(",");
  const { data: throughputSeries } = useQuery({
    queryKey: ["output-throughput", name, folder, tierKey],
    queryFn: () =>
      Promise.all(
        memorySeries.map(async (s) => ({
          tier: s.tier,
          points: (await api.comboThroughput(name, folder, s.memory, s.cpu)).points,
        })),
      ),
    enabled: memorySeries.length > 0,
  });
  const throughputChartData = useMemo(
    () => mergeSeriesByBucket(throughputSeries ?? [], (p) => p.requestsPerSecond),
    [throughputSeries],
  );

  // Restart events come back as absolute timestamps; each tier's own first
  // resource sample anchors them to the same elapsedSeconds axis the charts
  // use for that tier (mirrors PodResourceChart's live-view anchoring).
  const { data: restartsByTier } = useQuery({
    queryKey: ["output-restarts", name, folder, tierKey],
    queryFn: () =>
      Promise.all(
        memorySeries.map(async (s) => ({
          tier: s.tier,
          startMs: s.points[0].timestampMs,
          events: (await api.comboRestarts(name, folder, s.memory, s.cpu)).events,
        })),
      ),
    enabled: memorySeries.length > 0,
  });
  const restartMarkers = useMemo(
    () =>
      (restartsByTier ?? [])
        .filter((s) => !hiddenTiers.has(s.tier))
        .flatMap((s) =>
          s.events.map((e) => ({
            tier: s.tier,
            elapsedSeconds: Math.round((e.timestampMs - s.startMs) / 1000),
            reason: e.reason,
          })),
        ),
    [restartsByTier, hiddenTiers],
  );

  function toggleTier(tier: string) {
    setHiddenTiers((prev) => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      return next;
    });
  }
  const showAllTiers = () => setHiddenTiers(new Set());
  const hideAllTiers = () => setHiddenTiers(new Set(memorySeries.map((s) => s.tier)));

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            to="/apps/$name"
            params={{ name }}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> {name}
          </Link>
          <h1 className="font-mono text-xl font-semibold tracking-tight">{folder}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <a href={api.rawCsvUrl(name, folder)} download>
              <Download className="size-4" /> Baixar CSV bruto
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href={api.prometheusUrl(name, folder)} download={`${folder}.prom`}>
              <Gauge className="size-4" /> Exportar para Prometheus
            </a>
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {(error as Error).message}
        </div>
      )}
      {isLoading && <p className="font-mono text-sm text-muted-foreground">carregando resultados…</p>}

      {!!memorySeries.length && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-sm">uso de recursos ao longo do tempo, por nível (memória/cpu)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <TierToggleLegend
              series={memorySeries}
              hidden={hiddenTiers}
              onToggle={toggleTier}
              onShowAll={showAllTiers}
              onHideAll={hideAllTiers}
            />
            <div>
              <p className="mb-1 font-mono text-xs uppercase text-muted-foreground">memória</p>
              <TierLineChart
                series={memorySeries}
                chartData={memoryChartData}
                hiddenTiers={hiddenTiers}
                unit="Mi"
                restartMarkers={restartMarkers}
              />
            </div>
            <div>
              <p className="mb-1 font-mono text-xs uppercase text-muted-foreground">cpu</p>
              <TierLineChart
                series={memorySeries}
                chartData={cpuChartData}
                hiddenTiers={hiddenTiers}
                unit="m"
                restartMarkers={restartMarkers}
              />
            </div>
            {!!throughputChartData.length && (
              <div>
                <p className="mb-1 font-mono text-xs uppercase text-muted-foreground">chamadas bem-sucedidas/s</p>
                <TierLineChart
                  series={memorySeries}
                  chartData={throughputChartData}
                  hiddenTiers={hiddenTiers}
                  unit="/s"
                  restartMarkers={restartMarkers}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!isLoading && rows.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Esta execução não produziu linhas de resultado.
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 font-mono text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {[
                  "memória",
                  "cpu",
                  "p95 ms",
                  "p99 ms",
                  "taxa de erro",
                  "reqs http",
                  "causa da falha",
                  "reinícios",
                  "duração s",
                  "logs",
                ].map((h) => (
                  <th key={h} className="px-3 py-2 text-left whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {rows.map((r, i) => {
                const bad = broke(r);
                const rowKey = `${r.memory}-${r.cpu}-${i}`;
                const expanded = expandedRowKey === rowKey;
                return (
                  <Fragment key={rowKey}>
                    <tr
                      className={cn(
                        "border-t border-border",
                        bad ? "bg-destructive/10 text-destructive" : "hover:bg-muted/40",
                      )}
                    >
                      <td className="px-3 py-2 whitespace-nowrap">
                        {r.memory}
                        {bad && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] uppercase">
                            <TriangleAlert className="size-3" /> este nível quebrou o app
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">{r.cpu}</td>
                      <td className="px-3 py-2">{num(r.p95_ms)}</td>
                      <td className="px-3 py-2">{num(r.p99_ms)}</td>
                      <td className="px-3 py-2">
                        {r.error_rate === null ? "—" : `${(r.error_rate * 100).toFixed(2)}%`}
                      </td>
                      <td className="px-3 py-2">
                        {r.http_reqs_total === null ? "—" : r.http_reqs_total.toLocaleString()}
                      </td>
                      <td className="px-3 py-2">{crashCause(r) ?? "—"}</td>
                      <td className="px-3 py-2">{r.restart_count}</td>
                      <td className="px-3 py-2">{num(r.duration_seconds, 1)}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setExpandedRowKey(expanded ? null : rowKey)}
                          aria-pressed={expanded}
                          title={expanded ? "ocultar logs do pod" : "ver logs do pod"}
                          className={cn(
                            "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] uppercase transition-colors",
                            expanded
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:bg-muted",
                          )}
                        >
                          <FileText className="size-3" /> logs
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-t border-border bg-muted/20">
                        <td colSpan={9} className="p-3">
                          <PodLogView name={name} folder={folder} memory={r.memory} cpu={r.cpu} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
