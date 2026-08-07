/* ============================================================
   Gestão Operações — SPA com roteamento por hash
   Rotas: #/  #/contas  #/nova  #/conta/:id  #/venda/:id
   ============================================================ */

const $view = document.getElementById('view');
const $toast = document.getElementById('toast');
const $backdrop = document.getElementById('sheet-backdrop');

// Estado da lista (persiste enquanto navega)
const listaState = { busca: '', status: 'Todas', ordenar: 'recente' };
const farmListaState = { busca: '', status: 'Todas', ordenar: 'recente' };

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout($toast._t);
  $toast._t = setTimeout(() => $toast.classList.remove('show'), 2200);
}

function lucroClass(conta) {
  if (conta.preco_venda == null) return '';
  return conta.lucro >= 0 ? 'pos' : 'neg';
}

// Classe CSS de badge sem espaços (ex.: "Shop aceito" -> "ShopAceito")
function badgeSlug(status) {
  return String(status || '').replace(/\s+/g, '');
}

// Formata porcentagem no padrão pt-BR (ex.: 12,5%). Negativo já vem com '-'.
function fmtPct(v) {
  return Number(v || 0).toFixed(1).replace('.', ',') + '%';
}

/* ============================================================
   ROTEADOR
   ============================================================ */
function router() {
  const hash = location.hash || '#/';
  const parts = hash.slice(2).split('/'); // '#/conta/abc' -> ['conta','abc']
  closeSheet();

  if (hash === '#/' || hash === '#') renderDashboard();
  else if (parts[0] === 'contas') renderLista();
  else if (parts[0] === 'nova') renderCadastro();
  else if (parts[0] === 'backup') renderBackup();
  else if (parts[0] === 'conta' && parts[1]) renderDetalhes(parts[1]);
  else if (parts[0] === 'venda' && parts[1]) renderVenda(parts[1]);
  else if (parts[0] === 'editar' && parts[1]) renderEditarConta(parts[1]);
  else if (parts[0] === 'farm') {
    if (parts[1] === 'lista') renderFarmLista();
    else if (parts[1] === 'nova') renderFarmCadastro();
    else if (parts[1] === 'conta' && parts[2]) renderFarmDetalhes(parts[2]);
    else if (parts[1] === 'venda' && parts[2]) renderFarmVenda(parts[2]);
    else if (parts[1] === 'editar' && parts[2]) renderEditarFarm(parts[2]);
    else if (parts[1] === 'recursos') renderFarmRecursos();
    else renderFarmDashboard();
  }
  else if (parts[0] === 'ofertas') renderOfertas(parts[1]);
  else renderDashboard();

  // Tab ativa (barra enxuta: Início + Backup)
  const tab = (hash === '#/' || hash === '#') ? 'dashboard'
    : (parts[0] === 'backup' ? 'backup' : '');
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab));

  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);

/* ============================================================
   COMPONENTES
   ============================================================ */
function contaItemHTML(c) {
  const inicial = c.username.replace(/^@/, '').charAt(0) || '?';
  const lucroTxt = c.preco_venda == null ? 'Em estoque' : fmtBRL(c.lucro);
  return `
    <a class="conta-item" href="#/conta/${c.id}">
      <div class="avatar">${esc(inicial)}</div>
      <div class="info">
        <div class="username">@${esc(c.username.replace(/^@/, ''))}</div>
        <div class="meta">${esc(c.fornecedor || 'Sem fornecedor')}</div>
        <span class="badge ${esc(c.status)}">${esc(c.status)}</span>
      </div>
      <div class="fin">
        <div class="lucro ${lucroClass(c)}">${lucroTxt}</div>
        <div class="valores">C: ${fmtBRL(c.preco_compra)}${c.preco_venda != null ? ' · V: ' + fmtBRL(c.preco_venda) : ''}</div>
      </div>
    </a>`;
}

function farmItemHTML(f) {
  const inicial = f.username.replace(/^@/, '').charAt(0) || '?';
  const finTxt = f.preco_venda == null ? fmtBRL(f.custo) : fmtBRL(f.lucro);
  const finLabel = f.preco_venda == null
    ? `Custo`
    : `V: ${fmtBRL(f.preco_venda)}`;
  return `
    <a class="conta-item" href="#/farm/conta/${f.id}">
      <div class="avatar">${esc(inicial)}</div>
      <div class="info">
        <div class="username">@${esc(f.username.replace(/^@/, ''))}</div>
        <div class="meta">${esc(f.plataforma || 'Sem plataforma')}</div>
        <span class="badge ${esc(badgeSlug(f.status))}">${esc(f.status)}</span>
      </div>
      <div class="fin">
        <div class="lucro ${f.preco_venda == null ? '' : lucroClass(f)}">${finTxt}</div>
        <div class="valores">${finLabel}</div>
      </div>
    </a>`;
}

function searchHTML(id, placeholder) {
  return `
    <div class="search">
      <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/></svg>
      <input id="${id}" type="search" placeholder="${placeholder}" autocomplete="off">
    </div>`;
}

/* ============================================================
   DASHBOARD GERAL — Centro de Operações  (#/)
   ============================================================ */
const OP_COR = { 'compra-venda': '#007AFF', 'farm': '#34C759', 'ofertas': '#AF52DE' };
const OP_SLUG = { 'Compra/Venda': 'cv', 'Farm': 'farm', 'Ofertas': 'ofertas' };

function opCardHTML(op) {
  const cor = OP_COR[op.id] || '#007AFF';
  let extra = '';
  if (op.id === 'compra-venda') extra = `${op.extra.vendidas} vendida(s) no mês · ${op.extra.estoque} em estoque (${fmtBRL(op.extra.capitalEstoque)})`;
  else if (op.id === 'farm') extra = `${op.extra.vendidas} vendida(s) no mês · ${op.extra.emFarm} em farm (${fmtBRL(op.extra.capitalFarm)})`;
  else if (op.id === 'ofertas') extra = `${op.extra.nichos} nicho(s) · ${op.extra.lancamentosMes} lançamento(s) no mês`;
  return `
    <a class="op-card" href="${op.rota}" style="--op-cor:${cor}">
      <div class="op-head">
        <span class="op-dot"></span>
        <span class="op-name">${esc(op.nome)}</span>
        <span class="op-lucro ${op.lucro >= 0 ? 'pos' : 'neg'}">${fmtBRL(op.lucro)}</span>
      </div>
      <div class="op-metrics">
        <div><span class="m-label">Receita</span><span class="m-val">${fmtBRL(op.receita)}</span></div>
        <div><span class="m-label">Investimento</span><span class="m-val">${fmtBRL(op.investimento)}</span></div>
        <div><span class="m-label">ROI</span><span class="m-val ${op.roi >= 0 ? 'pos' : 'neg'}">${op.investimento > 0 ? fmtPct(op.roi) : '—'}</span></div>
      </div>
      <div class="op-extra">${extra}<span class="op-chevron">›</span></div>
    </a>`;
}

function atividadeItemHTML(a) {
  return `
    <a class="act-item" href="${a.rota}">
      <span class="act-tag act-${OP_SLUG[a.operacao] || 'cv'}">${esc(a.operacao)}</span>
      <div class="act-body">
        <div class="act-evento">${esc(a.evento)}</div>
        ${a.descricao ? `<div class="act-desc">${esc(a.descricao)}</div>` : ''}
      </div>
      <div class="act-when">${fmtDataHora(a.criado_em)}</div>
    </a>`;
}

// Estado do dashboard (persiste enquanto navega): período do card azul e atividade
const PERIODOS = ['mes', '6meses', 'tudo'];
const PERIODO_LABEL = { mes: 'Este mês', '6meses': 'Últimos 6 meses', tudo: 'Tudo (acumulado)' };
const dashState = { periodo: '6meses', atividadeAberta: false };

// Barra de meta anual (lucro do ano / meta) — topo do dashboard
function metaBarHTML() {
  const meta = DB.getMetaAnual();
  const lucroAno = DB.resumoGeral('ano').lucro;
  const pct = meta > 0 ? Math.max(0, Math.min(1, lucroAno / meta)) * 100 : 0;
  const metaTxt = meta > 0 ? compactBRL(meta) : 'definir';
  return `
    <button class="meta-bar ${lucroAno >= 0 ? '' : 'neg'}" id="meta-bar" style="--pct:${pct}%" aria-label="Editar meta do ano">
      <span class="meta-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/></svg></span>
      <span class="meta-track">
        <span class="meta-fill"></span>
        <span class="meta-text">${compactBRL(lucroAno)} / ${metaTxt}</span>
      </span>
      <span class="meta-edit"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></span>
    </button>`;
}

