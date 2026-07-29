#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if kind get clusters 2>/dev/null | grep -qx outline-perftest; then
  echo "Cluster 'outline-perftest' already exists, skipping creation (assuming metrics-server is already set up from a prior run)."
  kubectl config use-context kind-outline-perftest
  echo "Cluster ready. Context: kind-outline-perftest"
  kubectl cluster-info --context kind-outline-perftest
  exit 0
fi

kind create cluster --config kind-config.yaml

echo "Waiting for cluster to stabilize (30 seconds)..."
sleep 30

echo "Installing metrics-server..."
kubectl apply --validate=false -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# kind nodes use self-signed kubelet certs; metrics-server needs this flag
# to scrape them, or it never reports pod metrics (kubectl top stays empty).
kubectl patch deployment metrics-server -n kube-system --type='json' \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'

echo "Waiting for metrics-server rollout..."
kubectl -n kube-system rollout status deployment/metrics-server --timeout=120s

echo "Cluster ready. Context: kind-outline-perftest"
kubectl cluster-info --context kind-outline-perftest
