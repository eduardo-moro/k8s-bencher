# k8s-perftest

Ferramenta genérica para descobrir o mínimo de CPU/memória que uma aplicação
containerizada realmente precisa. Ela sobe um cluster `kind` local e
descartável, aplica o manifesto da sua aplicação, gera carga com
[k6](https://k6.io/) e varia uma matriz de combinações de memória/CPU,
registrando latência, taxa de erro, OOMKills e reinícios de cada combinação
em uma tabela.

Testa **uma aplicação por vez** (um único serviço). Dependências que essa
aplicação precise (banco, cache, etc.) devem já estar rodando e acessíveis
por conta própria — a ferramenta não sobe nada além do serviço sendo testado.

## Pré-requisitos

- Docker Desktop (rodando)
- [kind](https://kind.sigs.k8s.io/)
- kubectl
- [k6](https://k6.io/)
- PowerShell 7+ (`pwsh`)
- Módulo `powershell-yaml` (instalado automaticamente na primeira execução, se estiver faltando)

Rode `make check` (ou `pwsh -File perftest.ps1 -Check`) para verificar se
está tudo instalado e pronto antes de começar.

### Rodando via WSL (recomendado em máquinas Windows corporativas)

Em máquinas Windows com política de Controle de Aplicativo (AppLocker/WDAC)
ativa, os binários nativos do Windows podem:
- ser bloqueados pela política ("Uma política de Controle de Aplicativo
  bloqueou este arquivo"), principalmente quando instalados via Chocolatey
  portátil fora de `Program Files`;
- esbarrar num bug conhecido do PowerShell no Windows
  (`Program 'kind' failed to run: StandardOutputEncoding is only
  supported when standard output is redirected`), que acontece quando o
  `pwsh` roda sem um console real anexado — por exemplo, quando é disparado
  por outro processo em segundo plano.

O motor da ferramenta é só PowerShell 7 (`pwsh`) + binários padrão de
Kubernetes/Docker/k6 — nenhum código aqui depende de caminho ou recurso
específico do Windows. Rodando de dentro do WSL (um Linux de verdade) os
dois problemas acima somem, sem precisar mudar nada no repositório:

1. Tenha uma distro instalada (`wsl --install -d Ubuntu`, se ainda não tiver
   nenhuma).
2. Instale o PowerShell 7 dentro da distro:
   https://learn.microsoft.com/powershell/scripting/install/install-ubuntu
   (ou o pacote equivalente da sua distro).
3. Instale `kind`, `kubectl` e `k6` como binários Linux normais dentro do
   WSL — mesmos links da lista de pré-requisitos acima, baixando a versão
   Linux de cada um.
4. Docker: habilite a integração WSL do Docker Desktop para a sua distro
   (Settings → Resources → WSL Integration). O `docker` dentro do WSL passa
   a falar com o mesmo daemon do Docker Desktop, sem precisar instalar o
   Docker Engine separadamente.
5. **Instale Node.js dentro da distro também** (necessário para `make
   interface`, que sobe a API/frontend). O jeito mais robusto — independe da
   distro/gerenciador de pacotes (`apt`, `pacman`, `dnf`, etc.) — é extrair o
   binário oficial direto em `/usr/local`, que já vem antes das entradas do
   Windows no `PATH`:
   (`latest-vN.x/` é o alias real do nodejs.org para "última versão da
   linha N" — troque `22` pela LTS atual se já tiver mudado, veja
   https://nodejs.org/en/about/previous-releases):
   ```bash
   cd /tmp
   NODE_TARBALL=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/ | grep -oE 'node-v[0-9.]+-linux-x64\.tar\.xz' | head -1)
   curl -fsSLO "https://nodejs.org/dist/latest-v22.x/$NODE_TARBALL"
   sudo tar -xf "$NODE_TARBALL" -C /usr/local --strip-components=1
   ```
   No fish, a atribuição de variável usa `set` em vez de `=`:
   ```fish
   cd /tmp
   set NODE_TARBALL (curl -fsSL https://nodejs.org/dist/latest-v22.x/ | grep -oE "node-v[0-9.]+-linux-x64\.tar\.xz" | head -1)
   curl -fsSLO "https://nodejs.org/dist/latest-v22.x/$NODE_TARBALL"
   sudo tar -xf "$NODE_TARBALL" -C /usr/local --strip-components=1
   ```
   Se sua distro for baseada em Debian/Ubuntu, o pacote do NodeSource também
   funciona (`curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E
   bash - && sudo apt-get install -y nodejs`). Evite o
   [nvm](https://github.com/nvm-sh/nvm) a não ser que seu shell seja bash/zsh
   — ele só se integra automaticamente via `~/.bashrc`/`~/.zshrc`; em fish ou
   outro shell não-padrão, `node`/`npm` continuam resolvendo para os
   binários do Windows via interop mesmo com o nvm instalado.
6. Confirme que tudo resolve para binários Linux, não para os equivalentes
   do Windows expostos via interop do WSL (por padrão o WSL anexa o `PATH`
   do Windows ao do Linux — então um `pwsh`/`kind`/`node` "encontrado" pelo
   shell pode silenciosamente ser o `.exe` do Windows, reproduzindo os
   mesmos problemas que o WSL deveria evitar):
   ```bash
   which pwsh kind kubectl k6 node npm
   ```
   Cada linha deve apontar para um caminho Linux (`/usr/...`) — nunca
   `/mnt/c/...`. Se `node`/`npm` continuarem apontando para o Windows depois
   de instalados, o suspeito nº 1 é o shell não ter carregado o `PATH` novo
   (abra um terminal do WSL novo, ou confira se o seu shell realmente lê o
   rc file que o instalador tocou).
7. Rode `make check` de dentro do WSL, na pasta do repo — acessível em
   `/mnt/c/Users/<você>/source/k8s-perftest`, ou clone o repositório direto
   no filesystem do Linux para I/O mais rápido.

Depois disso, todos os comandos (`make cluster`, `make run`, `make full`,
`make teardown`, `make interface`) funcionam iguais, só que de dentro do
shell do WSL. O cluster `kind` sobe dentro do WSL2 normalmente, e as portas
expostas (`30080` do app testado, `8026` da API) ficam acessíveis em
`localhost` a partir do Windows — o WSL2 encaminha automaticamente.

**Se `interface/API/node_modules` ou `interface/frontend/node_modules` já
existirem** de uma execução anterior feita no Windows, apague-os antes do
primeiro `make interface` dentro do WSL — `make interface` só roda `npm
install` quando a pasta `node_modules` ainda não existe, e o Vite/esbuild/
Rollup instalam binários nativos específicos do SO (os baixados no Windows
não funcionam sob Linux):
```bash
rm -rf interface/API/node_modules interface/frontend/node_modules
make interface
```

## Início rápido (demo)

Sem nenhuma configuração própria, `make full` já roda uma demonstração
completa usando o exemplo `httpbin` incluso no repositório (copiado de
`templates/` para `manifests/`, `loadtest/` e `configs/` automaticamente na
primeira execução):

```bash
make full
```

Isso cria o cluster kind, aplica o manifesto do httpbin, publica o script de
carga, roda a matriz de recursos (4 combinações) e no final destrói o
cluster. Os resultados ficam em `output/httpbin-example-<timestamp>/`.

## Testando sua própria aplicação

1. Copie os três arquivos de exemplo como ponto de partida:
   ```bash
   cp templates/manifest.example.yaml manifests/minha-app.yaml
   cp templates/loadtest.example.js loadtest/minha-app.js
   cp templates/config.example.yaml configs/minha-app.yaml
   ```
2. Edite `manifests/minha-app.yaml` — é um Deployment + Service normal do
   Kubernetes. **Importante:** o nome do Deployment, o nome do container e o
   label `app` do pod precisam ser todos iguais ao valor do campo
   `container` da config (veja abaixo). É assim que o `kubectl set
   resources` sabe em qual container ajustar memória/CPU a cada combinação.

   Se sua aplicação é .NET rodando em versão anterior ao .NET Core 3.0 (onde
   a detecção de limite de memória via cgroup é pouco confiável), adicione
   uma env var `DOTNET_GCHeapHardLimit` ao container no manifesto (qualquer
   valor hex serve como ponto de partida). O harness detecta essa env var
   automaticamente e a mantém sincronizada com o limite de memória de cada
   combinação testada, via `kubectl set env` — usando 80% do limite de
   memória da combinação, não o valor cheio (o hard limit só cobre o heap
   gerenciado, não o processo inteiro; sem essa margem o container ainda
   pode ser OOM-killed por alocações fora do heap mesmo com o GC "dentro do
   limite").
3. Edite `loadtest/minha-app.js` — um script k6 de verdade. Ele mesmo define
   a URL de destino (ex.: `http://minha-app:8080`) e as requisições que
   simulam a carga; não existe um formato declarativo separado, o script é
   o artefato real.
4. Edite `configs/minha-app.yaml` (veja o schema abaixo).
5. Rode:
   ```bash
   make full CONFIG=configs/minha-app.yaml
   ```
   ou, direto pelo PowerShell:
   ```powershell
   .\perftest.ps1 -Full -Config configs\minha-app.yaml
   ```

`manifests/`, `loadtest/` e `configs/` não são versionados (são locais de
cada app/dev) — só `templates/` (os exemplos) e os dois arquivos de
infraestrutura genérica (`manifests/kind-config.yaml` e
`manifests/k6-job-template.yaml`) ficam no git.

## Comandos

| Comando | O que faz |
|---|---|
| `make check` | verifica se kind/kubectl/k6/docker/powershell-yaml estão prontos |
| `make cluster` | cria o cluster kind |
| `make run CONFIG=...` | aplica o manifesto/script e roda a matriz (cluster já precisa existir) |
| `make teardown` | destrói o cluster |
| `make all CONFIG=...` | cluster + run, cluster fica de pé no final (útil para inspecionar) |
| `make full CONFIG=...` | cluster + run + teardown, do início ao fim sem parar |

Os comandos `make` são um wrapper fino para `perftest.ps1`, que é a
interface principal: `-Cluster`, `-Run -Config <caminho>`, `-Teardown`,
`-All -Config <caminho>`, `-Full -Config <caminho>`, `-Check`.

## Schema da config (`configs/*.yaml`)

```yaml
name: minha-app
manifest: manifests/minha-app.yaml   # caminho para o manifesto real do Kubernetes
container: minha-app                  # nome do container/Deployment/label (ver acima)
script: loadtest/minha-app.js         # caminho para o script k6 real
resources:
  memory: [256Mi, 512Mi]              # valores de memória a testar
  cpu: [250m, 500m]                   # valores de CPU a testar (produto cartesiano com memory)
load:
  vus: 15                             # usuários virtuais (passado ao script como a env var VUS)
  stages:                             # estágios de carga do k6 (viram flags --stage duration:target)
    - {duration: 20s, target: 15}
    - {duration: 120s, target: 15}
    - {duration: 10s, target: 0}
sampleIntervalSeconds: 5              # opcional (padrão 5) - intervalo do amostrador de RAM/CPU/restarts
```

### Entendendo `load.stages`

Cada item de `stages` vira um `--stage <duration>:<target>` passado para o
`k6 run`. O k6 usa essa lista para ramp**ar** o número de usuários virtuais
(VUs) ao longo do tempo, um estágio depois do outro:

- **1º estágio** (`20s`, alvo `15`): nos primeiros 20 segundos, sobe
  gradualmente de 0 até 15 VUs simultâneos.
- **2º estágio** (`120s`, alvo `15`): nos 120 segundos seguintes, mantém 15
  VUs (o alvo é igual a onde o estágio anterior parou) — é o platô de carga
  constante, onde a maior parte da medição realmente acontece.
- **3º estágio** (`10s`, alvo `0`): nos últimos 10 segundos, desce de volta
  de 15 para 0 VUs.

Ou seja, `target` é sempre "quantos VUs ao **final** deste estágio", não
"durante" ele — cada estágio parte de onde o anterior terminou. A duração
total do teste de cada combinação de memória/CPU é a soma de todos os
estágios (20+120+10 = 150s no exemplo acima).

Por que subir/descer gradualmente em vez de simplesmente disparar 15 VUs de
uma vez? Tráfego real não chega em pico instantâneo, e um corte abrupto no
final derrubaria requisições no meio do caminho, distorcendo a taxa de erro
— subida/platô/descida é o padrão que o próprio k6 recomenda para isso.

Vale notar: o campo `vus` em si não controla diretamente a concorrência —
ele só é repassado ao pod do k6 como a env var `VUS`. No script de exemplo
(`templates/loadtest.example.js`), essa variável é lida mas não é usada em
lugar nenhum; quem realmente define quantos VUs rodam em cada momento são os
alvos (`target`) dentro de `stages`. Se o seu script quiser usar
`__ENV.VUS` para alguma lógica própria, pode; caso contrário, é seguro
ignorar esse campo.

## Saída (`output/<nome>-<timestamp>/`)

Cada execução cria uma pasta com:
- `results.csv` — uma linha por combinação de memória/CPU testada
- `k6-<mem>-<cpu>.json` — resumo bruto do k6 daquela combinação
- `top-<mem>-<cpu>.log` — amostras timestamped de `kubectl top pod`
  (uma a cada `sampleIntervalSeconds`, padrão 5s) durante o teste; a
  interface web usa esse arquivo para os gráficos de RAM/CPU ao longo do
  tempo

### Colunas do `results.csv`

| Coluna | Descrição |
|---|---|
| `memory` | limite/request de memória testado nesta combinação (ex.: `256Mi`) |
| `cpu` | limite/request de CPU testado nesta combinação (ex.: `250m`) |
| `start_time` | horário de início do teste desta combinação (ISO 8601) |
| `end_time` | horário de término do teste desta combinação (ISO 8601) |
| `duration_seconds` | duração total da combinação, em segundos |
| `p95_ms` | latência no percentil 95 das requisições HTTP, em milissegundos |
| `p99_ms` | latência no percentil 99 das requisições HTTP, em milissegundos |
| `error_rate` | fração de requisições que falharam (0 = nenhuma falha, 1 = todas falharam) |
| `http_reqs_total` | número total de requisições HTTP feitas durante o teste |
| `oom_killed` | `yes` se o container foi morto por falta de memória (OOMKilled) durante o teste, `no` caso contrário |
| `restart_count` | quantas vezes o container reiniciou durante o teste |

Em geral, a melhor combinação é a de menor memória/CPU onde `oom_killed=no`,
`restart_count=0` e a latência/taxa de erro continuam aceitáveis para o seu
caso de uso.

## Estrutura do repositório

- `perftest.ps1` — CLI principal
- `modules/Perftest.psm1` — toda a lógica (cluster, deploy, matriz de teste)
- `manifests/`, `loadtest/`, `configs/` — arquivos reais de cada app testado (não versionados, exceto os dois arquivos de infraestrutura genérica citados acima)
- `templates/` — exemplos prontos para copiar como ponto de partida
- `output/` — resultados de cada execução (não versionado)