function renderDashboard() {
  const g = DB.resumoGeralPeriodo(dashState.periodo);
  const ops = DB.resumosOperacoes('mes'); // cards de operação = mês atual
  const atividade = DB.atividadeRecente(12);
  const aberta = dashState.atividadeAberta;
  const mostradas = aberta ? atividade : atividade.slice(0, 1);

  $view.innerHTML = `
    ${metaBarHTML()}
    <div class="page-head">
      <h1>Centro de Operações</h1>
      <div class="subtitle">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    </div>

    <div class="geral-card">
      <div class="geral-period">
        <button class="gp-arrow" id="periodo-prev" aria-label="Período anterior">‹</button>
        <span class="gp-label">${PERIODO_LABEL[dashState.periodo]}</span>
        <button class="gp-arrow" id="periodo-next" aria-label="Próximo período">›</button>
      </div>
      <div class="geral-top">
        <span class="geral-label">Lucro</span>
        <span class="geral-roi ${g.roi >= 0 ? 'pos' : 'neg'}">ROI ${g.investimento > 0 ? fmtPct(g.roi) : '—'}</span>
      </div>
      <div class="geral-lucro ${g.lucro >= 0 ? 'pos' : 'neg'}">${fmtBRL(g.lucro)}</div>
      <div class="geral-metrics">
        <div><span>Receita</span><b>${fmtBRL(g.receita)}</b></div>
        <div><span>Investimento</span><b>${fmtBRL(g.investimento)}</b></div>
      </div>
    </div>

    <div class="section-row">
      <h2>Operações</h2>
      <span class="sec-note">este mês</span>
    </div>
    <div class="op-list">
      ${ops.map(opCardHTML).join('')}
    </div>

    <h2>Evolução mensal</h2>
    <div class="card chart-card">
      <div class="chart-legend" id="chart-legend"></div>
      <div class="chart-sub">Últimos 6 meses · lucro por operação · toque em um mês</div>
      <div class="chart-wrap" id="chart-wrap"></div>
    </div>

    <h2>Atividade recente</h2>
    <div class="card activity">
      ${atividade.length
        ? mostradas.map(atividadeItemHTML).join('')
        : `<div class="empty" style="padding:24px;"><p>Nada por aqui ainda.<br>Suas ações vão aparecer nesta lista.</p></div>`}
    </div>
    ${atividade.length > 1
      ? `<button class="ver-mais" id="toggle-atividade">${aberta ? 'Ver menos' : 'Ver mais (' + (atividade.length - 1) + ')'}<span class="vm-arrow ${aberta ? 'up' : ''}">⌄</span></button>`
      : ''}
  `;

  const cicla = dir => {
    const i = PERIODOS.indexOf(dashState.periodo);
    dashState.periodo = PERIODOS[(i + dir + PERIODOS.length) % PERIODOS.length];
    renderDashboard();
  };
  document.getElementById('periodo-prev').addEventListener('click', () => cicla(-1));
  document.getElementById('periodo-next').addEventListener('click', () => cicla(1));

  const $ta = document.getElementById('toggle-atividade');
  if ($ta) $ta.addEventListener('click', () => { dashState.atividadeAberta = !dashState.atividadeAberta; renderDashboard(); });

  // Editar meta do ano
  document.getElementById('meta-bar').addEventListener('click', () => {
    openSheet(`
      <h3>Meta de lucro do ano</h3>
      <div class="form-group">
        <label>Meta anual (R$)</label>
        <input id="inp-meta" type="number" inputmode="decimal" step="0.01" min="0" value="${DB.getMetaAnual() || ''}" placeholder="0,00">
      </div>
      <button class="btn btn-primary" id="save-meta">Salvar meta</button>
      <button class="btn btn-secondary" id="cancel-meta">Cancelar</button>
    `, sheet => {
      const inp = sheet.querySelector('#inp-meta');
      setTimeout(() => inp.focus(), 50);
      sheet.querySelector('#save-meta').addEventListener('click', () => {
        try {
          DB.setMetaAnual(inp.value);
          closeSheet();
          toast('Meta salva ✓');
          renderDashboard();
        } catch (err) { toast(err.message); }
      });
      sheet.querySelector('#cancel-meta').addEventListener('click', closeSheet);
    });
  });

  renderChartOperacoes(
    document.getElementById('chart-wrap'),
    document.getElementById('chart-legend'),
    DB.evolucaoMensal(6)
  );
}

/* ---------- Gráfico de evolução mensal por operação (barras agrupadas) ---------- */
const OPS_SERIES = [
  { key: 'compraVenda', label: 'Compra/Venda', cor: '#007AFF' },
  { key: 'farm',        label: 'Farm',         cor: '#34C759' },
  { key: 'ofertas',     label: 'Ofertas',      cor: '#AF52DE' },
];

function renderChartOperacoes(container, legendEl, meses) {
  if (legendEl) {
    legendEl.innerHTML = OPS_SERIES.map(s =>
      `<span class="leg"><span class="leg-dot" style="background:${s.cor}"></span>${s.label}</span>`).join('');
  }

  const W = 340, H = 190;
  const pad = { top: 16, right: 8, bottom: 26, left: 46 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const todos = [];
  meses.forEach(m => OPS_SERIES.forEach(s => todos.push(m[s.key])));
  let max = Math.max(0, ...todos);
  let min = Math.min(0, ...todos);
  if (max === 0 && min === 0) max = 100;
  const range = max - min;
  const step = niceStep(range / 3);
  max = Math.ceil(max / step) * step;
  min = Math.floor(min / step) * step;

  const y = v => pad.top + plotH * (1 - (v - min) / (max - min));
  const slot = plotW / meses.length;
  const groupW = Math.min(slot * 0.72, 42);
  const barW = groupW / OPS_SERIES.length;
  const y0 = y(0);

  let grid = '', labels = '', bars = '', hits = '';
  for (let v = min; v <= max + 1e-6; v += step) {
    grid += `<line x1="${pad.left}" x2="${W - pad.right}" y1="${y(v)}" y2="${y(v)}" stroke="#E5E5EA" stroke-width="1"/>`;
    labels += `<text x="${pad.left - 6}" y="${y(v) + 3.5}" text-anchor="end" font-size="9" fill="#AEAEB2">${compactBRL(v)}</text>`;
  }
  meses.forEach((m, i) => {
    const gx = pad.left + slot * i + (slot - groupW) / 2;
    OPS_SERIES.forEach((s, j) => {
      const val = m[s.key];
      const x = gx + barW * j;
      const yV = y(val);
      const top = Math.min(y0, yV);
      const h = Math.abs(y0 - yV);
      const w = barW - 2;
      if (h < 1) {
        bars += `<rect x="${x}" y="${y0 - 1}" width="${w}" height="2" rx="1" fill="#E5E5EA"/>`;
      } else {
        const r = Math.min(2.5, w / 2, h);
        bars += `<rect x="${x}" y="${top}" width="${w}" height="${h}" rx="${r}" fill="${s.cor}"/>`;
      }
    });
    labels += `<text x="${pad.left + slot * i + slot / 2}" y="${H - 9}" text-anchor="middle" font-size="9.5" fill="#6E6E73">${MESES_ABREV[m.mes]}</text>`;
    hits += `<rect class="grp" data-i="${i}" x="${pad.left + slot * i}" y="${pad.top}" width="${slot}" height="${plotH}" fill="transparent"/>`;
  });

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução mensal do lucro por operação">
      ${grid}
      <line x1="${pad.left}" x2="${W - pad.right}" y1="${y0}" y2="${y0}" stroke="#AEAEB2" stroke-width="1"/>
      ${labels}
      ${bars}
      ${hits}
    </svg>
    <div class="chart-tooltip chart-tooltip-multi" id="chart-tt"></div>`;

  const tt = container.querySelector('#chart-tt');
  const svg = container.querySelector('svg');
  container.querySelectorAll('.grp').forEach(gEl => {
    const show = () => {
      const i = Number(gEl.dataset.i);
      const m = meses[i];
      tt.innerHTML =
        `<div class="tt-title">${MESES_ABREV[m.mes]}/${String(m.ano).slice(2)}</div>` +
        OPS_SERIES.map(s => `<div class="tt-row"><span class="leg-dot" style="background:${s.cor}"></span>${s.label} <b>${fmtBRL(m[s.key])}</b></div>`).join('') +
        `<div class="tt-row tt-geral">Geral <b>${fmtBRL(m.geral)}</b></div>`;
      const rect = svg.getBoundingClientRect();
      const scale = rect.width / W;
      const cx = (pad.left + slot * i + slot / 2) * scale;
      tt.style.left = Math.max(60, Math.min(rect.width - 60, cx)) + 'px';
      tt.style.top = (pad.top * scale + 4) + 'px';
      tt.classList.add('show');
    };
    gEl.addEventListener('pointerenter', show);
    gEl.addEventListener('pointerdown', show);
    gEl.addEventListener('pointerleave', () => tt.classList.remove('show'));
  });
}

/* ---------- Gráfico de lucro mensal (SVG) ---------- */
const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function renderChart(container, meses) {
  const W = 320, H = 170;
  const pad = { top: 14, right: 8, bottom: 24, left: 44 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const valores = meses.map(m => m.valor);
  let max = Math.max(0, ...valores);
  let min = Math.min(0, ...valores);
  if (max === 0 && min === 0) max = 100; // escala mínima quando tudo é zero

  // Ticks "redondos"
  const range = max - min;
  const step = niceStep(range / 3);
  max = Math.ceil(max / step) * step;
  min = Math.floor(min / step) * step;

  const y = v => pad.top + plotH * (1 - (v - min) / (max - min));
  const slot = plotW / meses.length;
  const barW = Math.min(24, slot * 0.55);

  let grid = '', labels = '', bars = '';
  for (let v = min; v <= max; v += step) {
    grid += `<line x1="${pad.left}" x2="${W - pad.right}" y1="${y(v)}" y2="${y(v)}" stroke="#E5E5EA" stroke-width="1"/>`;
    labels += `<text x="${pad.left - 6}" y="${y(v) + 3.5}" text-anchor="end" font-size="9" fill="#AEAEB2">${compactBRL(v)}</text>`;
  }

  const maxIdx = valores.indexOf(Math.max(...valores));
  meses.forEach((m, i) => {
    const cx = pad.left + slot * i + slot / 2;
    const x = cx - barW / 2;
    const y0 = y(0);
    const yV = y(m.valor);
    const hBar = Math.abs(y0 - yV);
    const cor = m.valor >= 0 ? '#007AFF' : '#FF3B30';
    const top = Math.min(y0, yV);
    const r = Math.min(4, hBar); // ponta arredondada no extremo do dado, reta na base
    let path;
    if (hBar < 1) {
      path = `<rect x="${x}" y="${y0 - 1.5}" width="${barW}" height="3" rx="1.5" fill="#E5E5EA"/>`;
    } else if (m.valor >= 0) {
      path = `<path d="M${x},${y0} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + barW - r},${top} Q${x + barW},${top} ${x + barW},${top + r} L${x + barW},${y0} Z" fill="${cor}"/>`;
    } else {
      const bot = y0 + hBar;
      path = `<path d="M${x},${y0} L${x + barW},${y0} L${x + barW},${bot - r} Q${x + barW},${bot} ${x + barW - r},${bot} L${x + r},${bot} Q${x},${bot} ${x},${bot - r} Z" fill="${cor}"/>`;
    }
    // Rótulo direto apenas no maior valor (rotulagem seletiva)
    let valueLabel = '';
    if (i === maxIdx && m.valor > 0) {
      valueLabel = `<text x="${cx}" y="${yV - 6}" text-anchor="middle" font-size="9.5" font-weight="600" fill="#1D1D1F">${compactBRL(m.valor)}</text>`;
    }
    bars += `
      <g class="bar-g" data-i="${i}">
        <rect x="${pad.left + slot * i}" y="${pad.top}" width="${slot}" height="${plotH}" fill="transparent"/>
        ${path}
        ${valueLabel}
        <text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="9.5" fill="#6E6E73">${MESES_ABREV[m.mes]}</text>
      </g>`;
  });

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de barras do lucro mensal dos últimos 6 meses">
      ${grid}
      <line x1="${pad.left}" x2="${W - pad.right}" y1="${y(0)}" y2="${y(0)}" stroke="#AEAEB2" stroke-width="1"/>
      ${labels}
      ${bars}
    </svg>
    <div class="chart-tooltip" id="chart-tt"><span class="tt-mes"></span> · <span class="tt-val"></span></div>`;

  // Tooltip por barra (toque/hover)
  const tt = container.querySelector('#chart-tt');
  const svg = container.querySelector('svg');
  container.querySelectorAll('.bar-g').forEach(g => {
    const show = () => {
      const i = Number(g.dataset.i);
      const m = meses[i];
      tt.querySelector('.tt-mes').textContent = MESES_ABREV[m.mes] + '/' + String(m.ano).slice(2);
      tt.querySelector('.tt-val').textContent = fmtBRL(m.valor);
      const rect = svg.getBoundingClientRect();
      const scale = rect.width / W;
      const cx = (pad.left + slot * i + slot / 2) * scale;
      const cy = y(Math.max(0, m.valor)) * scale;
      tt.style.left = cx + 'px';
      tt.style.top = cy + 'px';
      tt.classList.add('show');
    };
    g.addEventListener('pointerenter', show);
    g.addEventListener('pointerdown', show);
    g.addEventListener('pointerleave', () => tt.classList.remove('show'));
  });
}

function niceStep(raw) {
  if (raw <= 0) return 100;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  if (n <= 1) return pow;
  if (n <= 2) return 2 * pow;
  if (n <= 5) return 5 * pow;
  return 10 * pow;
}

function compactBRL(v) {
  const abs = Math.abs(v);
  const sinal = v < 0 ? '-' : '';
  if (abs >= 1000000) return sinal + 'R$' + (abs / 1000000).toFixed(1).replace('.', ',') + 'M';
  if (abs >= 1000) return sinal + 'R$' + (abs / 1000).toFixed(abs >= 10000 ? 0 : 1).replace('.', ',').replace(',0', '') + 'k';
  return sinal + 'R$' + Math.round(abs);
}

/* ============================================================
   LISTA DE CONTAS  (#/contas)
   ============================================================ */
function renderLista() {
  const statusList = ['Todas', ...DB.STATUS];

  $view.innerHTML = `
    <a class="back-link" href="#/">
      <svg viewBox="0 0 12 12"><path d="M8 1L3 6l5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
      Início
    </a>
    <div class="page-head">
      <div class="page-head-row">
        <div><h1>Contas</h1></div>
        <a class="btn-small" href="#/nova">+ Nova conta</a>
      </div>
    </div>
    ${searchHTML('lista-search', 'Pesquisar username ou fornecedor')}
    <div class="chips" id="chips">
      ${statusList.map(s => `<button class="chip ${listaState.status === s ? 'active' : ''}" data-status="${s}">${s}</button>`).join('')}
    </div>
    <div class="sort-row">
      <span id="count"></span>
      <label>Ordenar:
        <select id="ordenar">
          <option value="recente">Mais recente</option>
          <option value="antiga">Mais antiga</option>
          <option value="maior-lucro">Maior lucro</option>
          <option value="menor-lucro">Menor lucro</option>
        </select>
      </label>
    </div>
    <div class="conta-list" id="lista"></div>
  `;

  const $busca = document.getElementById('lista-search');
  const $ordenar = document.getElementById('ordenar');
  $busca.value = listaState.busca;
  $ordenar.value = listaState.ordenar;

  function refresh() {
    const contas = DB.listarContas(listaState);
    document.getElementById('count').textContent =
      contas.length + (contas.length === 1 ? ' conta' : ' contas');
    document.getElementById('lista').innerHTML = contas.length
      ? contas.map(contaItemHTML).join('')
      : `<div class="card empty"><p>Nenhuma conta encontrada.</p></div>`;
  }

  $busca.addEventListener('input', () => { listaState.busca = $busca.value; refresh(); });
  $ordenar.addEventListener('change', () => { listaState.ordenar = $ordenar.value; refresh(); });
  document.getElementById('chips').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    listaState.status = chip.dataset.status;
    document.querySelectorAll('.chip').forEach(c =>
      c.classList.toggle('active', c.dataset.status === listaState.status));
    refresh();
  });

  refresh();
}

