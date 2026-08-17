CONFIG ?= configs/example.yaml

# Every recipe below is POSIX shell syntax (`if [ ]`, `&&`, `trap`, subshells...).
# On native Windows, GNU Make falls back to cmd.exe when it can't find a real
# `sh` on PATH - cmd.exe can't parse any of that, producing cryptic errors
# like "'{' nao e reconhecido..." or "O sistema nao pode encontrar o caminho
# especificado" (from `>/dev/null`). Git for Windows ships a real sh.exe, but
# its installer only adds `Git\cmd` (the git.exe wrappers) to PATH, not
# `Git\bin`/`Git\usr\bin` (the actual POSIX toolchain) - so make can't find it
# via PATH alone even though it's sitting right there on disk. Pin SHELL to
# it directly so `make` works the same from a plain Windows cmd/PowerShell
# prompt as it does from WSL or Git Bash. No-op on WSL/Linux/macOS ($(OS)
# isn't Windows_NT there) and a no-op if Git for Windows isn't installed at
# one of these default locations (falls through to make's normal behavior).
ifeq ($(OS),Windows_NT)
  GIT_SH := $(firstword $(wildcard C:/Program Files/Git/bin/sh.exe) $(wildcard C:/Program Files/Git/usr/bin/sh.exe))
  ifneq ($(strip $(GIT_SH)),)
    SHELL := $(GIT_SH)
    .SHELLFLAGS := -c
  endif
endif

GREEN  := \033[0;32m
RED    := \033[0;31m
CYAN   := \033[0;36m
YELLOW := \033[0;33m
GRAY   := \033[0;37m
RESET  := \033[0m

.PHONY: help check cluster run teardown all full demo-setup interface electron-installer

help:
	@printf "\n\t$(CYAN)k8s-perftest$(RESET) -- Ferramenta de perfilamento de recursos para aplicacoes em kubernetes"
	@printf "\n\n"
	@printf "\tmake $(CYAN)check$(RESET) ...................... verifica se kind/kubectl/k6/docker/powershell-yaml estao instalados e prontos\n"
	@printf "\tmake $(CYAN)cluster$(RESET) .................... cria o cluster kind\n"
	@printf "\tmake $(CYAN)teardown$(RESET) ................... remove o cluster kind\n"
	@printf "\tmake $(CYAN)run CONFIG=caminho.yaml$(RESET) .... faz o deploy + roda a matriz de recursos para uma config\n"
	@printf "\tmake $(CYAN)all CONFIG=caminho.yaml$(RESET) .... cluster + run, cluster permanece ativo\n"
	@printf "\tmake $(CYAN)full CONFIG=caminho.yaml$(RESET) ... cluster + run + teardown\n"
	@printf "\tmake $(CYAN)interface$(RESET) ................. sobe a API (porta 8026) e o frontend (porta escolhida pelo Vite) juntos\n"
	@printf "\tmake $(CYAN)electron-installer$(RESET) ......... gera o instalador .exe do desktop app (Electron)\n"
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

# interface/API and interface/frontend are separate npm projects (node_modules
# gitignored) - install on first run, then start both dev servers together.
# `trap 'kill 0'` kills the whole process group (both servers) on Ctrl+C, so
# one `make interface` + one Ctrl+C is enough to stop both.
interface:
	@if [ ! -d interface/API/node_modules ]; then \
		printf "$(YELLOW)Instalando dependencias da API...$(RESET)\n"; \
		(cd interface/API && npm install); \
	fi
	@if [ ! -d interface/frontend/node_modules ]; then \
		printf "$(YELLOW)Instalando dependencias do frontend...$(RESET)\n"; \
		(cd interface/frontend && npm install); \
	fi
	@printf "$(CYAN)Subindo API ($(CYAN)http://localhost:8026$(RESET)$(CYAN)) e frontend - veja o link exato no log do Vite abaixo...$(RESET)\n"
	@trap 'kill 0' EXIT INT TERM; \
	(cd interface/API && npm run dev) & \
	(cd interface/frontend && npm run dev) & \
	wait

# Builds a single-file Windows installer: compiles the API, builds the
# frontend as a static SPA (not the SSR dev build), then packages both
# plus the PowerShell engine into one electron-builder NSIS .exe.
electron-installer:
	@printf "$(CYAN)Compilando a API...$(RESET)\n"
	cd interface/API && npm run build
	@printf "$(CYAN)Compilando o frontend (build estatico)...$(RESET)\n"
	cd interface/frontend && npm run build:electron
	@printf "$(CYAN)Empacotando o instalador Electron...$(RESET)\n"
	cd interface/electron && npm run package
	@printf "$(GREEN)Instalador pronto em interface/electron/release/$(RESET)\n"
