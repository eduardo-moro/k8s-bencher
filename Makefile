# Run this from inside the "archlinux" WSL distro (kind/kubectl/k6/jq/docker
# live there, and Docker Desktop's WSL integration is enabled for it):
#
#   wsl -d archlinux
#   cd /mnt/c/Users/e.moro/source/outline-k8s-perftest
#   make setup
#
# Not meant to be run from a native Windows shell (PowerShell/cmd) — Windows'
# own GNU Make has no reliable way to hand recipes to a different OS's shell.

SHELL := /bin/bash

.PHONY: help cluster deploy seed k6-config setup test test-one report teardown all full clean-results

help:
	@echo "outline-k8s-perftest - one-command test pipeline (run from Arch WSL)"
	@echo ""
	@echo "  make setup       - create kind cluster, deploy Postgres/Redis/Outline, restore real data"
	@echo "  make test        - run the full 12-combination memory x CPU matrix (setup must have run first)"
	@echo "  make test-one MEM=384Mi CPU=250m - run a single combination (setup must have run first)"
	@echo "  make all         - setup + test, cluster left running afterward for inspection"
	@echo "  make full        - setup + test + teardown, fully hands-off end to end"
	@echo "  make teardown    - delete the kind cluster"
	@echo "  make clean-results - remove tmp-out/ scratch files (keeps results/*.csv)"
	@echo ""
	@echo "Results land in results/matrix-results-<date>.csv (one file per day run)."

cluster:
	bash create-cluster.sh

deploy: cluster
	kubectl apply -f manifests/redis.yaml
	kubectl apply -f manifests/postgres.yaml
	bash generate-secret.sh
	kubectl apply -f manifests/outline-secret.yaml
	kubectl apply -f manifests/outline.yaml
	kubectl rollout status deployment/postgres --timeout=60s
	kubectl rollout status deployment/outline --timeout=120s

seed: deploy
	bash seed-db.sh

k6-config: deploy
	kubectl create configmap k6-script --from-file=outline-load.js=loadtest/outline-load.js --dry-run=client -o yaml | kubectl apply -f -

setup: seed k6-config
	@echo "Setup complete. Cluster is up, Outline is healthy, and real data is restored."

test: setup
	bash run-matrix.sh

test-one: setup
	@if [ -z "$(MEM)" ] || [ -z "$(CPU)" ]; then \
		echo "Usage: make test-one MEM=384Mi CPU=250m" >&2; \
		exit 1; \
	fi
	bash run-matrix.sh $(MEM) $(CPU)

teardown:
	bash teardown.sh

all: test
	@echo "Done. Cluster left running for inspection - run 'make teardown' when finished."

full: test teardown
	@echo "Done. Cluster torn down."

clean-results:
	rm -rf tmp-out/*
