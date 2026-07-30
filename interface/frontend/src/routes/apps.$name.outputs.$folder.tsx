import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, TriangleAlert } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, type ResultRow } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/apps/$name/outputs/$folder")({
  head: () => ({
    meta: [
      { title: "Run results — perftest console" },
      {
        name: "description",
        content:
          "p95/p99 latency, error rate and OOM findings for every CPU/memory tier in a sweep.",
      },
      { property: "og:title", content: "Run results — perftest console" },
      {
        property: "og:description",
        content: "Latency and OOM results per resource tier from a k6 sweep.",
      },
    ],
  }),
  component: ResultsPage,
});

const num = (v: number | null, digits = 0) =>
  v === null || v === undefined ? "—" : v.toFixed(digits);

function broke(r: ResultRow) {
  return r.oom_killed || r.p95_ms === null || r.p99_ms === null || r.error_rate === null;
}

function ResultsPage() {
  const { name, folder } = Route.useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["output", name, folder],
    queryFn: () => api.outputRows(name, folder),
  });

  const rows = data?.rows ?? [];
  const chartData = rows
    .filter((r) => r.p95_ms !== null && !r.oom_killed)
    .map((r) => ({ tier: `${r.cpu}/${r.memory}`, p95: r.p95_ms as number }));
  const best = chartData.length
    ? chartData.reduce((a, b) => (b.p95 < a.p95 ? b : a))
    : undefined;

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
        <Button variant="outline" asChild>
          <a href={api.rawCsvUrl(name, folder)} download>
            <Download className="size-4" /> Download raw CSV
          </a>
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {(error as Error).message}
        </div>
      )}
      {isLoading && <p className="font-mono text-sm text-muted-foreground">loading results…</p>}

      {!!chartData.length && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-sm">p95 latency by tier (cpu/memory)</CardTitle>
            {best && (
              <p className="text-xs text-muted-foreground">
                Sweet spot:{" "}
                <span className="font-mono text-success">
                  {best.tier} @ {best.p95.toFixed(0)}ms
                </span>
              </p>
            )}
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="tier"
                  tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }}
                  stroke="var(--muted-foreground)"
                />
                <YAxis
                  tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }}
                  stroke="var(--muted-foreground)"
                  unit="ms"
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
                  formatter={(v: number) => [`${v.toFixed(0)} ms`, "p95"]}
                />
                <Bar dataKey="p95" radius={[4, 4, 0, 0]}>
                  {chartData.map((d) => (
                    <Cell
                      key={d.tier}
                      fill={d.tier === best?.tier ? "var(--success)" : "var(--running)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {!isLoading && rows.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          This run produced no result rows.
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 font-mono text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
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
                  <th key={h} className="px-3 py-2 text-left whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {rows.map((r, i) => {
                const bad = broke(r);
                return (
                  <tr
                    key={`${r.memory}-${r.cpu}-${i}`}
                    className={cn(
                      "border-t border-border",
                      bad ? "bg-destructive/10 text-destructive" : "hover:bg-muted/40",
                    )}
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.memory}
                      {bad && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] uppercase">
                          <TriangleAlert className="size-3" /> this tier broke the app
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
                    <td className="px-3 py-2">{r.oom_killed ? "OOMKilled" : "no"}</td>
                    <td className="px-3 py-2">{r.restart_count}</td>
                    <td className="px-3 py-2">{num(r.duration_seconds, 1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
