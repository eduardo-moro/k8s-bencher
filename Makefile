CONFIG ?= configs/example.yaml

GREEN  := \033[0;32m
RED    := \033[0;31m
CYAN   := \033[0;36m
YELLOW := \033[0;33m
RESET  := \033[0m

.PHONY: help check cluster run teardown all full demo-setup

help:
	@printf "$(CYAN)k8s-perftest$(RESET) - wrapper simples do make em torno do perftest.ps1 (a interface principal e o PowerShell)\n"
	@printf "\n"
	@printf "  make check                  - verifica se kind/kubectl/k6/docker/powershell-yaml estao instalados e prontos\n"
	@printf "  make cluster                - cria o cluster kind\n"
	@printf "  make run CONFIG=caminho.yaml  - faz o deploy + roda a matriz de recursos para uma config\n"
	@printf "  make teardown               - remove o cluster kind\n"
	@printf "  make all CONFIG=caminho.yaml  - cluster + run, cluster permanece de pe\n"
	@printf "  make full CONFIG=caminho.yaml - cluster + run + teardown\n"
	@printf "\n"
	@printf "$(YELLOW)Rode run/all/full sem CONFIG e ele demonstra o exemplo httpbin ja incluso\n"
	@printf "(copiado de templates/ para manifests/loadtest/configs/ no primeiro uso).$(RESET)\n"

check:
	@command -v pwsh >/dev/null 2>&1 || { printf "[$(RED) FAIL $(RESET)] pwsh ($(CYAN)PowerShell 7+$(RESET)) nao encontrado no PATH - instale: $(CYAN)https://github.com/PowerShell/PowerShell$(RESET)\n"; exit 1; }
	@printf "[$(GREEN)  OK  $(RESET)]   pwsh\n"
	pwsh -File perftest.ps1 -Check

cluster:
	pwsh -File perftest.ps1 -Cluster

# manifests/, loadtest/, and configs/ are gitignored (per-app, local-only - see
# the design doc) - a fresh clone has none of it. If the caller didn't point
# CONFIG at their own app, bootstrap the bundled httpbin example from
# templates/ so run/all/full have something real to execute out of the box.
demo-setup:
	@if [ "$(CONFIG)" = "configs/example.yaml" ] && [ ! -f configs/example.yaml ]; then \
		printf "$(YELLOW)Nenhum CONFIG informado - preparando o exemplo httpbin a partir de templates/ ...$(RESET)\n"; \
		mkdir -p manifests loadtest configs; \
		cp templates/manifest.example.yaml manifests/httpbin.yaml; \
		cp templates/loadtest.example.js loadtest/httpbin.js; \
		cp templates/config.example.yaml configs/example.yaml; \
	fi

run: demo-setup
	@if [ -z "$(CONFIG)" ]; then printf "$(RED)Uso: make run CONFIG=caminho.yaml$(RESET)\n" >&2; exit 1; fi
	pwsh -File perftest.ps1 -Run -Config "$(CONFIG)"

teardown:
	pwsh -File perftest.ps1 -Teardown

all: demo-setup
	@if [ -z "$(CONFIG)" ]; then printf "$(RED)Uso: make all CONFIG=caminho.yaml$(RESET)\n" >&2; exit 1; fi
	pwsh -File perftest.ps1 -All -Config "$(CONFIG)"

full: demo-setup
	@if [ -z "$(CONFIG)" ]; then printf "$(RED)Uso: make full CONFIG=caminho.yaml$(RESET)\n" >&2; exit 1; fi
	pwsh -File perftest.ps1 -Full -Config "$(CONFIG)"
