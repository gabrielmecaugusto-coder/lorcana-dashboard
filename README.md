# Lorcana Price Dashboard

Dashboard público de preços de cartas **Disney Lorcana**, com base no market price do TCGplayer.

**Site:** https://gabrielmecaugusto-coder.github.io/lorcana-dashboard/

## O que mostra
- Valor total por coleção e preço médio por raridade
- Maiores altas e quedas em 1 dia, 7 dias, 30 dias, 90 dias, 1 ano, desde o início ou entre duas datas escolhidas
- Histórico de preço de cada carta (mensal ou todos os pontos)
- Filtros por coleção, cor de tinta, raridade, impressão (normal, foil, cold foil), preço mínimo e nome

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