/* ============================================================
   CADASTRO  (#/nova)
   ============================================================ */
function renderCadastro() {
  $view.innerHTML = `
    <a class="back-link" href="#/">
      <svg viewBox="0 0 12 12"><path d="M8 1L3 6l5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
      Voltar
    </a>
    <div class="page-head"><h1>Nova conta</h1></div>

    <form id="form-conta" novalidate>
      <div class="form-group">
        <label>Username <span class="req">*</span></label>
        <input name="username" type="text" placeholder="@usuario" autocapitalize="none" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Email</label>
        <input name="email" type="email" placeholder="email@exemplo.com" autocapitalize="none" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Senha</label>
        <input name="senha" type="text" placeholder="Senha da conta" autocapitalize="none" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Nome do fornecedor <span class="req">*</span></label>
        <input name="fornecedor" type="text" placeholder="Quem vendeu a conta">
      </div>
      <div class="form-group">
        <label>Valor da compra (R$) <span class="req">*</span></label>
        <input name="preco_compra" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0,00">
      </div>
      <div class="form-group">
        <label>Status</label>
        <div class="select-wrap">
          <select name="status">
            ${DB.STATUS.filter(s => s !== 'Vendida').map(s => `<option value="${s}">${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Observações</label>
        <textarea name="observacoes" placeholder="Anotações sobre a conta"></textarea>
      </div>
      <div class="form-error" id="form-error"></div>
      <button class="btn btn-primary" type="submit">Cadastrar conta</button>
    </form>
  `;

  document.getElementById('form-conta').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const conta = DB.criarConta({
        username: f.get('username'),
        email: f.get('email'),
        senha: f.get('senha'),
        fornecedor: f.get('fornecedor'),
        preco_compra: f.get('preco_compra'),
        status: f.get('status'),
        observacoes: f.get('observacoes'),
      });
      toast('Conta cadastrada ✓');
      location.hash = '#/conta/' + conta.id;
    } catch (err) {
      const $err = document.getElementById('form-error');
      $err.textContent = err.message;
      $err.classList.add('show');
    }
  });
}

/* ============================================================
   DETALHES  (#/conta/:id)
   ============================================================ */
function renderDetalhes(id) {
  const c = DB.getConta(id);
  if (!c) {
    $view.innerHTML = `<div class="card empty"><p>Conta não encontrada.</p></div>`;
    return;
  }
  const hist = DB.historicoDaConta(id);
  const vendida = c.preco_venda != null;

  $view.innerHTML = `
    <a class="back-link" href="#/contas">
      <svg viewBox="0 0 12 12"><path d="M8 1L3 6l5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
      Contas
    </a>
    <div class="page-head">
      <div class="page-head-row">
        <div>
          <h1>@${esc(c.username.replace(/^@/, ''))}</h1>
          <span class="badge ${esc(c.status)}">${esc(c.status)}</span>
        </div>
        <button class="btn-small" id="btn-status">Alterar status</button>
      </div>
    </div>

    <h2>Dados da conta</h2>
    <div class="card detail-rows">
      <div class="detail-row"><span class="k">Username</span><span class="v">@${esc(c.username.replace(/^@/, ''))}</span></div>
      <div class="detail-row"><span class="k">Email</span><span class="v">${esc(c.email) || '—'}</span></div>
      <div class="detail-row">
        <span class="k">Senha</span>
        <span class="v">
          <span id="senha-v">${c.senha ? '••••••••' : '—'}</span>
          ${c.senha ? '<button class="senha-toggle" id="senha-toggle">mostrar</button>' : ''}
        </span>
      </div>
    </div>

    <h2>Financeiro</h2>
    <div class="card detail-rows">
      <div class="detail-row"><span class="k">Compra</span><span class="v">${fmtBRL(c.preco_compra)}</span></div>
      <div class="detail-row"><span class="k">Data da compra</span><span class="v">${fmtData(c.data_compra)}</span></div>
      <div class="detail-row"><span class="k">Venda</span><span class="v">${vendida ? fmtBRL(c.preco_venda) : 'Não vendida'}</span></div>
      <div class="detail-row"><span class="k">Data da venda</span><span class="v">${fmtData(c.data_venda)}</span></div>
      <div class="detail-row"><span class="k">Lucro</span><span class="v ${vendida ? lucroClass(c) : ''}">${fmtBRL(c.lucro)}</span></div>
    </div>

    <h2>Fornecedor</h2>
    <div class="card detail-rows">
      <div class="detail-row"><span class="k">Nome</span><span class="v">${esc(c.fornecedor) || '—'}</span></div>
    </div>

    ${c.observacoes ? `
      <h2>Observações</h2>
      <div class="card"><p style="font-size:14px;color:var(--ink-2);white-space:pre-wrap;">${esc(c.observacoes)}</p></div>` : ''}

    <h2>Histórico</h2>
    <div class="card">
      <div class="timeline">
        ${hist.map(h => `
          <div class="tl-item">
            <div class="evento">${esc(h.evento)}</div>
            ${h.descricao ? `<div class="descricao">${esc(h.descricao)}</div>` : ''}
            <div class="quando">${fmtDataHora(h.criado_em)}</div>
          </div>`).join('')}
      </div>
    </div>

    <div style="margin-top:24px;">
      ${!vendida ? `<a class="btn btn-success" href="#/venda/${c.id}">Registrar venda</a>` : ''}
      <a class="btn btn-secondary" href="#/editar/${c.id}">Editar dados</a>
      ${vendida ? `<button class="btn btn-secondary" id="btn-cancelar-venda">Cancelar venda</button>` : ''}
      <button class="btn btn-danger-ghost" id="btn-excluir">Excluir conta</button>
    </div>
  `;

  // Mostrar/ocultar senha
  const $tg = document.getElementById('senha-toggle');
  if ($tg) {
    let visivel = false;
    $tg.addEventListener('click', () => {
      visivel = !visivel;
      document.getElementById('senha-v').textContent = visivel ? c.senha : '••••••••';
      $tg.textContent = visivel ? 'ocultar' : 'mostrar';
    });
  }

  // Cancelar venda (comprador desistiu): desfaz o financeiro e volta ao estoque
  const $cancelar = document.getElementById('btn-cancelar-venda');
  if ($cancelar) {
    $cancelar.addEventListener('click', () => {
      if (confirm(`Cancelar a venda de @${c.username.replace(/^@/, '')}? O lucro será zerado e a conta volta para "Comprada".`)) {
        try {
          DB.cancelarVenda(id);
          toast('Venda cancelada ✓');
          renderDetalhes(id);
        } catch (err) { toast(err.message); }
      }
    });
  }

  // Alterar status (sheet)
  document.getElementById('btn-status').addEventListener('click', () => {
    openSheet(`
      <h3>Alterar status</h3>
      <div class="opts">
        ${DB.STATUS.map(s => `
          <button class="opt" data-status="${s}">
            <span>${s}</span>
            ${s === c.status ? '<span class="check">✓</span>' : ''}
          </button>`).join('')}
      </div>
      <button class="btn btn-secondary" id="sheet-cancel">Cancelar</button>
    `, sheet => {
      sheet.querySelectorAll('.opt').forEach(btn => {
        btn.addEventListener('click', () => {
          try {
            DB.alterarStatus(id, btn.dataset.status);
            closeSheet();
            toast('Status atualizado ✓');
            renderDetalhes(id);
          } catch (err) { toast(err.message); }
        });
      });
      sheet.querySelector('#sheet-cancel').addEventListener('click', closeSheet);
    });
  });

  // Excluir
  document.getElementById('btn-excluir').addEventListener('click', () => {
    if (confirm(`Excluir a conta @${c.username.replace(/^@/, '')}? Essa ação não pode ser desfeita.`)) {
      DB.excluirConta(id);
      toast('Conta excluída');
      location.hash = '#/contas';
    }
  });
}

/* ============================================================
   VENDA  (#/venda/:id)
   ============================================================ */
function renderVenda(id) {
  const c = DB.getConta(id);
  if (!c) { location.hash = '#/contas'; return; }
  if (c.preco_venda != null) { location.hash = '#/conta/' + id; return; }

  const hoje = new Date();
  const hojeStr = hoje.getFullYear() + '-' +
    String(hoje.getMonth() + 1).padStart(2, '0') + '-' +
    String(hoje.getDate()).padStart(2, '0');

  $view.innerHTML = `
    <a class="back-link" href="#/conta/${id}">
      <svg viewBox="0 0 12 12"><path d="M8 1L3 6l5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
      Voltar
    </a>
    <div class="page-head">
      <h1>Registrar venda</h1>
      <div class="subtitle">@${esc(c.username.replace(/^@/, ''))} · compra de ${fmtBRL(c.preco_compra)}</div>
    </div>

    <form id="form-venda" novalidate>
      <div class="form-group">
        <label>Valor da venda (R$) <span class="req">*</span></label>
        <input name="preco_venda" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0,00">
      </div>
      <div class="form-group">
        <label>Data da venda</label>
        <input name="data_venda" type="date" value="${hojeStr}">
      </div>
      <div class="form-group">
        <label>Observações</label>
        <textarea name="observacoes" placeholder="Anotações sobre a venda"></textarea>
      </div>
      <div class="card" style="margin-bottom:14px;">
        <div class="detail-row" style="border:none;padding:4px 0;">
          <span class="k">Lucro estimado</span>
          <span class="v" id="lucro-preview">R$ 0,00</span>
        </div>
      </div>
      <div class="form-error" id="form-error"></div>
      <button class="btn btn-success" type="submit">Confirmar venda</button>
    </form>
  `;

  const $preco = document.querySelector('[name=preco_venda]');
  const $preview = document.getElementById('lucro-preview');
  $preco.addEventListener('input', () => {
    const lucro = Number($preco.value || 0) - Number(c.preco_compra || 0);
    $preview.textContent = fmtBRL(lucro);
    $preview.className = 'v ' + (lucro >= 0 ? 'pos' : 'neg');
  });

  document.getElementById('form-venda').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      let dataVenda = null;
      if (f.get('data_venda')) {
        // Mantém a hora atual junto da data escolhida
        const [a, m, d] = f.get('data_venda').split('-').map(Number);
        const agora = new Date();
        dataVenda = new Date(a, m - 1, d, agora.getHours(), agora.getMinutes()).toISOString();
      }
      DB.registrarVenda(id, {
        preco_venda: f.get('preco_venda'),
        data_venda: dataVenda,
        observacoes: f.get('observacoes'),
      });
      toast('Venda registrada ✓');
      location.hash = '#/conta/' + id;
    } catch (err) {
      const $err = document.getElementById('form-error');
      $err.textContent = err.message;
      $err.classList.add('show');
    }
  });
}

/* ============================================================
   BACKUP  (#/backup)
   ============================================================ */
function renderBackup() {
  const t = DB.totais();
  const ultimo = localStorage.getItem('gestao-op-ultimo-backup');

  $view.innerHTML = `
    <a class="back-link" href="#/">
      <svg viewBox="0 0 12 12"><path d="M8 1L3 6l5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
      Voltar
    </a>
    <div class="page-head">
      <h1>Backup</h1>
      <div class="subtitle">Seus dados ficam salvos apenas neste aparelho. Exporte um backup de vez em quando para não perder nada.</div>
    </div>

    <div class="card detail-rows">
      <div class="detail-row"><span class="k">Contas</span><span class="v">${t.contas}</span></div>
      <div class="detail-row"><span class="k">Contas em farm</span><span class="v">${t.farm}</span></div>
      <div class="detail-row"><span class="k">Meses de ofertas</span><span class="v">${t.ofertas}</span></div>
      <div class="detail-row"><span class="k">Eventos de histórico</span><span class="v">${t.eventos + t.farmEventos + t.ofertasEventos}</span></div>
      <div class="detail-row"><span class="k">Último backup</span><span class="v">${ultimo ? fmtDataHora(ultimo) : 'Nunca'}</span></div>
    </div>

    <h2>Salvar backup</h2>
    <div class="card" style="margin-bottom:10px;">
      <p style="font-size:13px;color:var(--ink-2);margin-bottom:12px;">
        Gera um arquivo com todas as contas e o histórico. No iPhone, escolha
        <strong>Salvar em Arquivos</strong> (iCloud) ou envie para o WhatsApp/email.
      </p>
      <button class="btn btn-primary" id="btn-exportar">Exportar backup</button>
    </div>

    <h2>Restaurar backup</h2>
    <div class="card">
      <p style="font-size:13px;color:var(--ink-2);margin-bottom:12px;">
        Escolha um arquivo de backup exportado antes.
        <strong>Atenção:</strong> substitui todos os dados atuais do app.
      </p>
      <input type="file" id="arquivo-backup" accept=".json,application/json,text/plain" style="display:none;">
      <button class="btn btn-secondary" id="btn-importar">Importar backup</button>
    </div>
  `;

  document.getElementById('btn-exportar').addEventListener('click', async () => {
    const json = DB.exportar();
    const nome = 'gestao-op-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    const arquivo = new File([json], nome, { type: 'application/json' });
    let ok = false;
    // iOS: folha de compartilhamento (Arquivos, WhatsApp, email…)
    if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
      try {
        await navigator.share({ files: [arquivo], title: 'Backup Gestão Op' });
        ok = true;
      } catch (e) {
        if (e.name === 'AbortError') return; // usuário cancelou
      }
    }
    if (!ok) {
      // Fallback: download direto
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    localStorage.setItem('gestao-op-ultimo-backup', new Date().toISOString());
    toast('Backup exportado ✓');
    renderBackup();
  });

  const $arquivo = document.getElementById('arquivo-backup');
  document.getElementById('btn-importar').addEventListener('click', () => $arquivo.click());
  $arquivo.addEventListener('change', () => {
    const f = $arquivo.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        if (!confirm('Restaurar este backup? Os dados atuais do app serão substituídos.')) return;
        const r = DB.importar(reader.result);
        toast(`Backup restaurado: ${r.contas} contas ✓`);
        renderBackup();
      } catch (err) {
        alert(err.message);
      }
    };
    reader.readAsText(f);
  });
}

/* ============================================================
   FARM — DASHBOARD  (#/farm)
   ============================================================ */
function renderFarmDashboard() {
  const ind = DB.indicadoresFarm();
  const ultimas = DB.listarFarm().slice(0, 4);

  $view.innerHTML = `
    <a class="back-link" href="#/">
      <svg viewBox="0 0 12 12"><path d="M8 1L3 6l5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
      Início
    </a>
    <div class="page-head">
      <div class="page-head-row">
        <div>
          <h1>Farm</h1>
          <div class="subtitle">Contas em criação e aquecimento</div>
        </div>
        <a class="btn-small" href="#/farm/nova">+ Nova conta</a>
      </div>
    </div>

    ${searchHTML('farm-search', 'Pesquisar username ou plataforma')}

    <a class="recurso-link" href="#/farm/recursos">
      <span class="rl-left"><svg class="rl-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>Recursos compartilhados (proxies)</span>
      <span class="op-chevron">›</span>
    </a>

    <div class="stats-grid">
      <div class="stat wide">
        <div class="label">Lucro do farm</div>
        <div class="value ${ind.lucro >= 0 ? 'pos' : 'neg'}">${fmtBRL(ind.lucro)}</div>
        <div class="sub">${ind.vendidas} ${ind.vendidas === 1 ? 'conta vendida' : 'contas vendidas'}</div>
      </div>
      <div class="stat">
        <div class="label">Custo investido</div>
        <div class="value">${fmtBRL(ind.investido)}</div>
      </div>
      <div class="stat">
        <div class="label">Receita</div>
        <div class="value">${fmtBRL(ind.receita)}</div>
      </div>
      <div class="stat">
        <div class="label">Em farm agora</div>
        <div class="value">${ind.ativas}</div>
        <div class="sub">${ind.total} no total</div>
      </div>
      <div class="stat">
        <div class="label">Vendidas</div>
        <div class="value">${ind.vendidas}</div>
      </div>
    </div>

    <h2>Por estágio</h2>
    <div class="card detail-rows">
      ${DB.FARM_STATUS.map(s => `
        <div class="detail-row">
          <span class="k"><span class="badge ${esc(badgeSlug(s))}">${esc(s)}</span></span>
          <span class="v">${ind.porEstagio[s] || 0}</span>
        </div>`).join('')}
    </div>

    <div class="section-row">
      <h2>Últimas em farm</h2>
      <a href="#/farm/lista">Ver todas</a>
    </div>
    <div class="conta-list">
      ${ultimas.length
        ? ultimas.map(farmItemHTML).join('')
        : `<div class="card empty"><p>Nenhuma conta em farm ainda.<br>Toque em <strong>+ Nova conta</strong> para começar.</p></div>`}
    </div>
  `;

  const input = document.getElementById('farm-search');
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && input.value.trim()) {
      farmListaState.busca = input.value.trim();
      location.hash = '#/farm/lista';
    }
  });
}

/* ============================================================
   FARM — LISTA  (#/farm/lista)
   ============================================================ */
function renderFarmLista() {
  const statusList = ['Todas', ...DB.FARM_STATUS];

  $view.innerHTML = `
    <a class="back-link" href="#/farm">
      <svg viewBox="0 0 12 12"><path d="M8 1L3 6l5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
      Farm
    </a>
    <div class="page-head">
      <h1>Contas em farm</h1>
    </div>
    ${searchHTML('farm-lista-search', 'Pesquisar username ou plataforma')}
    <div class="chips" id="farm-chips">
      ${statusList.map(s => `<button class="chip ${farmListaState.status === s ? 'active' : ''}" data-status="${esc(s)}">${esc(s)}</button>`).join('')}
    </div>
    <div class="sort-row">
      <span id="farm-count"></span>
      <label>Ordenar:
        <select id="farm-ordenar">
          <option value="recente">Mais recente</option>
          <option value="antiga">Mais antiga</option>
          <option value="maior-lucro">Maior lucro</option>
          <option value="menor-lucro">Menor lucro</option>
        </select>
      </label>
    </div>
    <div class="conta-list" id="farm-lista"></div>
  `;

  const $busca = document.getElementById('farm-lista-search');
  const $ordenar = document.getElementById('farm-ordenar');
  $busca.value = farmListaState.busca;
  $ordenar.value = farmListaState.ordenar;

  function refresh() {
    const lista = DB.listarFarm(farmListaState);
    document.getElementById('farm-count').textContent =
      lista.length + (lista.length === 1 ? ' conta' : ' contas');
    document.getElementById('farm-lista').innerHTML = lista.length
      ? lista.map(farmItemHTML).join('')
      : `<div class="card empty"><p>Nenhuma conta encontrada.</p></div>`;
  }

  $busca.addEventListener('input', () => { farmListaState.busca = $busca.value; refresh(); });
  $ordenar.addEventListener('change', () => { farmListaState.ordenar = $ordenar.value; refresh(); });
  document.getElementById('farm-chips').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    farmListaState.status = chip.dataset.status;
    document.querySelectorAll('#farm-chips .chip').forEach(c =>
      c.classList.toggle('active', c.dataset.status === farmListaState.status));
    refresh();
  });

  refresh();
}

/* ============================================================
   FARM — CADASTRO  (#/farm/nova)
   ============================================================ */
// Checkboxes dos recursos (proxies) para vincular numa conta de farm
function recursosCheckboxesHTML(selecionados) {
  const recursos = DB.listarRecursosFarm();
  if (!recursos.length) {
    return `<p style="font-size:13px;color:var(--ink-2);">Nenhum recurso criado ainda. <a href="#/farm/recursos" style="color:var(--primary);font-weight:600;">Criar recurso (proxy)</a></p>`;
  }
  return `<div class="rec-checks">` + recursos.map(r => {
    const n = DB.contasDoRecurso(r.id);
    const checked = selecionados.includes(r.id);
    return `
      <label class="rec-check">
        <input type="checkbox" name="recurso" value="${r.id}" ${checked ? 'checked' : ''}>
        <span class="rec-check-nome">${esc(r.nome)}</span>
        <span class="rec-check-info">${fmtBRL(r.custo_total)} · ${n} conta(s)</span>
      </label>`;
  }).join('') + `</div>`;
}

function renderFarmCadastro() {
  $view.innerHTML = `
    <a class="back-link" href="#/farm">
      <svg viewBox="0 0 12 12"><path d="M8 1L3 6l5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
      Voltar
    </a>
    <div class="page-head"><h1>Nova conta em farm</h1></div>

    <form id="form-farm" novalidate>
      <div class="form-group">
        <label>Username <span class="req">*</span></label>
        <input name="username" type="text" placeholder="@usuario" autocapitalize="none" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Plataforma / tipo</label>
        <input name="plataforma" type="text" placeholder="Instagram, TikTok, jogo…">
      </div>
      <div class="form-group">
        <label>Email</label>
        <input name="email" type="email" placeholder="email@exemplo.com" autocapitalize="none" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Senha</label>
        <input name="senha" type="text" placeholder="Senha da conta" autocapitalize="none" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Custo de aquisição (R$)</label>
        <input name="custo_proprio" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0,00">
        <div class="field-hint">Quanto você pagou pela conta em si.</div>
      </div>
      <div class="form-group">
        <label>Recursos compartilhados (proxies)</label>
        ${recursosCheckboxesHTML([])}
        <div class="field-hint">O custo de cada recurso é dividido entre as contas que o usam.</div>
      </div>
      <div class="form-group">
        <label>Estágio</label>
        <div class="select-wrap">
          <select name="status">
            ${DB.FARM_STATUS.filter(s => s !== 'Vendida').map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Observações</label>
        <textarea name="observacoes" placeholder="Anotações sobre a conta"></textarea>
      </div>
      <div class="form-error" id="form-error"></div>
      <button class="btn btn-primary" type="submit">Adicionar ao farm</button>
    </form>
  `;

  document.getElementById('form-farm').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const conta = DB.criarFarm({
        username: f.get('username'),
        plataforma: f.get('plataforma'),
        email: f.get('email'),
        senha: f.get('senha'),
        custo_proprio: f.get('custo_proprio'),
        recursos: f.getAll('recurso'),
        status: f.get('status'),
        observacoes: f.get('observacoes'),
      });
      toast('Conta adicionada ao farm ✓');
      location.hash = '#/farm/conta/' + conta.id;
    } catch (err) {
      const $err = document.getElementById('form-error');
      $err.textContent = err.message;
      $err.classList.add('show');
    }
  });
}

/* ============================================================
   FARM — DETALHES  (#/farm/conta/:id)
   ============================================================ */
function renderFarmDetalhes(id) {
  const c = DB.getFarm(id);
  if (!c) {
    $view.innerHTML = `<div class="card empty"><p>Conta não encontrada.</p></div>`;
    return;
  }
  const hist = DB.historicoDoFarm(id);
  const vendida = c.preco_venda != null;

  $view.innerHTML = `
    <a class="back-link" href="#/farm/lista">
      <svg viewBox="0 0 12 12"><path d="M8 1L3 6l5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
      Farm
    </a>
    <div class="page-head">
      <div class="page-head-row">
        <div>
          <h1>@${esc(c.username.replace(/^@/, ''))}</h1>
          <span class="badge ${esc(badgeSlug(c.status))}">${esc(c.status)}</span>
        </div>
        <button class="btn-small" id="btn-status">Alterar estágio</button>
      </div>
    </div>

    <h2>Dados da conta</h2>
    <div class="card detail-rows">
      <div class="detail-row"><span class="k">Username</span><span class="v">@${esc(c.username.replace(/^@/, ''))}</span></div>
      <div class="detail-row"><span class="k">Plataforma</span><span class="v">${esc(c.plataforma) || '—'}</span></div>
      <div class="detail-row"><span class="k">Email</span><span class="v">${esc(c.email) || '—'}</span></div>
      <div class="detail-row">
        <span class="k">Senha</span>
        <span class="v">
          <span id="senha-v">${c.senha ? '••••••••' : '—'}</span>
          ${c.senha ? '<button class="senha-toggle" id="senha-toggle">mostrar</button>' : ''}
        </span>
      </div>
    </div>

    <h2>Financeiro</h2>
    <div class="card detail-rows">
      <div class="detail-row"><span class="k">Custo de aquisição</span><span class="v">${fmtBRL(c.custo_proprio || 0)}</span></div>
      ${(c.recursos || []).map(rid => {
        const r = DB.listarRecursosFarm().find(x => x.id === rid);
        if (!r) return '';
        const n = DB.contasDoRecurso(rid);
        return `<div class="detail-row"><span class="k">${esc(r.nome)} <span class="k-sub">(÷${n})</span></span><span class="v">${fmtBRL(DB.custoRecursoPorConta(rid))}</span></div>`;
      }).join('')}
      <div class="detail-row"><span class="k">Custo total</span><span class="v" style="font-weight:700;">${fmtBRL(c.custo)}</span></div>
      <div class="detail-row"><span class="k">Início do farm</span><span class="v">${fmtData(c.data_inicio)}</span></div>
      <div class="detail-row"><span class="k">Venda</span><span class="v">${vendida ? fmtBRL(c.preco_venda) : 'Não vendida'}</span></div>
      <div class="detail-row"><span class="k">Data da venda</span><span class="v">${fmtData(c.data_venda)}</span></div>
      <div class="detail-row"><span class="k">Lucro</span><span class="v ${vendida ? lucroClass(c) : ''}">${fmtBRL(c.lucro)}</span></div>
    </div>

    ${c.observacoes ? `
      <h2>Observações</h2>
      <div class="card"><p style="font-size:14px;color:var(--ink-2);white-space:pre-wrap;">${esc(c.observacoes)}</p></div>` : ''}

    <h2>Histórico</h2>
    <div class="card">
      <div class="timeline">
        ${hist.map(h => `
          <div class="tl-item">
            <div class="evento">${esc(h.evento)}</div>
            ${h.descricao ? `<div class="descricao">${esc(h.descricao)}</div>` : ''}
            <div class="quando">${fmtDataHora(h.criado_em)}</div>
          </div>`).join('')}
      </div>
    </div>

    <div style="margin-top:24px;">
      ${!vendida ? `<a class="btn btn-success" href="#/farm/venda/${c.id}">Registrar venda</a>` : ''}
      <a class="btn btn-secondary" href="#/farm/editar/${c.id}">Editar dados</a>
      ${vendida ? `<button class="btn btn-secondary" id="btn-cancelar-venda">Cancelar venda</button>` : ''}
      <button class="btn btn-danger-ghost" id="btn-excluir">Excluir conta</button>
    </div>
  `;

  // Mostrar/ocultar senha
  const $tg = document.getElementById('senha-toggle');
  if ($tg) {
    let visivel = false;
    $tg.addEventListener('click', () => {
      visivel = !visivel;
      document.getElementById('senha-v').textContent = visivel ? c.senha : '••••••••';
      $tg.textContent = visivel ? 'ocultar' : 'mostrar';
    });
  }

  // Cancelar venda (comprador desistiu): desfaz o financeiro e volta ao estágio padrão
  const $cancelar = document.getElementById('btn-cancelar-venda');
  if ($cancelar) {
    $cancelar.addEventListener('click', () => {
      if (confirm(`Cancelar a venda de @${c.username.replace(/^@/, '')}? O lucro será zerado e a conta volta para "Crescendo".`)) {
        try {
          DB.cancelarVendaFarm(id);
          toast('Venda cancelada ✓');
          renderFarmDetalhes(id);
        } catch (err) { toast(err.message); }
      }
    });
  }

  // Alterar estágio (sheet)
  document.getElementById('btn-status').addEventListener('click', () => {
    openSheet(`
      <h3>Alterar estágio</h3>
      <div class="opts">
        ${DB.FARM_STATUS.map(s => `
          <button class="opt" data-status="${esc(s)}">
            <span>${esc(s)}</span>
            ${s === c.status ? '<span class="check">✓</span>' : ''}
          </button>`).join('')}
      </div>
      <button class="btn btn-secondary" id="sheet-cancel">Cancelar</button>
    `, sheet => {
      sheet.querySelectorAll('.opt').forEach(btn => {
        btn.addEventListener('click', () => {
          const novo = btn.dataset.status;
          // "Vendida" precisa de valor: encaminha para a tela de venda
          if (novo === 'Vendida' && c.preco_venda == null) {
            closeSheet();
            location.hash = '#/farm/venda/' + id;
            return;
          }
          try {
            DB.alterarStatusFarm(id, novo);
            closeSheet();
            toast('Estágio atualizado ✓');
            renderFarmDetalhes(id);
          } catch (err) { toast(err.message); }
        });
      });
      sheet.querySelector('#sheet-cancel').addEventListener('click', closeSheet);
    });
  });

  // Excluir
  document.getElementById('btn-excluir').addEventListener('click', () => {
    if (confirm(`Excluir a conta @${c.username.replace(/^@/, '')} do farm? Essa ação não pode ser desfeita.`)) {
      DB.excluirFarm(id);
      toast('Conta excluída');
      location.hash = '#/farm/lista';
    }
  });
}

/* ============================================================
   FARM — VENDA  (#/farm/venda/:id)
   ============================================================ */
function renderFarmVenda(id) {
  const c = DB.getFarm(id);
  if (!c) { location.hash = '#/farm/lista'; return; }
  if (c.preco_venda != null) { location.hash = '#/farm/conta/' + id; return; }

  const hoje = new Date();
  const hojeStr = hoje.getFullYear() + '-' +
    String(hoje.getMonth() + 1).padStart(2, '0') + '-' +
    String(hoje.getDate()).padStart(2, '0');

  $view.innerHTML = `
    <a class="back-link" href="#/farm/conta/${id}">
      <svg viewBox="0 0 12 12"><path d="M8 1L3 6l5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
      Voltar
    </a>
    <div class="page-head">
      <h1>Registrar venda</h1>
      <div class="subtitle">@${esc(c.username.replace(/^@/, ''))} · custo de ${fmtBRL(c.custo)}</div>
    </div>

    <form id="form-farm-venda" novalidate>
      <div class="form-group">
        <label>Valor da venda (R$) <span class="req">*</span></label>
        <input name="preco_venda" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0,00">
      </div>
      <div class="form-group">
        <label>Data da venda</label>
        <input name="data_venda" type="date" value="${hojeStr}">
      </div>
      <div class="form-group">
        <label>Observações</label>
        <textarea name="observacoes" placeholder="Anotações sobre a venda"></textarea>
      </div>
      <div class="card" style="margin-bottom:14px;">
        <div class="detail-row" style="border:none;padding:4px 0;">
          <span class="k">Lucro estimado</span>
          <span class="v" id="lucro-preview">R$ 0,00</span>
        </div>
      </div>
      <div class="form-error" id="form-error"></div>
      <button class="btn btn-success" type="submit">Confirmar venda</button>
    </form>
  `;

  const $preco = document.querySelector('[name=preco_venda]');
  const $preview = document.getElementById('lucro-preview');
  $preco.addEventListener('input', () => {
    const lucro = Number($preco.value || 0) - Number(c.custo || 0);
    $preview.textContent = fmtBRL(lucro);
    $preview.className = 'v ' + (lucro >= 0 ? 'pos' : 'neg');
  });

  document.getElementById('form-farm-venda').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      let dataVenda = null;
      if (f.get('data_venda')) {
        const [a, m, d] = f.get('data_venda').split('-').map(Number);
        const agora = new Date();
        dataVenda = new Date(a, m - 1, d, agora.getHours(), agora.getMinutes()).toISOString();
      }
      DB.registrarVendaFarm(id, {
        preco_venda: f.get('preco_venda'),
        data_venda: dataVenda,
        observacoes: f.get('observacoes'),
      });
      toast('Venda registrada ✓');
      location.hash = '#/farm/conta/' + id;
    } catch (err) {
      const $err = document.getElementById('form-error');
      $err.textContent = err.message;
      $err.classList.add('show');
    }
  });
}

/* ============================================================
   EDITAR CONTA (Compra/Venda)  (#/editar/:id)
   ============================================================ */
function renderEditarConta(id) {
  const c = DB.getConta(id);
  if (!c) { location.hash = '#/contas'; return; }
  const vendida = c.preco_venda != null;

  $view.innerHTML = `
    <a class="back-link" href="#/conta/${id}">
      <svg viewBox="0 0 12 12"><path d="M8 1L3 6l5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
      Voltar
    </a>
    <div class="page-head"><h1>Editar conta</h1></div>

    <form id="form-editar" novalidate>
      <div class="form-group">
        <label>Username <span class="req">*</span></label>
        <input name="username" type="text" value="${esc(c.username)}" autocapitalize="none" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Email</label>
        <input name="email" type="email" value="${esc(c.email)}" autocapitalize="none" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Senha</label>
        <input name="senha" type="text" value="${esc(c.senha)}" autocapitalize="none" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Nome do fornecedor</label>
        <input name="fornecedor" type="text" value="${esc(c.fornecedor)}">
      </div>
      <div class="form-group">
        <label>Valor da compra (R$) <span class="req">*</span></label>
        <input name="preco_compra" type="number" inputmode="decimal" step="0.01" min="0" value="${c.preco_compra}">
      </div>
      ${vendida ? `
      <div class="form-group">
        <label>Valor da venda (R$)</label>
        <input name="preco_venda" type="number" inputmode="decimal" step="0.01" min="0" value="${c.preco_venda}">
      </div>` : ''}
      <div class="form-group">
        <label>Observações</label>
        <textarea name="observacoes">${esc(c.observacoes)}</textarea>
      </div>
      <div class="form-error" id="form-error"></div>
      <button class="btn btn-primary" type="submit">Salvar alterações</button>
    </form>
  `;

  document.getElementById('form-editar').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      DB.atualizarConta(id, {
        username: f.get('username'),
        email: f.get('email'),
        senha: f.get('senha'),
        fornecedor: f.get('fornecedor'),
        preco_compra: f.get('preco_compra'),
        preco_venda: f.get('preco_venda'),
        observacoes: f.get('observacoes'),
      });
      toast('Alterações salvas ✓');
      location.hash = '#/conta/' + id;
    } catch (err) {
      const $err = document.getElementById('form-error');
      $err.textContent = err.message;
      $err.classList.add('show');
    }
  });
}

/* ============================================================
   EDITAR CONTA (Farm)  (#/farm/editar/:id)
   ============================================================ */
function renderEditarFarm(id) {
  const c = DB.getFarm(id);
  if (!c) { location.hash = '#/farm/lista'; return; }
  const vendida = c.preco_venda != null;

  $view.innerHTML = `
    <a class="back-link" href="#/farm/conta/${id}">
      <svg viewBox="0 0 12 12"><path d="M8 1L3 6l5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
      Voltar
    </a>
    <div class="page-head"><h1>Editar conta</h1></div>

    <form id="form-editar-farm" novalidate>
      <div class="form-group">
        <label>Username <span class="req">*</span></label>
        <input name="username" type="text" value="${esc(c.username)}" autocapitalize="none" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Plataforma / tipo</label>
        <input name="plataforma" type="text" value="${esc(c.plataforma)}">
      </div>
      <div class="form-group">
        <label>Email</label>
        <input name="email" type="email" value="${esc(c.email)}" autocapitalize="none" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Senha</label>
        <input name="senha" type="text" value="${esc(c.senha)}" autocapitalize="none" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Custo de aquisição (R$)</label>
        <input name="custo_proprio" type="number" inputmode="decimal" step="0.01" min="0" value="${c.custo_proprio != null ? c.custo_proprio : c.custo}">
        <div class="field-hint">Quanto você pagou pela conta em si.</div>
      </div>
      <div class="form-group">
        <label>Recursos compartilhados (proxies)</label>
        ${recursosCheckboxesHTML(c.recursos || [])}
        <div class="field-hint">O custo de cada recurso é dividido entre as contas que o usam.</div>
      </div>
      ${vendida ? `
      <div class="form-group">
        <label>Valor da venda (R$)</label>
        <input name="preco_venda" type="number" inputmode="decimal" step="0.01" min="0" value="${c.preco_venda}">
      </div>` : ''}
      <div class="form-group">
        <label>Observações</label>
        <textarea name="observacoes">${esc(c.observacoes)}</textarea>
      </div>
      <div class="form-error" id="form-error"></div>
      <button class="btn btn-primary" type="submit">Salvar alterações</button>
    </form>
  `;

  document.getElementById('form-editar-farm').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      DB.atualizarFarm(id, {
        username: f.get('username'),
        plataforma: f.get('plataforma'),
        email: f.get('email'),
        senha: f.get('senha'),
        custo_proprio: f.get('custo_proprio'),
        recursos: f.getAll('recurso'),
        preco_venda: f.get('preco_venda'),
        observacoes: f.get('observacoes'),
      });
      toast('Alterações salvas ✓');
      location.hash = '#/farm/conta/' + id;
    } catch (err) {
      const $err = document.getElementById('form-error');
      $err.textContent = err.message;
      $err.classList.add('show');
    }
  });
}

/* ============================================================
   GRUPO DE OFERTAS  (#/ofertas  ·  #/ofertas/AAAA-MM)
   ============================================================ */
function receitaRowHTML(r) {
  const info = [r.categoria, r.descricao].filter(Boolean).join(' · ');
  return `
    <div class="receita-row" data-id="${r.id}">
      <div class="rr-info">
        <div class="rr-val">${fmtBRL(r.valor)}</div>
        <div class="rr-meta">${fmtData(r.data)}${info ? ' · ' + esc(info) : ''}</div>
      </div>
      <button class="rr-del" data-id="${r.id}" aria-label="Excluir receita">✕</button>
    </div>`;
}

let ofertaGrupoId = null; // nicho selecionado (persiste enquanto navega)

function renderOfertas(param) {
  const grupos = DB.listarGruposOferta();
  if (!ofertaGrupoId || !grupos.some(g => g.id === ofertaGrupoId)) {
    ofertaGrupoId = grupos[0] ? grupos[0].id : null;
  }
  const grupo = grupos.find(g => g.id === ofertaGrupoId) || null;
  const gIdx = grupos.findIndex(g => g.id === ofertaGrupoId);
  const umNicho = grupos.length < 2;

  const agora = new Date();
  let ano = agora.getFullYear(), mes = agora.getMonth();
  if (param && /^\d{4}-\d{2}$/.test(param)) {
    const [a, m] = param.split('-').map(Number);
    ano = a; mes = m - 1;
  }
  const paramAtual = ano + '-' + String(mes + 1).padStart(2, '0');

  const res = grupo ? DB.resumoOfertasGrupo(grupo.id, 'tudo') : { receita: 0, investimento: 0, lucro: 0, roi: 0 };
  const o = grupo ? DB.getOfertaMes(grupo.id, ano, mes) : null;
  const investimento = o ? o.investimento : 0;
  const receitas = o ? [...o.receitas].sort((a, b) => (b.data || '').localeCompare(a.data || '')) : [];
  const receitaMes = receitas.reduce((s, r) => s + Number(r.valor || 0), 0);
  const lucroMes = receitaMes - investimento;
  const roiMes = investimento > 0 ? (lucroMes / investimento) * 100 : 0;

  const fmtParam = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const prevP = fmtParam(new Date(ano, mes - 1, 1));
  const nextP = fmtParam(new Date(ano, mes + 1, 1));
  const mesLabel = MESES_ABREV[mes] + '/' + ano;

  $view.innerHTML = `
    <a class="back-link" href="#/">
      <svg viewBox="0 0 12 12"><path d="M8 1L3 6l5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
      Início
    </a>
    <div class="page-head">
      <div class="page-head-row">
        <div><h1>Grupo de Ofertas</h1><div class="subtitle">Financeiro das ofertas de afiliado</div></div>
        <button class="btn-small" id="btn-novo-nicho">+ Nicho</button>
      </div>
    </div>

    <div class="month-switch">
      <button class="ms-arrow" id="grupo-prev" aria-label="Nicho anterior" ${umNicho ? 'disabled' : ''}>‹</button>
      <span class="ms-label">${grupo ? esc(grupo.nome) : 'Sem nicho'}</span>
      <button class="ms-arrow" id="grupo-next" aria-label="Próximo nicho" ${umNicho ? 'disabled' : ''}>›</button>
    </div>
    <button class="ver-mais" id="btn-editar-nicho">renomear ou excluir este nicho</button>

    <div class="stats-grid">
      <div class="stat wide">
        <div class="label">Lucro do nicho</div>
        <div class="value ${res.lucro >= 0 ? 'pos' : 'neg'}">${fmtBRL(res.lucro)}</div>
        <div class="sub">ROI de ${res.investimento > 0 ? fmtPct(res.roi) : '—'}</div>
      </div>
      <div class="stat"><div class="label">Receita</div><div class="value">${fmtBRL(res.receita)}</div></div>
      <div class="stat"><div class="label">Investimento</div><div class="value">${fmtBRL(res.investimento)}</div></div>
    </div>

    <div class="month-switch">
      <a class="ms-arrow" href="#/ofertas/${prevP}" aria-label="Mês anterior">‹</a>
      <span class="ms-label">${mesLabel}</span>
      <a class="ms-arrow" href="#/ofertas/${nextP}" aria-label="Próximo mês">›</a>
    </div>

    <div class="card detail-rows">
      <div class="detail-row">
        <span class="k">Investimento do mês</span>
        <span class="v">${fmtBRL(investimento)} <button class="senha-toggle" id="btn-invest">${investimento > 0 ? 'editar' : 'definir'}</button></span>
      </div>
      <div class="detail-row"><span class="k">Receita do mês</span><span class="v">${fmtBRL(receitaMes)}</span></div>
      <div class="detail-row"><span class="k">Lucro do mês</span><span class="v ${lucroMes >= 0 ? 'pos' : 'neg'}">${fmtBRL(lucroMes)}</span></div>
      <div class="detail-row"><span class="k">ROI do mês</span><span class="v ${roiMes >= 0 ? 'pos' : 'neg'}">${investimento > 0 ? fmtPct(roiMes) : '—'}</span></div>
    </div>

    <div class="section-row">
      <h2>Receitas de ${mesLabel}</h2>
      <button class="btn-small" id="btn-add-receita">+ Receita</button>
    </div>
    <div class="card" id="receitas-card">
      ${receitas.length
        ? receitas.map(receitaRowHTML).join('')
        : `<div class="empty" style="padding:24px;"><p>Nenhuma receita lançada neste mês.</p></div>`}
    </div>
  `;

  // Trocar de nicho (setinhas)
  const irGrupo = dir => {
    if (grupos.length < 2) return;
    const n = (gIdx + dir + grupos.length) % grupos.length;
    ofertaGrupoId = grupos[n].id;
    renderOfertas(paramAtual);
  };
  document.getElementById('grupo-prev').addEventListener('click', () => irGrupo(-1));
  document.getElementById('grupo-next').addEventListener('click', () => irGrupo(1));

  // Novo nicho
  document.getElementById('btn-novo-nicho').addEventListener('click', () => {
    openSheet(`
      <h3>Novo nicho</h3>
      <div class="form-group">
        <label>Nome do nicho</label>
        <input id="inp-nicho" type="text" placeholder="Ex.: Emagrecimento">
      </div>
      <button class="btn btn-primary" id="save-nicho">Criar nicho</button>
      <button class="btn btn-secondary" id="cancel-nicho">Cancelar</button>
    `, sheet => {
      const inp = sheet.querySelector('#inp-nicho');
      setTimeout(() => inp.focus(), 50);
      sheet.querySelector('#save-nicho').addEventListener('click', () => {
        try {
          const g = DB.criarGrupoOferta(inp.value);
          ofertaGrupoId = g.id;
          closeSheet();
          toast('Nicho criado ✓');
          renderOfertas(paramAtual);
        } catch (err) { toast(err.message); }
      });
      sheet.querySelector('#cancel-nicho').addEventListener('click', closeSheet);
    });
  });

  // Renomear / excluir nicho
  document.getElementById('btn-editar-nicho').addEventListener('click', () => {
    if (!grupo) return;
    openSheet(`
      <h3>Nicho</h3>
      <div class="form-group">
        <label>Nome do nicho</label>
        <input id="inp-nicho" type="text" value="${esc(grupo.nome)}">
      </div>
      <button class="btn btn-primary" id="save-nicho">Salvar nome</button>
      ${grupos.length > 1 ? `<button class="btn btn-danger-ghost" id="del-nicho">Excluir este nicho</button>` : ''}
      <button class="btn btn-secondary" id="cancel-nicho">Cancelar</button>
    `, sheet => {
      sheet.querySelector('#save-nicho').addEventListener('click', () => {
        try {
          DB.renomearGrupoOferta(grupo.id, sheet.querySelector('#inp-nicho').value);
          closeSheet();
          toast('Nicho renomeado ✓');
          renderOfertas(paramAtual);
        } catch (err) { toast(err.message); }
      });
      const del = sheet.querySelector('#del-nicho');
      if (del) del.addEventListener('click', () => {
        if (confirm(`Excluir o nicho "${grupo.nome}"? Todos os lançamentos dele serão apagados.`)) {
          DB.excluirGrupoOferta(grupo.id);
          ofertaGrupoId = null;
          closeSheet();
          toast('Nicho excluído');
          renderOfertas(paramAtual);
        }
      });
      sheet.querySelector('#cancel-nicho').addEventListener('click', closeSheet);
    });
  });

  // Definir/editar investimento do mês
  document.getElementById('btn-invest').addEventListener('click', () => {
    if (!grupo) return;
    openSheet(`
      <h3>Investimento de ${mesLabel} — ${esc(grupo.nome)}</h3>
      <div class="form-group">
        <label>Quanto você vai investir neste mês (R$)</label>
        <input id="inp-invest" type="number" inputmode="decimal" step="0.01" min="0" value="${investimento || ''}" placeholder="0,00">
      </div>
      <button class="btn btn-primary" id="save-invest">Salvar</button>
      <button class="btn btn-secondary" id="cancel-invest">Cancelar</button>
    `, sheet => {
      const inp = sheet.querySelector('#inp-invest');
      setTimeout(() => inp.focus(), 50);
      sheet.querySelector('#save-invest').addEventListener('click', () => {
        try {
          DB.definirInvestimentoMes(grupo.id, ano, mes, inp.value);
          closeSheet();
          toast('Investimento salvo ✓');
          renderOfertas(paramAtual);
        } catch (err) { toast(err.message); }
      });
      sheet.querySelector('#cancel-invest').addEventListener('click', closeSheet);
    });
  });

  // Lançar receita
  document.getElementById('btn-add-receita').addEventListener('click', () => {
    if (!grupo) return;
    const ehMesAtual = (ano === agora.getFullYear() && mes === agora.getMonth());
    const dataDefault = ehMesAtual
      ? agora.getFullYear() + '-' + String(agora.getMonth() + 1).padStart(2, '0') + '-' + String(agora.getDate()).padStart(2, '0')
      : `${ano}-${String(mes + 1).padStart(2, '0')}-01`;
    openSheet(`
      <h3>Lançar receita — ${esc(grupo.nome)}</h3>
      <div class="form-group">
        <label>Valor recebido (R$)</label>
        <input id="inp-rval" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0,00">
      </div>
      <div class="form-group">
        <label>Data</label>
        <input id="inp-rdata" type="date" value="${dataDefault}">
      </div>
      <div class="form-group">
        <label>Categoria</label>
        <div class="select-wrap">
          <select id="inp-rcat">
            ${DB.OFERTAS_CATEGORIAS.map(cat => `<option value="${esc(cat)}"${cat === 'Comissão' ? ' selected' : ''}>${esc(cat)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Descrição (opcional)</label>
        <input id="inp-rdesc" type="text" placeholder="Ex.: semana 1">
      </div>
      <div class="form-error" id="sheet-err"></div>
      <button class="btn btn-success" id="save-receita">Lançar receita</button>
      <button class="btn btn-secondary" id="cancel-receita">Cancelar</button>
    `, sheet => {
      const val = sheet.querySelector('#inp-rval');
      setTimeout(() => val.focus(), 50);
      sheet.querySelector('#save-receita').addEventListener('click', () => {
        try {
          const dataStr = sheet.querySelector('#inp-rdata').value;
          DB.adicionarReceitaOferta(grupo.id, ano, mes, {
            valor: val.value,
            data: dataStr ? new Date(dataStr + 'T12:00:00').toISOString() : null,
            categoria: sheet.querySelector('#inp-rcat').value,
            descricao: sheet.querySelector('#inp-rdesc').value,
          });
          closeSheet();
          toast('Receita lançada ✓');
          renderOfertas(paramAtual);
        } catch (err) {
          const e = sheet.querySelector('#sheet-err');
          e.textContent = err.message; e.classList.add('show');
        }
      });
      sheet.querySelector('#cancel-receita').addEventListener('click', closeSheet);
    });
  });

  // Excluir receita
  document.getElementById('receitas-card').addEventListener('click', e => {
    const btn = e.target.closest('.rr-del');
    if (!btn || !o) return;
    if (confirm('Excluir esta receita?')) {
      DB.excluirReceitaOferta(o.id, btn.dataset.id);
      toast('Receita excluída');
      renderOfertas(paramAtual);
    }
  });
}

/* ============================================================
   RECURSOS DO FARM (proxies compartilhadas)  (#/farm/recursos)
   ============================================================ */
function recursoRowHTML(r) {
  const n = DB.contasDoRecurso(r.id);
  const porConta = DB.custoRecursoPorConta(r.id);
  return `
    <div class="card recurso-card">
      <div class="rc-info">
        <div class="rc-nome">${esc(r.nome)}</div>
        <div class="rc-meta">${fmtBRL(r.custo_total)} total · ${n} conta(s)</div>
      </div>
      <div class="rc-fin">
        <div class="rc-val">${n > 0 ? fmtBRL(porConta) : '—'}</div>
        <div class="rc-lbl">por conta</div>
      </div>
      <button class="senha-toggle" data-edit="${r.id}">editar</button>
    </div>`;
}

function sheetRecurso(recurso) {
  const editar = !!recurso;
  openSheet(`
    <h3>${editar ? 'Editar recurso' : 'Novo recurso'}</h3>
    <div class="form-group">
      <label>Nome (ex.: Proxy Vivo #1)</label>
      <input id="inp-rec-nome" type="text" value="${editar ? esc(recurso.nome) : ''}" placeholder="Proxy, chip, ferramenta…">
    </div>
    <div class="form-group">
      <label>Custo total (R$)</label>
      <input id="inp-rec-custo" type="number" inputmode="decimal" step="0.01" min="0" value="${editar ? recurso.custo_total : ''}" placeholder="0,00">
    </div>
    <div class="form-error" id="rec-err"></div>
    <button class="btn btn-primary" id="save-rec">${editar ? 'Salvar' : 'Criar recurso'}</button>
    ${editar ? '<button class="btn btn-danger-ghost" id="del-rec">Excluir recurso</button>' : ''}
    <button class="btn btn-secondary" id="cancel-rec">Cancelar</button>
  `, sheet => {
    const nome = sheet.querySelector('#inp-rec-nome');
    setTimeout(() => nome.focus(), 50);
    sheet.querySelector('#save-rec').addEventListener('click', () => {
      try {
        const custo = sheet.querySelector('#inp-rec-custo').value;
        if (editar) DB.atualizarRecursoFarm(recurso.id, { nome: nome.value, custo_total: custo });
        else DB.criarRecursoFarm(nome.value, custo);
        closeSheet();
        toast(editar ? 'Recurso salvo ✓' : 'Recurso criado ✓');
        renderFarmRecursos();
      } catch (err) {
        const e = sheet.querySelector('#rec-err');
        e.textContent = err.message; e.classList.add('show');
      }
    });
    const del = sheet.querySelector('#del-rec');
    if (del) del.addEventListener('click', () => {
      if (confirm(`Excluir o recurso "${recurso.nome}"? Ele será desvinculado de todas as contas e os custos recalculados.`)) {
        DB.excluirRecursoFarm(recurso.id);
        closeSheet();
        toast('Recurso excluído');
        renderFarmRecursos();
      }
    });
    sheet.querySelector('#cancel-rec').addEventListener('click', closeSheet);
  });
}

function renderFarmRecursos() {
  const recursos = DB.listarRecursosFarm();

  $view.innerHTML = `
    <a class="back-link" href="#/farm">
      <svg viewBox="0 0 12 12"><path d="M8 1L3 6l5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
      Farm
    </a>
    <div class="page-head">
      <div class="page-head-row">
        <div><h1>Recursos</h1><div class="subtitle">Custos compartilhados (proxies etc.)</div></div>
        <button class="btn-small" id="btn-novo-recurso">+ Recurso</button>
      </div>
    </div>

    <div class="conta-list" id="recursos-lista">
      ${recursos.length
        ? recursos.map(recursoRowHTML).join('')
        : `<div class="card empty"><p>Nenhum recurso ainda.<br>Crie uma proxy e vincule às contas no cadastro ou na edição.</p></div>`}
    </div>
    <p class="recurso-hint">O custo de cada recurso é dividido igualmente entre as contas que o usam. Adicione mais contas e a fatia de cada uma cai.</p>
  `;

  document.getElementById('btn-novo-recurso').addEventListener('click', () => sheetRecurso(null));
  document.getElementById('recursos-lista').addEventListener('click', e => {
    const btn = e.target.closest('[data-edit]');
    if (!btn) return;
    const r = DB.listarRecursosFarm().find(x => x.id === btn.dataset.edit);
    if (r) sheetRecurso(r);
  });
}

/* ============================================================
   SHEET
   ============================================================ */
function openSheet(html, setup) {
  $backdrop.innerHTML = `<div class="sheet">${html}</div>`;
  $backdrop.classList.remove('hidden');
  const sheet = $backdrop.querySelector('.sheet');
  if (setup) setup(sheet);
  $backdrop.addEventListener('click', e => {
    if (e.target === $backdrop) closeSheet();
  });
}

function closeSheet() {
  $backdrop.classList.add('hidden');
  $backdrop.innerHTML = '';
}
