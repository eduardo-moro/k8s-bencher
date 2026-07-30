.PHONY: help cluster run teardown all full

help:
	@echo "k8s-perftest - thin make wrapper around perftest.ps1 (primary interface is PowerShell)"
	@echo ""
	@echo "  make cluster              - create the kind cluster"
	@echo "  make run CONFIG=path.yaml - deploy + run the resource matrix for a config"
	@echo "  make teardown             - delete the kind cluster"
	@echo "  make all CONFIG=path.yaml - cluster + run, cluster left running"
	@echo "  make full CONFIG=path.yaml - cluster + run + teardown"

cluster:
	pwsh -File perftest.ps1 -Cluster

run:
	@if [ -z "$(CONFIG)" ]; then echo "Usage: make run CONFIG=path.yaml" >&2; exit 1; fi
	pwsh -File perftest.ps1 -Run -Config "$(CONFIG)"

teardown:
	pwsh -File perftest.ps1 -Teardown

all:
	@if [ -z "$(CONFIG)" ]; then echo "Usage: make all CONFIG=path.yaml" >&2; exit 1; fi
	pwsh -File perftest.ps1 -All -Config "$(CONFIG)"

full:
	@if [ -z "$(CONFIG)" ]; then echo "Usage: make full CONFIG=path.yaml" >&2; exit 1; fi
	pwsh -File perftest.ps1 -Full -Config "$(CONFIG)"
