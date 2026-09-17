/* =========================================================
   grafico.js — gráfico de barras em SVG, escrito à mão.
   Sem biblioteca: só matemática, escala e <path>.
   ========================================================= */

(function (global) {
  'use strict';

  var L_ESQ = 34, L_DIR = 6, L_TOPO = 18, L_BASE = 26;

  function nice(max) {
    // arredonda o topo da escala para um número "redondo"
    var exp = Math.pow(10, Math.floor(Math.log10(max)));
    var norm = max / exp;
    var passo = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return passo * exp;
  }

  function el(nome, attrs, texto) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', nome);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (texto !== undefined) e.textContent = texto;
    return e;
  }

  function fmt(v) {
    return v >= 100 ? v.toFixed(0)
         : v >= 10  ? v.toFixed(1)
         : v.toFixed(2);
  }

  /**
   * @param {HTMLElement} alvo    contêiner
   * @param {Array} series        [{rotulo, valor, ano}]
   * @param {Function} aoEscolher chamado com o índice clicado
   */
  function Grafico(alvo, series, aoEscolher) {
    this.alvo = alvo;
    this.series = series;
    this.aoEscolher = aoEscolher;
    this.ativo = series.length - 1;
    this.L = 360;
    this.A = 180;
    this.desenhar();
  }

  Grafico.prototype.desenhar = function () {
    var self = this;
    var L = this.L, A = this.A;
    var larguraUtil = L - L_ESQ - L_DIR;
    var alturaUtil = A - L_TOPO - L_BASE;
    var n = this.series.length;
    var passo = larguraUtil / n;
    var larguraBarra = Math.min(passo * 0.68, 22);

    var maxValor = Math.max.apply(null, this.series.map(function (d) { return d.valor; }));
    var topo = nice(maxValor);
    var escala = function (v) { return alturaUtil * (1 - v / topo); };

    var svg = el('svg', {
      viewBox: '0 0 ' + L + ' ' + A,
      role: 'img',
      'aria-label': 'Gráfico de barras: média anual de desmatamento por período PRODES'
    });

    // ---- grade horizontal + rótulos do eixo Y
    var linhas = 4;
    for (var i = 0; i <= linhas; i++) {
      var v = topo * i / linhas;
      var y = L_TOPO + escala(v);
      svg.appendChild(el('line', {
        x1: L_ESQ, y1: y, x2: L - L_DIR, y2: y,
        'class': i === 0 ? 'eixo' : 'grade'
      }));
      svg.appendChild(el('text', {
        x: L_ESQ - 6, y: y + 3, 'text-anchor': 'end', 'class': 'eixo-txt'
      }, v >= 100 ? v.toFixed(0) : v.toFixed(0)));
    }

    // ---- barras
    this.barras = [];
    this.rotulos = [];

    this.series.forEach(function (d, idx) {
      var x = L_ESQ + passo * idx + (passo - larguraBarra) / 2;
      var y = L_TOPO + escala(d.valor);
      var h = Math.max(alturaUtil - escala(d.valor), 1.5);

      var barra = el('rect', {
        x: x.toFixed(2), y: y.toFixed(2),
        width: larguraBarra.toFixed(2), height: h.toFixed(2),
        rx: 2, 'class': 'barra'
      });
      svg.appendChild(barra);

      // área de clique generosa (a barra pode ser fininha)
      var alvoClique = el('rect', {
        x: (L_ESQ + passo * idx).toFixed(2), y: L_TOPO,
        width: passo.toFixed(2), height: alturaUtil,
        'class': 'barra-alvo'
      });
      alvoClique.appendChild(el('title', {}, d.rotulo + ': ' + fmt(d.valor) + ' km²/ano'));
      alvoClique.addEventListener('click', function () { self.aoEscolher(idx); });
      svg.appendChild(alvoClique);

      var rot = el('text', {
        x: (x + larguraBarra / 2).toFixed(2), y: A - L_BASE + 12,
        'text-anchor': 'middle', 'class': 'eixo-txt'
      }, String(d.ano).slice(2));
      svg.appendChild(rot);

      self.barras.push(barra);
      self.rotulos.push(rot);
    });

    // ---- valor da barra ativa
    this.valorTopo = el('text', { 'class': 'valor-topo', 'text-anchor': 'middle' }, '');
    svg.appendChild(this.valorTopo);

    // ---- unidade
    svg.appendChild(el('text', {
      x: L_ESQ - 6, y: 9, 'text-anchor': 'end', 'class': 'eixo-txt'
    }, 'km²'));

    this.alvo.innerHTML = '';
    this.alvo.appendChild(svg);
    this.escala = escala;
    this.passo = passo;
    this.larguraBarra = larguraBarra;
    this.marcar(this.ativo);
  };

  Grafico.prototype.marcar = function (idx) {
    this.ativo = idx;
    for (var i = 0; i < this.barras.length; i++) {
      this.barras[i].classList.toggle('ativa', i === idx);
      this.rotulos[i].classList.toggle('ativa', i === idx);
    }
    var d = this.series[idx];
    var x = L_ESQ + this.passo * idx + this.passo / 2;
    var y = L_TOPO + this.escala(d.valor) - 5;
    this.valorTopo.setAttribute('x', x.toFixed(2));
    this.valorTopo.setAttribute('y', Math.max(y, 10).toFixed(2));
    this.valorTopo.textContent = fmt(d.valor);
  };

  global.Grafico = Grafico;
  global.fmtNum = fmt;
})(window);
