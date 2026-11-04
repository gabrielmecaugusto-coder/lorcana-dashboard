# Lorcana Price Dashboard

Dashboard público de preços de cartas **Disney Lorcana**, com base no market price do TCGplayer.

**Site:** https://gabrielmecaugusto-coder.github.io/lorcana-dashboard/

## O que mostra
- Evolução do valor total ou do preço médio no tempo, com marcação de lançamentos de coleção e rotações do Core
- Valor total ou preço médio por coleção, por tinta ou por coleção × tinta; preço médio por raridade
- Ranking das 5 cartas mais caras de cada tinta
- Maiores altas e quedas, e variação agregada por tinta, raridade ou coleção, em 1 dia, 7 dias, 30 dias, 90 dias, 1 ano, desde o lançamento ou entre duas datas escolhidas. "Desde o lançamento" usa o preço de 1 semana após a estreia da carta, para não pegar a euforia do lançamento (cartas anteriores a fev/2024 usam o início do histórico)
- Histórico de preço de cada carta (mensal ou todos os pontos)
- Filtros por formato (Core/Infinity), coleções e raridades (várias ao mesmo tempo), cor de tinta, impressão, preço mínimo e nome

Rotações, coleções legais no Core e cartas banidas ficam em `scripts/formats.py`, que precisa ser atualizado a cada rotação ou mudança na lista de banidas.

## De onde vêm os dados
- **Preços e catálogo:** [TCGCSV](https://tcgcsv.com), espelho público diário da API do TCGplayer (Lorcana = categoria 71).
- **Histórico:** arquivo de preços do TCGCSV, que começa em 08/02/2024. Guardamos um ponto por semana desde então e um ponto por dia nos últimos 90 dias. A partir do início do projeto, o histórico passa a ser diário.

## Como funciona
O workflow `.github/workflows/update.yml` roda todo dia às 21:17 UTC:
1. `scripts/fetch_daily.py` baixa o catálogo e os preços do dia e salva em `data/catalog.json` e `data/prices/AAAA-MM-DD.csv.gz`.
2. `scripts/backfill.py` baixa as datas do histórico que ainda faltam (até 40 arquivos por execução, com pausa entre downloads; rodando manualmente com `full_backfill`, sem limite).
3. `scripts/build_site_data.py` gera os JSONs do site em `site/data/` (não versionados).
4. Os dados novos são commitados e o site é publicado no GitHub Pages.

Para rodar na hora: **Actions → Atualizar preços e publicar site → Run workflow**.

## Estrutura
```
data/catalog.json            coleções e cartas (raridade, tinta, custo, tipo, texto…)
data/prices/*.csv.gz         um arquivo por data: productId, impressão, market/low/mid/high
scripts/                     coleta, backfill e geração dos dados do site
site/                        página estática (HTML + JS + Chart.js)
```

Site de fã, não afiliado à Disney, Ravensburger ou TCGplayer. Não é recomendação de investimento.
