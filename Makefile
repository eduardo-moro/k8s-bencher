CONFIG ?= configs/example.yaml

GREEN  := \033[0;32m
RED    := \033[0;31m
CYAN   := \033[0;36m
YELLOW := \033[0;33m
GRAY   := \033[0;37m
RESET  := \033[0m

.PHONY: help check cluster run teardown all full demo-setup

help:
	@printf "\n\t$(CYAN)k8s-perftest$(RESET) -- Ferramenta de perfilamento de recursos para aplicacoes em kubernetes"
	@printf "\n\n"
	@printf "\tmake $(CYAN)check$(RESET) ...................... verifica se kind/kubectl/k6/docker/powershell-yaml estao instalados e prontos\n"
	@printf "\tmake $(CYAN)cluster$(RESET) .................... cria o cluster kind\n"
	@printf "\tmake $(CYAN)teardown$(RESET) ................... remove o cluster kind\n"
	@printf "\tmake $(CYAN)run CONFIG=caminho.yaml$(RESET) .... faz o deploy + roda a matriz de recursos para uma config\n"
	@printf "\tmake $(CYAN)all CONFIG=caminho.yaml$(RESET) .... cluster + run, cluster permanece ativo\n"
	@printf "\tmake $(CYAN)full CONFIG=caminho.yaml$(RESET) ... cluster + run + teardown\n"
	@printf "\n"
	@printf "$(GRAY)\t// Rode $(CYAN)run/all/full$(GRAY) sem CONFIG e ele demonstra o exemplo httpbin ja incluso\n"
	@printf "\t(copiado de $(CYAN)templates/$(GRAY) para $(CYAN)manifests/$(GRAY), $(CYAN)loadtest/$(GRAY) e $(CYAN)configs/$(RESET) no primeiro uso).$(RESET)\n"

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
