/* =========================================================
   app.js — Mata Atlântica paulista / PRODES
   HTML + CSS + JS puros. Leaflet embarcado, sem CDN.
   ========================================================= */

(function () {
  'use strict';

  var WMS = 'https://terrabrasilis.dpi.inpe.br/geoserver/prodes-mata-atlantica-nb/wms';
  var OWS = 'https://terrabrasilis.dpi.inpe.br/geoserver/prodes-mata-atlantica-nb/ows';
  var CAMADA_ANO = 'prodes-mata-atlantica-nb:yearly_deforestation';
  var CAMADA_ACUM = 'prodes-mata-atlantica-nb:accumulated_deforestation_2000';
  var CAMADA_UF = 'prodes-mata-atlantica-nb:states_mata_atlantica_biome';
  var CAMADA_MUN = 'prodes-mata-atlantica-nb:municipalities_mata_atlantica_biome';

  var $ = function (id) { return document.getElementById(id); };

  var estado = {
    dados: null, idx: 0, modo: 'geral', tocando: false,
    timer: null, pedido: 0, atual: 0, destaque: null
  };

  /* ---------------------------------------------------------
     1. Mapa e painéis de desenho
     ---------------------------------------------------------
     O GeoServer do TerraBrasilis tem a estilização dinâmica
     desativada: SLD_BODY é ignorado e as camadas sempre voltam
     no estilo padrão (amarelo). Como a resposta é uma imagem,
     o ajuste cromático é feito no cliente, com filtros CSS
     aplicados a cada pane do Leaflet — ver style.css.
     --------------------------------------------------------- */

  var mapa = L.map('mapa', {
    center: [-22.6, -48.4],
    zoom: 7,
    minZoom: 5,
    maxZoom: 15
  });

  // cada camada ganha seu próprio pane para receber filtro CSS isolado
  ['acum', 'geral', 'ano', 'uf', 'destaque'].forEach(function (nome, i) {
    mapa.createPane(nome);
    mapa.getPane(nome).style.zIndex = 410 + i * 8;
  });

  var baseClaro = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    { attribution: '&copy; OpenStreetMap, &copy; CARTO', subdomains: 'abcd', maxZoom: 19 }
  ).addTo(mapa);

  var baseSatelite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Imagem: Esri, Maxar, Earthstar Geographics', maxZoom: 18 }
  );

  function novaCamadaAno() {
    return L.tileLayer.wms(WMS, {
      layers: CAMADA_ANO,
      format: 'image/png',
      transparent: true,
      version: '1.1.1',
      pane: 'ano',
      // Medido contra o servidor do INPE, para a vista do estado inteiro:
      //   24 tiles de 256 px .... 1290 ms
      //    6 tiles de 512 px ....  930 ms   ← escolhido
      //    1 imagem única ....... 2470 ms   (o servidor desenha em série)
      // O ganho vem de dividir o trabalho em poucas requisições paralelas.
      tileSize: 512,
      updateWhenIdle: true,
      keepBuffer: 0,
      cql_filter: "state='SP'",
      attribution: 'PRODES / TerraBrasilis — INPE'
    });
  }

  // Duas camadas alternadas: a nova só entra depois de carregada,
  // e só então a antiga sai. Sem isso o mapa "pisca" a cada troca.
  var camadasAno = [novaCamadaAno(), novaCamadaAno()];

  /* Visão geral: tiles prontos do GeoWebCache do INPE.
     Sem filtro por ano (o cache não expõe dimensão de tempo), mas
     entregues em ~400 ms contra 1–3 s do WMS desenhado na hora.
     Servem de primeira imagem: a mancha de tudo que foi desmatado
     desde 2004. Ao escolher um período ou aproximar o zoom, entra
     a camada filtrada. A grade EPSG:900913 coincide com o esquema
     XYZ do Leaflet — conferido contra o WMS, sobreposição de 0,93. */
  var camadaGeral = L.tileLayer(
    'https://terrabrasilis.dpi.inpe.br/geoserver/gwc/service/wmts' +
    '?service=WMTS&request=GetTile&version=1.0.0' +
    '&layer=' + CAMADA_ANO + '&style=&tilematrixset=EPSG:900913' +
    '&format=image/png&tilematrix=EPSG:900913:{z}&tilerow={y}&tilecol={x}',
    {
      pane: 'geral',
      opacity: 0.85,
      maxNativeZoom: 13,
      attribution: 'PRODES / TerraBrasilis — INPE'
    }
  );

  var ZOOM_DETALHE = 9;

  var camadaAcum = L.tileLayer.wms(WMS, {
    layers: CAMADA_ACUM,
    format: 'image/png',
    transparent: true,
    version: '1.1.1',
    pane: 'acum',
    opacity: 0.42,
    cql_filter: "state='SP'"
  });

  var camadaUF = L.tileLayer.wms(WMS, {
    layers: CAMADA_UF,
    format: 'image/png',
    transparent: true,
    version: '1.1.1',
    pane: 'uf',
    cql_filter: "sigla='SP'"
  }).addTo(mapa);

  var aviso = document.createElement('div');
  aviso.className = 'carregando';
  aviso.textContent = 'consultando…';
  aviso.hidden = true;
  $('mapa').parentNode.appendChild(aviso);

  /**
   * Troca o ano exibido sem piscar.
   * @param {number} ano
   * @param {Function} aoPronto chamado quando os tiles terminam
   */
  function filtroAno(ano) { return "state='SP' AND year=" + ano; }

  function trocarAno(ano, aoPronto) {
    var meu = ++estado.pedido;
    var nova = camadasAno[1 - estado.atual];
    var antiga = camadasAno[estado.atual];
    var encerrado = false;

    function concluir() {
      if (encerrado || meu !== estado.pedido) return;
      encerrado = true;
      nova.setOpacity(1);
      if (antiga !== nova && mapa.hasLayer(antiga)) {
        mapa.removeLayer(antiga);
        estado.atual = 1 - estado.atual;
      }
      aviso.hidden = true;
      if (aoPronto) aoPronto();
    }

    // se o período já foi pré-carregado durante a animação, a troca é imediata
    if (nova.__ano === ano && nova.__pronta && mapa.hasLayer(nova)) {
      concluir();
      return;
    }

    aviso.hidden = false;
    nova.__ano = ano;
    nova.__pronta = false;
    nova.setOpacity(1);
    nova.setParams({ cql_filter: filtroAno(ano) }, true);
    nova.once('load', function () { nova.__pronta = true; concluir(); });
    if (!mapa.hasLayer(nova)) nova.addTo(mapa);
    // rede lenta ou tile com erro não podem travar a animação
    setTimeout(concluir, 9000);
  }

  /**
   * Busca o próximo período em segundo plano, invisível, enquanto o
   * atual está na tela. Usado durante a animação: quando chega a hora
   * de avançar, os tiles já estão no navegador.
   */
  function preCarregar(ano) {
    if (estado.modo !== 'periodo') return;
    var reserva = camadasAno[1 - estado.atual];
    if (reserva.__ano === ano) return;
    reserva.__ano = ano;
    reserva.__pronta = false;
    reserva.setOpacity(0);
    reserva.setParams({ cql_filter: filtroAno(ano) }, true);
    reserva.once('load', function () { reserva.__pronta = true; });
    if (!mapa.hasLayer(reserva)) reserva.addTo(mapa);
  }

  /* ---------------------------------------------------------
     1b. Dois modos de exibição
     ---------------------------------------------------------
     "geral"   — tiles cacheados, todo o desmatamento desde 2004.
                 É o estado inicial: abre instantâneo.
     "período" — camada WMS filtrada pelo período escolhido.
                 Entra quando a pessoa mexe na linha do tempo ou
                 aproxima o zoom, onde os polígonos fazem sentido.
     --------------------------------------------------------- */

  function totalAcumulado() {
    if (!estado.dados) return 0;
    return estado.dados.periodos.reduce(function (s, p) { return s + p.area; }, 0);
  }

  function atualizarModo() {
    var geral = estado.modo === 'geral';
    var p = estado.dados && estado.dados.periodos[estado.idx];
    $('modo-texto').textContent = geral
      ? 'Acumulado 2000–2025 · ' + num(totalAcumulado()) + ' km² em SP'
      : 'Período ' + (p ? rotuloPeriodo(p) : '');
    $('modo-trocar').textContent = geral ? 'ver um período' : 'ver o acumulado';
    document.querySelector('.legenda').classList.toggle('em-geral', geral);
  }

  function entrarModoGeral() {
    estado.modo = 'geral';
    estado.pedido++; // invalida qualquer troca de período em andamento
    camadasAno.forEach(function (c) {
      if (mapa.hasLayer(c)) mapa.removeLayer(c);
      c.__ano = null;
      c.__pronta = false;
    });
    if (!mapa.hasLayer(camadaGeral)) camadaGeral.addTo(mapa);
    aviso.hidden = true;
    atualizarModo();
  }

  function entrarModoPeriodo() {
    if (estado.modo === 'periodo') return;
    estado.modo = 'periodo';
    if (mapa.hasLayer(camadaGeral)) mapa.removeLayer(camadaGeral);
    atualizarModo();
    var p = estado.dados.periodos[estado.idx];
    if (p) trocarAno(p.ano);
  }

  mapa.on('zoomend', function () {
    if (mapa.getZoom() >= ZOOM_DETALHE) entrarModoPeriodo();
  });

  $('modo-trocar').addEventListener('click', function () {
    if (estado.modo === 'geral') entrarModoPeriodo();
    else {
      pararAnimacao();
      entrarModoGeral();
    }
  });

  /* ---------------------------------------------------------
     2. Clique no mapa → GetFeatureInfo
     --------------------------------------------------------- */

  function urlFeatureInfo(latlng) {
    var ponto = mapa.latLngToContainerPoint(latlng, mapa.getZoom());
    var tam = mapa.getSize();
    var limites = mapa.getBounds();
    var so = L.CRS.EPSG3857.project(limites.getSouthWest());
    var ne = L.CRS.EPSG3857.project(limites.getNorthEast());

    var params = {
      service: 'WMS', request: 'GetFeatureInfo', version: '1.1.1',
      layers: CAMADA_ANO, query_layers: CAMADA_ANO,
      srs: 'EPSG:3857',
      bbox: [so.x, so.y, ne.x, ne.y].join(','),
      width: tam.x, height: tam.y,
      x: Math.round(ponto.x), y: Math.round(ponto.y),
      info_format: 'application/json',
      feature_count: 1,
      buffer: 8,
      cql_filter: camadasAno[estado.atual].wmsParams.cql_filter
    };

    return WMS + '?' + Object.keys(params).map(function (k) {
      return k + '=' + encodeURIComponent(params[k]);
    }).join('&');
  }

  function textoData(iso) {
    if (!iso) return '—';
    var p = String(iso).slice(0, 10).split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  function linha(rot, val) { return '<dt>' + rot + '</dt><dd>' + val + '</dd>'; }

  mapa.on('click', function (e) {
    fetch(urlFeatureInfo(e.latlng))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.features || !j.features.length) { $('info').hidden = true; return; }
        var p = j.features[0].properties;
        $('info-corpo').innerHTML =
          linha('Ano PRODES', p.year) +
          linha('Área', p.area_km < 0.1 ? (p.area_km * 100).toFixed(2) + ' ha' : p.area_km.toFixed(3) + ' km²') +
          linha('Classe', p.main_class || '—') +
          linha('Data da imagem', textoData(p.image_date)) +
          linha('Satélite', (p.satellite || '—') + (p.sensor ? ' / ' + p.sensor : '')) +
          linha('Órbita-ponto', p.path_row || '—');
        $('info').hidden = false;
      })
      .catch(function () { $('info').hidden = true; });
  });

  $('info-fechar').addEventListener('click', function () { $('info').hidden = true; });

  /* ---------------------------------------------------------
     3. Zoom até um município do ranking
     --------------------------------------------------------- */

  var VISTA_SP = { centro: [-22.6, -48.4], zoom: 7 };

  function irParaMunicipio(nome) {
    var cql = "nome='" + nome.replace(/'/g, "''") + "' AND geocodigo LIKE '35%'";
    var url = OWS + '?service=WFS&version=2.0.0&request=GetFeature&outputFormat=application/json' +
      '&typeNames=' + CAMADA_MUN + '&count=1&CQL_FILTER=' + encodeURIComponent(cql);

    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.features || !j.features.length) return;
        if (estado.destaque) mapa.removeLayer(estado.destaque);
        estado.destaque = L.geoJSON(j, {
          pane: 'destaque',
          style: { color: '#7fd3ff', weight: 2, fill: false, dashArray: '5 4' }
        }).addTo(mapa);
        mapa.fitBounds(estado.destaque.getBounds(), { padding: [30, 30], maxZoom: 12 });
        entrarModoPeriodo();
        $('btn-voltar').hidden = false;
      })
      .catch(function () { /* silencioso: é um atalho, não uma função crítica */ });
  }

  $('btn-voltar').addEventListener('click', function () {
    if (estado.destaque) { mapa.removeLayer(estado.destaque); estado.destaque = null; }
    mapa.setView(VISTA_SP.centro, VISTA_SP.zoom);
    this.hidden = true;
  });

  /* ---------------------------------------------------------
     4. Dados, indicadores, gráfico e ranking
     --------------------------------------------------------- */

  function anosDoPeriodo(p) {
    var a = new Date(p.ini), b = new Date(p.fim);
    return Math.max(1, Math.round((b - a) / (365.25 * 24 * 3600 * 1000)));
  }

  function rotuloPeriodo(p) { return 'ago/' + p.ini.slice(0, 4) + ' — jul/' + p.fim.slice(0, 4); }

  function num(v) {
    return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function aplicar(idx, aoPronto) {
    var d = estado.dados;
    var p = d.periodos[idx];
    estado.idx = idx;

    // na visão geral o mapa não muda; o painel e o gráfico, sim
    if (estado.modo === 'periodo') trocarAno(p.ano, aoPronto);
    else if (aoPronto) setTimeout(aoPronto, 0);

    var anos = anosDoPeriodo(p);
    var media = p.area / anos;
    $('kpi-area').textContent = num(p.area);
    $('kpi-periodo').textContent = rotuloPeriodo(p) + (anos > 1 ? ' · ' + anos + ' anos de mapeamento' : ' · ano PRODES ' + p.ano);
    $('kpi-media').textContent = num(media);
    $('kpi-anos').textContent = anos > 1 ? 'total dividido por ' + anos + ' anos' : 'período anual';
    $('kpi-mun').textContent = p.nMun;

    var alvoVar = $('kpi-var');
    alvoVar.parentNode.classList.remove('sobe', 'desce');
    if (idx === 0) {
      alvoVar.textContent = '—';
    } else {
      var ant = d.periodos[idx - 1];
      var mediaAnt = ant.area / anosDoPeriodo(ant);
      var pct = (media - mediaAnt) / mediaAnt * 100;
      alvoVar.textContent = (pct > 0 ? '+' : '') + pct.toFixed(0) + '%';
      alvoVar.parentNode.classList.add(pct > 0 ? 'sobe' : 'desce');
    }

    $('periodo-rotulo').innerHTML = '<strong>' + rotuloPeriodo(p) + '</strong> · ' +
      num(p.area) + ' km² em ' + p.nMun + ' municípios';
    $('slider').value = idx;

    var max = p.top.length ? p.top[0][1] : 1;
    $('ranking-legenda').textContent = 'km² no período ' + rotuloPeriodo(p) + ' — clique para ir ao município';
    $('ranking').innerHTML = p.top.map(function (m) {
      return '<li data-mun="' + m[0] + '" tabindex="0" role="button" title="Ver ' + m[0] + ' no mapa">' +
        '<span class="preenche" style="width:' + (m[1] / max * 100).toFixed(1) + '%"></span>' +
        '<span class="nome">' + m[0] + '</span>' +
        '<span class="val">' + num(m[1]) + '</span></li>';
    }).join('');

    if (estado.grafico) estado.grafico.marcar(idx);
    atualizarModo();

    try { history.replaceState(null, '', '?p=' + p.ano); } catch (e) { /* file:// */ }
  }

  $('ranking').addEventListener('click', function (e) {
    var li = e.target.closest('li');
    if (li) irParaMunicipio(li.dataset.mun);
  });

  $('ranking').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var li = e.target.closest('li');
    if (li) { e.preventDefault(); irParaMunicipio(li.dataset.mun); }
  });

  /* ---------------------------------------------------------
     5. Controles
     --------------------------------------------------------- */

  function pararAnimacao() {
    estado.tocando = false;
    clearTimeout(estado.timer);
    $('btn-play').classList.remove('tocando');
    $('btn-play').setAttribute('aria-label', 'Reproduzir série temporal');
  }

  /* Fecho da animação: depois do último período, o mapa mostra a soma
     de tudo — todos os polígonos dos períodos de 2000 a 2025 juntos,
     na área que estiver na tela. É a resposta visual à pergunta que a
     série temporal levanta: "e no total, quanto foi?". */
  function fecharComAcumulado() {
    clearTimeout(estado.timer);
    estado.timer = setTimeout(function () {
      entrarModoGeral();
      $('modo-mapa').classList.add('destacado');
      setTimeout(function () { $('modo-mapa').classList.remove('destacado'); }, 2200);
      estado.tocando = false;
      $('btn-play').classList.remove('tocando');
      $('btn-play').setAttribute('aria-label', 'Reproduzir série temporal');
    }, 1500);
  }

  function passo() {
    if (!estado.tocando) return;
    if (estado.idx >= estado.dados.periodos.length - 1) { fecharComAcumulado(); return; }
    // o próximo período só entra depois que os tiles do atual carregaram
    aplicar(estado.idx + 1, function () {
      var seguinte = estado.dados.periodos[estado.idx + 1];
      if (seguinte) preCarregar(seguinte.ano);
      if (estado.tocando) estado.timer = setTimeout(passo, 900);
    });
  }

  $('btn-play').addEventListener('click', function () {
    if (estado.tocando) { pararAnimacao(); return; }
    entrarModoPeriodo();
    estado.tocando = true;
    this.classList.add('tocando');
    this.setAttribute('aria-label', 'Pausar');
    if (estado.idx >= estado.dados.periodos.length - 1) {
      aplicar(0, function () {
        if (estado.dados.periodos[1]) preCarregar(estado.dados.periodos[1].ano);
        if (estado.tocando) estado.timer = setTimeout(passo, 900);
      });
    } else {
      passo();
    }
  });

  $('slider').addEventListener('input', function () {
    pararAnimacao();
    entrarModoPeriodo();
    aplicar(+this.value);
  });

  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'LI') return;
    if (e.key === 'ArrowRight' && estado.idx < estado.dados.periodos.length - 1) { pararAnimacao(); entrarModoPeriodo(); aplicar(estado.idx + 1); }
    if (e.key === 'ArrowLeft' && estado.idx > 0) { pararAnimacao(); entrarModoPeriodo(); aplicar(estado.idx - 1); }
  });

  $('ck-acumulado').addEventListener('change', function () {
    if (this.checked) camadaAcum.addTo(mapa); else mapa.removeLayer(camadaAcum);
    document.querySelector('.chip-li-acum').classList.toggle('ativo', this.checked);
  });

  $('ck-uf').addEventListener('change', function () {
    if (this.checked) camadaUF.addTo(mapa); else mapa.removeLayer(camadaUF);
  });

  $('ck-satelite').addEventListener('change', function () {
    if (this.checked) { mapa.removeLayer(baseClaro); baseSatelite.addTo(mapa); }
    else { mapa.removeLayer(baseSatelite); baseClaro.addTo(mapa); }
  });

  $('btn-sobre').addEventListener('click', function () { $('dlg-sobre').showModal(); });
  $('dlg-fechar').addEventListener('click', function () { $('dlg-sobre').close(); });

  /* ---------------------------------------------------------
     6. Arranque
     --------------------------------------------------------- */

  fetch('dados/prodes_sp.json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      estado.dados = d;

      $('slider').max = d.periodos.length - 1;
      $('marcas').innerHTML = d.periodos.map(function (p, i) {
        return '<option value="' + i + '" label="' + p.ano + '"></option>';
      }).join('');

      $('nota-acumulado').textContent =
        'Antes do início do monitoramento anual, ' +
        d.acumulado.area.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) +
        ' km² de vegetação nativa já haviam sido suprimidos no bioma em SP (levantamento até 2000).';

      var series = d.periodos.map(function (p) {
        return { ano: p.ano, rotulo: rotuloPeriodo(p), valor: p.area / anosDoPeriodo(p) };
      });

      estado.grafico = new Grafico($('grafico'), series, function (i) {
        pararAnimacao();
        entrarModoPeriodo();
        aplicar(i);
      });

      var alvo = new URLSearchParams(location.search).get('p');
      var idx = d.periodos.length - 1;
      if (alvo) d.periodos.forEach(function (p, i) { if (String(p.ano) === alvo) idx = i; });

      entrarModoGeral();   // primeira imagem vem do cache: instantânea
      aplicar(idx);
      // um link com período explícito já abre no período pedido
      if (alvo) entrarModoPeriodo();
    })
    .catch(function (e) {
      $('periodo-rotulo').textContent = 'Não foi possível carregar os dados.';
      console.error(e);
    });

})();
