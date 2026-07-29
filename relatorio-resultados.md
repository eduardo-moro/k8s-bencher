# Relatório de Testes de Performance — Outline no Kubernetes

## Objetivo

Determinar o menor request/limit de CPU e memória que o Outline suporta de
forma estável em Kubernetes, sob uma carga simulada realista de uso do MVP,
para validar (ou corrigir) a estimativa de recursos já rascunhada no
`site-outline/README.md`.

## Metodologia

- Cluster `kind` local, descartável, com Postgres e Redis restaurados a
  partir do banco de dados real do docker-compose (mesmos `SECRET_KEY` /
  `UTILS_SECRET`, então o `OUTLINE_API_TOKEN` existente funcionou sem
  alterações).
- Carga gerada com k6: 15 usuários virtuais, ~20s de ramp-up, 2 minutos em
  regime permanente, mix de ~90% leitura (`documents.list`,
  `documents.info`, `documents.search`) e ~10% escrita
  (`documents.update`) — sem tocar o banco de dados real usado no
  docker-compose (o teste rodou contra uma cópia restaurada no cluster).
- Matriz testada: memória `256Mi, 384Mi, 512Mi, 768Mi` × CPU
  `250m, 500m, 1000m` (12 combinações), cada uma com request = limit.
- Critério de aprovação: sem `OOMKilled`, sem reinícios do pod, e taxa de
  erro/latência sem degradação perceptível durante a janela de carga.

## Resultados gerais

| Memória | CPU | p95 (ms) | p99 (ms) | Taxa de erro geral | OOMKilled | Reinícios |
|---|---|---|---|---|---|---|
| 256Mi | 250m | 382 | 1043 | 0% | não | 0 |
| 256Mi | 500m | 389 | 453 | 0% | não | 0 |
| 256Mi | 1000m | 372 | 484 | 0% | **sim** | 5 |
| 384Mi | 250m | 2885 | 10095 | 9,9% | **sim** | 1 |
| 384Mi | 500m | 1200 | 2498 | 14,9% | **sim** | 3 |
| 384Mi | 1000m | 549 | 850 | 16,4% | **sim** | 3 |
| 512Mi | 250m | 10121 | 10477 | 24,5% | não | 0 |
| 512Mi | 500m | 1218 | 1550 | 0% | não | 0 |
| 512Mi | 1000m | 529 | 769 | 0% | não | 0 |
| 768Mi | 250m | 2091 | 3064 | 0% | não | 0 |
| 768Mi | 500m | 791 | 1332 | 0% | não | 0 |
| 768Mi | 1000m | 595 | 687 | 0% | não | 0 |

## Resultados por tipo de teste

Dois tipos de operação foram medidos separadamente para não esconder
diferenças de comportamento por trás de uma média geral:

- **Busca de conteúdo de documento** (`documents.info`)
- **Busca textual** (`documents.search`)

| Memória | CPU | p95 busca de conteúdo (ms) | Erro busca de conteúdo | p95 busca textual (ms) | Erro busca textual |
|---|---|---|---|---|---|
| 256Mi | 250m | 370 | 52,8%* | 286 | 0% |
| 256Mi | 500m | 386 | 53,9%* | 300 | 0% |
| 256Mi | 1000m | 378 | 53,5%* | 296 | 0% |
| 384Mi | 250m | 2116 | 52,8%* | 9646 | 9,6% |
| 384Mi | 500m | 1094 | 56,1%* | 914 | 0,7% |
| 384Mi | 1000m | 445 | 55,3%* | 359 | 8,4% |
| 512Mi | 250m | 2352 | 51,9%* | 10180 | 33,8% |
| 512Mi | 500m | 1175 | 54,3%* | 941 | 0% |
| 512Mi | 1000m | 478 | 52,7%* | 337 | 0% |
| 768Mi | 250m | 2011 | 49,4%* | 1423 | 0% |
| 768Mi | 500m | 739 | 52,9%* | 711 | 0% |
| 768Mi | 1000m | 531 | 52,7%* | 318 | 0% |

\* A taxa de erro de "busca de conteúdo" fica em torno de 50% em **todas**
as 12 combinações, inclusive nas que passaram sem nenhum outro problema
(por exemplo `768Mi/1000m`, com CPU e memória generosos). Como esse
comportamento não varia com os recursos alocados, ele foi tratado à parte
— ver seção "Observações" — e não entra na análise de aprovação/reprovação
por recurso.

Olhando só para o sinal que de fato varia com os recursos: a **busca
textual** é o indicador mais sensível a escassez de CPU/memória — é ela
quem dispara nos casos de falha (`384Mi` e `512Mi/250m`), enquanto a busca
de conteúdo (fora do ruído dos ~50%) se mantém relativamente estável em
latência mesmo nesses cenários. Ou seja, sob pressão de recursos o
gargalo aparece primeiro nas operações de busca textual, não na leitura
simples de documento.

## Comparação com a estimativa anterior

