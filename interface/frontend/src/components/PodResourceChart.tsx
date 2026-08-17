import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";

function parseMi(memory: string): number | null {
  const m = /^(\d+(?:\.\d+)?)Mi$/.exec(memory);
  return m ? Number(m[1]) : null;
}

function parseMillicores(cpu: string): number | null {
  const m = /^(\d+)m$/.exec(cpu);
  return m ? Number(m[1]) : null;
}

interface RestartMarker {
  elapsedSeconds: number;
  reason: string;
}

// Generic single-axis mini chart, reused for memory, CPU, and throughput -
// different units on wildly different scales would invent a false visual
// correlation on a shared/dual axis, so each metric gets its own chart.
function MiniChart({
  points,
  dataKey,
  unit,
  limit,
  color,
  label,
  restartMarkers,
}: {
  points: { elapsedSeconds: number }[];
  dataKey: string;
  unit: string;
  limit: number | null;
  color: string;
  label: string;
  restartMarkers: RestartMarker[];
}) {
  return (
    <div className="grid gap-1">
      <p className="font-mono text-xs text-muted-foreground">{label}</p>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="elapsedSeconds"
              type="number"
              domain={["dataMin", "dataMax"]}
              tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
              stroke="var(--muted-foreground)"
              unit="s"
            />
            <YAxis
              tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
              stroke="var(--muted-foreground)"
              unit={unit}
              width={44}
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
              formatter={(v: number) => [`${v.toFixed(1)} ${unit}`, label]}
              labelFormatter={(v: number) => `${v}s`}
            />
            {limit !== null && (
              <ReferenceLine
                y={limit}
                stroke="var(--destructive)"
                strokeDasharray="4 4"
                label={{
                  value: `limite ${limit}${unit}`,
                  fontSize: 10,
                  fill: "var(--destructive)",
                  position: "insideTopRight",
                }}
              />
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
                    value: isOom ? "OOM" : "restart",
                    fontSize: 9,
                    fill: markerColor,
                    position: "top",
                  }}
                />
              );
            })}
            <Line
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function PodResourceChart({
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
  const { data: resourceData } = useQuery({
    queryKey: ["combo-resources", name, folder, memory, cpu],
    queryFn: () => api.comboResourceSeries(name, folder, memory, cpu),
    refetchInterval: live ? 5000 : false,
  });
  const { data: throughputData } = useQuery({
    queryKey: ["combo-throughput", name, folder, memory, cpu],
    queryFn: () => api.comboThroughput(name, folder, memory, cpu),
    refetchInterval: live ? 5000 : false,
  });
  const { data: restartsData } = useQuery({
    queryKey: ["combo-restarts", name, folder, memory, cpu],
    queryFn: () => api.comboRestarts(name, folder, memory, cpu),
    refetchInterval: live ? 5000 : false,
  });

  const points = resourceData?.points ?? [];
  if (!points.length) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        sem amostras de uso de recursos ainda para {memory}/{cpu}.
      </p>
    );
  }

  // Restart events come back as absolute timestamps; align them to the same
  // elapsed-seconds axis the charts use, anchored to this combo's first
  // resource sample.
  const startMs = points[0].timestampMs;
  const restartMarkers: RestartMarker[] = (restartsData?.events ?? []).map((e) => ({
    elapsedSeconds: Math.round((e.timestampMs - startMs) / 1000),
    reason: e.reason,
  }));

  const throughputPoints = throughputData?.points ?? [];
  const latestRate = throughputPoints.length
    ? throughputPoints[throughputPoints.length - 1].requestsPerSecond
    : null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <MiniChart
        points={points}
        dataKey="memoryMi"
        unit="Mi"
        limit={parseMi(memory)}
        color="var(--chart-1)"
        label={`memória — ${memory}/${cpu}`}
        restartMarkers={restartMarkers}
      />
      <MiniChart
        points={points}
        dataKey="cpuMillicores"
        unit="m"
        limit={parseMillicores(cpu)}
        color="var(--chart-2)"
        label={`cpu — ${memory}/${cpu}`}
        restartMarkers={restartMarkers}
      />
      {!!throughputPoints.length && (
        <div className="sm:col-span-2">
          <MiniChart
            points={throughputPoints}
            dataKey="requestsPerSecond"
            unit="/s"
            limit={null}
            color="var(--chart-3)"
            label={`chamadas bem-sucedidas/s${latestRate !== null ? ` — agora: ${latestRate.toFixed(1)}/s` : ""}`}
            restartMarkers={restartMarkers}
          />
        </div>
      )}
    </div>
  );
}
