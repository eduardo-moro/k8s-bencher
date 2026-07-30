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
- `top-<mem>-<cpu>.log` — amostras de `kubectl top pod` durante o teste

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