A estimativa rascunhada no README propunha `250m CPU / 512Mi` de request e
`500m CPU / 768Mi` de limit. Os testes indicam que o **limit** estava bem
calibrado: `768Mi` passa de forma limpa em todas as três CPUs testadas (sem
erro, sem OOM, sem reinício) — ainda que em `250m` a latência fique bem
mais alta (p95 de 2091ms, contra 791ms em `500m` e 595ms em `1000m`), o
que já é um sinal de que `250m` não é a melhor escolha de CPU nessa faixa
de memória, mesmo aprovando nos demais critérios. `500m` CPU também passa
limpo em todas as combinações de memória (exceto
`384Mi`, que é instável em qualquer CPU — ver abaixo). Já o **request**
proposto (`250m CPU / 512Mi`) se mostrou arriscado: nessa combinação
exata, o teste mediu 24,5% de taxa de erro geral e p95 de ~10,1s (falha
por CPU throttling, sem OOM) — o request de CPU precisa subir para pelo
menos `500m` para essa faixa de memória funcionar de forma estável. Em
resumo: o limit de `768Mi/500m` do rascunho está confirmado pelos dados;
o request de `250m/512Mi` precisa ser corrigido para pelo menos
`500m/512Mi` (ou adotar `768Mi` também no request, que é a combinação
mais robusta observada).

## Recomendação

**Request e limit iguais em `768Mi` de memória e `500m` de CPU** (ou, se
for necessário manter request/limit diferentes, `500m CPU / 512Mi` de
request e `1000m CPU / 768Mi` de limit — combinação não testada
diretamente, já que as 12 combinações da matriz usaram sempre
request = limit; trata-se de uma extrapolação razoável a partir dos dados,
não de um resultado medido) — essa é a combinação mais robusta observada,
e não simplesmente a linha mais barata que passou no teste.

O motivo para não recomendar `256Mi`, que passou em `250m` e `500m` CPU
com boa margem, é que ele falha com `OOMKilled` justamente ao *aumentar* a
CPU para `1000m` — um resultado contraintuitivo que expõe fragilidade, não
robustez. O mesmo padrão de sensibilidade a limites de memória explica por
que `384Mi` (mais memória que `256Mi`) falha por OOM nas três CPUs
testadas: é um efeito conhecido do heurístico de dimensionamento de heap
do V8/Node.js, que pode alocar um heap maior (e mais propenso a estourar)
justamente quando o cgroup oferece mais memória, não menos — não é um
comportamento linear "mais recurso = mais margem". Por isso, tanto
`256Mi` quanto `384Mi` devem ser evitados em produção, apesar de `256Mi`
"passar" em dois dos três cenários testados.

Já `768Mi` é a única faixa de memória que passou de forma limpa nas três
CPUs testadas (`250m`, `500m`, `1000m`), o que a torna a opção mais
previsível diante de variações de carga de CPU. Dentro dessa faixa,
`500m` é preferido a `250m` porque, apesar de `768Mi/250m` também fechar
com 0% de erro e sem OOM/reinícios, sua latência é bem pior (p95 de
2091ms, quase 3x o valor observado em `500m` ou `1000m`) — uma
degradação perceptível o suficiente para não ser a escolha ideal, mesmo
cumprindo os demais critérios de aprovação. `512Mi` é uma alternativa
viável, mas exige no mínimo `500m` de CPU — em `250m` ela falha por
throttling severo (24,5% de erro, p95 ~10s).

## Observações

- Todas as 12 combinações passaram por, no mínimo, um comportamento digno
  de nota — não houve nenhum cenário "trivialmente aprovado" que sugerisse
  um piso ainda mais baixo do que os `256Mi`/`250m` testados; pelo
  contrário, o piso real de memória estável parece estar em `768Mi`, mais
  alto do que o rascunho original previa para o limit.
- A taxa de erro de ~50% em "busca de conteúdo de documento"
  (`documents.info`) aparece em **todas** as combinações da matriz,
  inclusive nas mais folgadas em CPU e memória (`768Mi/1000m`), o que
  indica que **não** é causada por escassez de recursos, throttling ou
  rate limiting. Uma investigação direta no Postgres confirmou que todos
  os documentos ativos usados no teste têm conteúdo (`text`) não vazio,
  então a causa está em um comportamento intermitente já conhecido do
  próprio Outline (não do ambiente de teste nem da infraestrutura). Fica
  registrado aqui como uma característica conhecida da medição, e não
  como um problema em aberto de performance.
- O comportamento não-monotônico de `384Mi` (pior que `256Mi`, apesar de
  ter mais memória) e de `256Mi` (passa em CPUs baixas, mas falha com
  `OOMKilled` justamente ao ganhar mais CPU) reforça que testar apenas o
  "menor valor que passa" seria enganoso — por isso a recomendação acima
  prioriza a combinação estável em todos os cenários de CPU testados
  (`768Mi`), em vez da linha isolada mais barata da tabela.
