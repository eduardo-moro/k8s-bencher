#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export MSYS_NO_PATHCONV=1

RESULTS_FILE="results/matrix-results-$(date +%Y-%m-%d).csv"
mkdir -p results tmp-out

if [ ! -f "$RESULTS_FILE" ]; then
  echo "memory,cpu,start_time,end_time,duration_seconds,p95_ms,p99_ms,error_rate,http_reqs_total,content_fetch_p95_ms,content_fetch_error_rate,search_p95_ms,search_error_rate,oom_killed,restart_count" > "$RESULTS_FILE"
fi

run_k6_job() {
  local k6_out="$1"

  kubectl delete job k6-loadtest --ignore-not-found >/dev/null
  cat <<'EOF' | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: k6-loadtest
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: k6
          image: grafana/k6:latest
          command:
            - sh
            - -c
            - "k6 run --vus=15 --duration=2m --summary-trend-stats='avg,min,med,max,p(90),p(95),p(99)' --summary-export=/results/summary.json /scripts/outline-load.js; ec=$?; touch /results/done; sleep 20; exit $ec"
          env:
            - name: OUTLINE_URL
              value: "http://outline:3000"
            - name: OUTLINE_API_TOKEN
              valueFrom:
                secretKeyRef:
                  name: outline-env
                  key: OUTLINE_API_TOKEN
          volumeMounts:
            - name: script
              mountPath: /scripts
            - name: results
              mountPath: /results
      volumes:
        - name: script
          configMap:
            name: k6-script
        - name: results
          emptyDir: {}
EOF

  local k6_pod
  # Poll until the pod exists and is running (k6 needs a few seconds to be scheduled/started).
  local waited=0
  k6_pod=""
  while [ -z "$k6_pod" ] && [ "$waited" -lt 30 ]; do
    k6_pod=$(kubectl get pods -l job-name=k6-loadtest -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    [ -z "$k6_pod" ] && sleep 2 && waited=$((waited + 2))
  done
  [ -n "$k6_pod" ] || { echo "k6 pod never appeared" >&2; return 1; }

  # k6's own run takes ~2m30s (20s ramp-up + 120s steady + 10s ramp-down, plus
  # scheduling/pull time); poll for the /results/done sentinel rather than
  # kubectl wait --for=condition=complete, which would race the trailing sleep.
  waited=0
  until kubectl exec "$k6_pod" -- test -f /results/done 2>/dev/null; do
    sleep 5
    waited=$((waited + 5))
    if [ "$waited" -ge 240 ]; then
      echo "Timed out waiting for k6 job to finish (mem/cpu combo may be too resource-starved to even run k6's own client fairly, or Outline itself is unresponsive)" >&2
      break
    fi
  done

  kubectl cp "${k6_pod}:/results/summary.json" "$k6_out"
}

run_one() {
  local mem="$1"
  local cpu="$2"
  local start_epoch start_iso
  start_epoch=$(date +%s)
  start_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  echo "=== Testing memory=$mem cpu=$cpu (start: $start_iso) ==="
  kubectl set resources deployment/outline -c outline \
    --limits="cpu=${cpu},memory=${mem}" \
    --requests="cpu=${cpu},memory=${mem}"
  kubectl rollout status deployment/outline --timeout=120s
  sleep 5

  local pod
  # Filter to Running pods only: immediately after a rollout, the API server
  # can briefly still list the old (Terminating) pod alongside the new one
  # under the same `app=outline` label, and an unfiltered items[0] lookup can
  # nondeterministically pick the pod that's about to be deleted -- causing a
  # "not found" error later when this pod's restart count is queried.
  pod=$(kubectl get pod -l app=outline --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}')

  local top_log="tmp-out/top-${mem}-${cpu}.log"
  : > "$top_log"
  ( while true; do kubectl top pod "$pod" --no-headers >> "$top_log" 2>&1 || true; sleep 10; done ) &
  local sampler_pid=$!

  local k6_out="tmp-out/k6-${mem}-${cpu}.json"
  run_k6_job "$k6_out"

  kill "$sampler_pid" 2>/dev/null || true
  wait "$sampler_pid" 2>/dev/null || true

  local restart_count
  restart_count=$(kubectl get pod "$pod" -o jsonpath='{.status.containerStatuses[0].restartCount}')
  local last_reason
  last_reason=$(kubectl get pod "$pod" -o jsonpath='{.status.containerStatuses[0].lastState.terminated.reason}' 2>/dev/null || echo "")
  local oom_flag="no"
  [ "$last_reason" = "OOMKilled" ] && oom_flag="yes"

  local p95 p99 err_rate http_reqs_total content_p95 content_err search_p95 search_err
  p95=$(jq '.metrics.http_req_duration["p(95)"]' "$k6_out")
  p99=$(jq '.metrics.http_req_duration["p(99)"]' "$k6_out")
  err_rate=$(jq '.metrics.http_req_failed.value' "$k6_out")
  http_reqs_total=$(jq '.metrics.http_reqs.count // "NA"' "$k6_out")
  content_p95=$(jq '.metrics.content_fetch_duration["p(95)"] // "NA"' "$k6_out")
  content_err=$(jq '.metrics.content_fetch_errors.value // "NA"' "$k6_out")
  search_p95=$(jq '.metrics.search_duration["p(95)"] // "NA"' "$k6_out")
  search_err=$(jq '.metrics.search_errors.value // "NA"' "$k6_out")

  local end_epoch end_iso duration_seconds
  end_epoch=$(date +%s)
  end_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  duration_seconds=$((end_epoch - start_epoch))

  echo "${mem},${cpu},${start_iso},${end_iso},${duration_seconds},${p95},${p99},${err_rate},${http_reqs_total},${content_p95},${content_err},${search_p95},${search_err},${oom_flag},${restart_count}" >> "$RESULTS_FILE"
  echo "--- result: mem=$mem cpu=$cpu duration=${duration_seconds}s p95=${p95}ms err_rate=${err_rate} http_reqs=${http_reqs_total} content_p95=${content_p95}ms search_p95=${search_p95}ms oom=${oom_flag} restarts=${restart_count} ---"
}

if [ "$#" -eq 2 ]; then
  # Single-combination mode, e.g. ./run-matrix.sh 768Mi 1000m — used for smoke-testing.
  run_one "$1" "$2"
  exit 0
fi

MEMORY_VALUES=(256Mi 384Mi 512Mi 768Mi)
CPU_VALUES=(250m 500m 1000m)

for mem in "${MEMORY_VALUES[@]}"; do
  for cpu in "${CPU_VALUES[@]}"; do
    if ! run_one "$mem" "$cpu"; then
      echo "!!! combination mem=$mem cpu=$cpu FAILED, continuing to next !!!" >&2
      echo "${mem},${cpu},FAILED,FAILED,FAILED,FAILED,FAILED,FAILED,FAILED,FAILED,FAILED,FAILED,FAILED,FAILED,FAILED" >> "$RESULTS_FILE"
    fi
  done
done

echo "Matrix complete. Results in $RESULTS_FILE"
