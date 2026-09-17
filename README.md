# Mata Atlântica paulista — desmatamento pelo PRODES

Mapa web interativo do desmatamento (supressão de vegetação nativa) no bioma Mata Atlântica dentro do estado de São Paulo, de 2000 a 2025, com os dados oficiais do **PRODES / INPE**.

🔗 **[Ver a aplicação](https://deaturibio.github.io/Desmatamento-SP---s-rie-hist-rica/)**

![Captura da aplicação](docs/assets/img/captura.png)

---

## O que a aplicação faz

- **Mapa por período** — os polígonos de desmatamento são servidos por **WMS** pelo GeoServer do TerraBrasilis e filtrados no servidor por ano e por estado com `CQL_FILTER`. Nenhum dado vetorial pesado é hospedado no repositório.
- **Linha do tempo animada** — botão de play percorre os 17 períodos PRODES; o mapa, os indicadores e o ranking acompanham. No fim, o mapa mostra o acumulado de 2000 a 2025, todos os períodos somados.
- **Consulta ao polígono** — o clique no mapa dispara um `GetFeatureInfo` e devolve os atributos do polígono: ano PRODES, área, data da imagem, satélite, sensor e órbita-ponto.
- **Série histórica** — gráfico de barras em SVG desenhado à mão (sem biblioteca de gráficos), mostrando a **média anual** de cada período.
- **Ranking municipal** — os 15 municípios com maior área desmatada no período selecionado; clicar num deles busca o limite municipal por **WFS** e leva o mapa até lá.
- **Camadas de contexto** — desmatamento acumulado até 2000, limite estadual dentro do bioma e imagem de satélite.
- **Permalink** — o período selecionado fica na URL (`?p=2018`).

## Decisões técnicas

| Decisão | Por quê |
|---|---|
| WMS + `CQL_FILTER` em vez de GeoJSON local | são **71.586** polígonos só em SP; renderizar no servidor mantém o repositório com poucos KB e o mapa fluido |
| Visão geral pelo cache, período pelo WMS | o GeoWebCache do INPE entrega tile pronto em ~400 ms, mas não expõe dimensão de ano. A aplicação abre nele (tudo desde 2004, instantâneo) e só troca para o WMS filtrado quando a pessoa escolhe um período ou aproxima o zoom. A grade `EPSG:900913` do cache foi conferida contra o WMS: sobreposição de 0,93 |
| Tile de 512 px, escolhido por medição | na vista do estado: 24 tiles de 256 px = 1290 ms, 6 tiles de 512 px = 930 ms, imagem única = 2470 ms. O GeoServer desenha uma requisição por vez, então poucas chamadas paralelas batem tanto o excesso de tiles quanto a imagem monolítica |
| Pré-carga do período seguinte | durante a animação, o próximo período é buscado invisível enquanto o atual está na tela |
| Duas camadas WMS alternadas | a nova só substitui a anterior depois de carregada — sem isso o mapa pisca a cada troca de período, e a animação fica ilegível |
| Cor ajustada por filtro CSS no *pane* | o servidor tem a estilização dinâmica desativada e ignora `SLD_BODY`: tudo volta em amarelo. Como a resposta é imagem, a correção cromática acontece no cliente, um filtro por camada |
| Halo (`drop-shadow`) nos polígonos do período | os incrementos anuais recentes têm poucos hectares cada e ficariam sub-pixel na escala do estado |
| Média anual no gráfico | até 2016 o PRODES Mata Atlântica foi mapeado em intervalos plurianuais; comparar totais brutos entre um período de 4 anos e um de 1 ano seria enganoso |
| JS puro, sem build | o projeto roda direto no GitHub Pages, sem etapa de compilação, sem CDN e sem back-end |
| Leaflet embarcado em `docs/assets/vendor/` | independência de CDN — a aplicação continua funcionando mesmo se um provedor externo cair |

## Estrutura

```
docs/
├── index.html
├── assets/
│   ├── css/style.css
│   ├── js/app.js          → mapa, camadas WMS, indicadores, controles
│   ├── js/grafico.js       → gráfico de barras em SVG, escrito à mão
│   └── vendor/leaflet/     → Leaflet 1.9.4 embarcado
└── dados/
    └── prodes_sp.json      → série histórica agregada de SP
```

## Fonte dos dados

**PRODES Mata Atlântica** — Instituto Nacional de Pesquisas Espaciais (INPE), plataforma [TerraBrasilis](https://terrabrasilis.dpi.inpe.br/).

- Polígonos: `prodes-mata-atlantica-nb:yearly_deforestation` (WMS/WFS público)
- Série agregada: painel oficial de incrementos do PRODES Mata Atlântica, recortada para São Paulo
- Extração: setembro de 2026

O ano PRODES vai de **1º de agosto a 31 de julho** do ano seguinte.

## Rodando localmente

Por causa do `fetch` do JSON, é preciso servir por HTTP (abrir o `index.html` direto pelo sistema de arquivos não funciona):

```bash
cd docs
python -m http.server 8000
# abra http://localhost:8000
```

## Rodando com Docker

O projeto também pode ser executado como um contêiner Nginx, sem instalar Python ou Node.js:

```bash
docker compose up --build
# abra http://localhost:8080
```

Para executar em segundo plano:

```bash
docker compose up --build -d
```

Para parar o contêiner:

```bash
docker compose down
```

## Publicação

GitHub Pages, com origem no diretório `/docs` da branch `main`.

---

Feito por [Andrea Turíbio](https://github.com/DeaTuribio) · [LinkedIn](https://www.linkedin.com/in/andrea-turibio-41507467)
