/* ============================================================
   Gestão Operações — SPA com roteamento por hash
   Rotas: #/  #/contas  #/nova  #/conta/:id  #/venda/:id
   ============================================================ */

const $view = document.getElementById('view');
const $toast = document.getElementById('toast');
const $backdrop = document.getElementById('sheet-backdrop');

const TTPOST_BRIDGE = (() => {
  const KEY = 'gestao-op-ttpost-bridge-v1';
  const URL = 'https://oakylrntjdqnrybxbpvo.supabase.co/functions/v1/ttpost-bridge';
  let refreshing = false;

  function load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_err) {
      return {};
    }
  }

  function save(patch) {
    const next = { ...load(), ...patch };
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  }

  function state() {
    const current = load();
    return {
      url: URL,
      configured: Boolean(current.token),
      token: current.token || '',
      installation_id: current.installation_id || null,
      snapshot: current.snapshot || null,
      synced_at: current.synced_at || null,
      fetched_at: current.fetched_at || null,
      error: current.error || null,
      refreshing,
    };
  }

  function setToken(token) {
    const value = String(token || '').trim();
    if (value.length < 24) throw new Error('Cole o token completo do Gestão OP.');
    save({ token: value, error: null });
  }

  function disconnect() {
    localStorage.removeItem(KEY);
  }

  async function refresh(tokenOverride = '') {
    if (refreshing) return state();
    const current = load();
    const token = String(tokenOverride || current.token || '').trim();
    if (!token) throw new Error('Configure o token do Gestão OP.');
    refreshing = true;
    try {
      const response = await fetch(URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'dashboard' }),
      });
      let body = {};
      try { body = await response.json(); } catch (_err) { /* resposta inválida */ }
      if (!response.ok) throw new Error(body.error || `Ponte respondeu HTTP ${response.status}.`);
      const installation = Array.isArray(body.installations) ? body.installations[0] : null;
      save({
        token,
        installation_id: installation?.installation_id || null,
        snapshot: installation?.snapshot || null,
        synced_at: installation?.synced_at || null,
        fetched_at: new Date().toISOString(),
        error: null,
      });
      return state();
    } catch (err) {
      save({ error: err.message || 'Não foi possível acessar a ponte.' });
      throw err;
    } finally {
      refreshing = false;
    }
  }

  return { state, setToken, disconnect, refresh };
})();

// Preferências exclusivamente visuais deste aparelho.
const APP_PREFS = (() => {
  const KEY = 'gestao-op-ui-preferences-v1';
  const DEFAULTS = {
    roi_formato: 'percentual',
    ranking_expandido: false,
    operacoes_abertas: {},
  };

  function get() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      return {
        ...DEFAULTS,
        ...(saved && typeof saved === 'object' ? saved : {}),
        operacoes_abertas: saved?.operacoes_abertas && typeof saved.operacoes_abertas === 'object'
          ? saved.operacoes_abertas : {},
      };
    } catch (_err) {
      return { ...DEFAULTS, operacoes_abertas: {} };
    }
  }

  function set(patch) {
    const next = { ...get(), ...patch };
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  }

  return { get, set };
})();

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

// Copia texto para a área de transferência (com fallback p/ navegadores antigos)
function copiarTexto(texto) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(texto);
  }
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      ta.remove();
      resolve();
    } catch (e) { reject(e); }
  });
}

// Botão pequeno de copiar (SVG) para um campo — tratado pelo handler [data-copiar]
function copyBtnHTML(campo) {
  return `<button class="copy-btn" type="button" data-copiar="${campo}" aria-label="Copiar"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg></button>`;
}

// Monta o texto dos dados de uma conta — só os valores, sem rótulos, um por linha
function textoDadosConta(c, incluirObs = true) {
  const linhas = [c.username.replace(/^@/, '')];
  if (c.email) linhas.push(c.email);
  if (c.senha) linhas.push(c.senha);
  if (incluirObs && c.observacoes) linhas.push(c.observacoes);
  return linhas.join('\n');
}

// Menu de envio dos dados: compartilhar (folha do iOS) ou copiar, com/sem observações
function abrirEnvioDados(c) {
  const temObs = !!c.observacoes;
  const opcoes = temObs ? [
    { label: 'Compartilhar sem observações', acao: 'share', obs: false },
    { label: 'Compartilhar com observações', acao: 'share', obs: true },
    { label: 'Copiar sem observações', acao: 'copy', obs: false },
    { label: 'Copiar com observações', acao: 'copy', obs: true },
  ] : [
    { label: 'Compartilhar', acao: 'share', obs: false },
    { label: 'Copiar', acao: 'copy', obs: false },
  ];
  openSheet(`
    <h3>Enviar dados da conta</h3>
    <div class="opts">
      ${opcoes.map((o, i) => `<button class="opt" data-i="${i}"><span>${o.label}</span></button>`).join('')}
    </div>
    <button class="btn btn-secondary" id="env-cancel">Cancelar</button>
  `, sheet => {
    sheet.querySelectorAll('.opt').forEach(btn => {
      btn.addEventListener('click', () => {
        const o = opcoes[Number(btn.dataset.i)];
        const texto = 'Segue os dados da conta:\n\n' + textoDadosConta(c, o.obs);
        closeSheet();
        if (o.acao === 'share' && navigator.share) {
          navigator.share({ text: texto }).catch(err => {
            if (err && err.name !== 'AbortError') copiarTexto(texto).then(() => toast('Dados copiados ✓'));
          });
        } else {
          copiarTexto(texto).then(() => toast('Dados copiados ✓')).catch(() => toast('Não foi possível copiar'));
        }
      });
    });
    sheet.querySelector('#env-cancel').addEventListener('click', closeSheet);
  });
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

// ROI de 100% equivale a 2,0x; ROI de 200% equivale a 3,0x.
function fmtROI(v) {
  if (APP_PREFS.get().roi_formato === 'multiplicador') {
    return (1 + Number(v || 0) / 100).toFixed(1).replace('.', ',') + 'x';
  }
  return fmtPct(v);
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
  else if (parts[0] === 'ttpost') renderTtpost();
  else if (parts[0] === 'configuracoes') renderConfiguracoes();
  else if (parts[0] === 'conta' && parts[1]) renderDetalhes(parts[1]);
  else if (parts[0] === 'venda' && parts[1]) renderVenda(parts[1]);
  else if (parts[0] === 'editar' && parts[1]) renderEditarConta(parts[1]);
  else if (parts[0] === 'farm') {
    if (parts[1] === 'lista') renderFarmLista();
    else if (parts[1] === 'nova') renderFarmCadastro();
    else if (parts[1] === 'conta' && parts[2]) renderFarmDetalhes(parts[2]);
    else if (parts[1] === 'venda' && parts[2]) renderFarmVenda(parts[2]);
    else if (parts[1] === 'editar' && parts[2]) renderEditarFarm(parts[2]);
    else if (parts[1] === 'lotes') renderFarmLotes();
    else if (parts[1] === 'lote' && parts[2]) renderFarmLoteDetalhes(parts[2]);
    else if (parts[1] === 'custos-fixos') renderFarmCustosFixos();
    else renderFarmDashboard();
  }
  else if (parts[0] === 'ofertas') renderOfertas(parts[1]);
  else if (parts[0] === 'emails') renderEmails();
  else renderDashboard();

  // Tab ativa (barra enxuta: Início · Emails · TTpost · Backup · Config.)
  const tab = (hash === '#/' || hash === '#') ? 'dashboard'
    : (parts[0] === 'emails' ? 'emails'
    : (parts[0] === 'ttpost' ? 'ttpost'
    : (parts[0] === 'backup' ? 'backup'
    : (parts[0] === 'configuracoes' ? 'configuracoes' : ''))));
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab));

  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);

async function sincronizarTtpost() {
  const bridge = TTPOST_BRIDGE.state();
  if (!bridge.configured || bridge.refreshing || document.hidden) return;
  try {
    await TTPOST_BRIDGE.refresh();
    await verificarMetasTtpost(ttpostRankingRemoto(TTPOST_BRIDGE.state().snapshot));
  } catch (_err) { /* o estado da ponte já guarda o erro */ }
  if (location.hash.startsWith('#/ttpost')) renderTtpost(true);
}

setInterval(sincronizarTtpost, 60000);
window.addEventListener('load', sincronizarTtpost);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) sincronizarTtpost();
});

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
  const lote = f.lote_id ? DB.getFarmLote(f.lote_id) : null;
  return `
    <a class="conta-item" href="#/farm/conta/${f.id}">
      <div class="avatar">${esc(inicial)}</div>
      <div class="info">
        <div class="username">@${esc(f.username.replace(/^@/, ''))}</div>
        <div class="meta">${lote ? esc(lote.nome) : 'Sem lote'}</div>
        <span class="badge ${esc(badgeSlug(f.status))}">${esc(f.status)}</span>
      </div>
      <div class="fin">
        <div class="valores">${fmtData(f.data_inicio)}</div>
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
  const aberta = APP_PREFS.get().operacoes_abertas[op.id] !== false;
  let extra = '';
  if (op.id === 'compra-venda') extra = `${op.extra.vendidas} vendida(s) no mês · ${op.extra.estoque} em estoque (${fmtBRL(op.extra.capitalEstoque)})`;
  else if (op.id === 'farm') extra = `${op.extra.vendidas} vendida(s) no mês · ${op.extra.emFarm} em farm · ${op.extra.lotes} lote(s)`;
  else if (op.id === 'ofertas') extra = `${op.extra.nichos} nicho(s) · ${op.extra.lancamentosMes} lançamento(s) no mês`;
  return `
    <article class="op-card ${aberta ? '' : 'collapsed'}" style="--op-cor:${cor}">
      <a class="op-card-link" href="${op.rota}">
        <div class="op-head">
          <span class="op-dot"></span>
          <span class="op-name">${esc(op.nome)}</span>
          <span class="op-lucro ${op.lucro >= 0 ? 'pos' : 'neg'}">${fmtBRL(op.lucro)}</span>
        </div>
        <div class="op-details">
          <div class="op-metrics">
            <div><span class="m-label">Receita</span><span class="m-val">${fmtBRL(op.receita)}</span></div>
            <div><span class="m-label">Investimento</span><span class="m-val">${fmtBRL(op.investimento)}</span></div>
            <div><span class="m-label">ROI</span><span class="m-val ${op.roi >= 0 ? 'pos' : 'neg'}">${op.investimento > 0 ? fmtROI(op.roi) : '—'}</span></div>
          </div>
          <div class="op-extra">${extra}<span class="op-chevron">›</span></div>
        </div>
      </a>
      <button class="collapse-toggle op-toggle ${aberta ? 'open' : ''}" type="button" data-op-toggle="${op.id}" aria-label="${aberta ? 'Minimizar' : 'Expandir'} ${esc(op.nome)}" aria-expanded="${aberta}">⌄</button>
    </article>`;
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

// Estado do dashboard (persiste enquanto navega): período do card azul.
const PERIODOS = ['hoje', 'mes', '6meses', 'tudo'];
const PERIODO_LABEL = { hoje: 'Hoje', mes: 'Este mês', '6meses': 'Últimos 6 meses', tudo: 'Tudo (acumulado)' };
const dashState = { periodo: '6meses' };

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
        <span class="geral-roi ${g.roi >= 0 ? 'pos' : 'neg'}">ROI ${g.investimento > 0 ? fmtROI(g.roi) : '—'}</span>
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
  `;

  const cicla = dir => {
    const i = PERIODOS.indexOf(dashState.periodo);
    dashState.periodo = PERIODOS[(i + dir + PERIODOS.length) % PERIODOS.length];
    renderDashboard();
  };
  document.getElementById('periodo-prev').addEventListener('click', () => cicla(-1));
  document.getElementById('periodo-next').addEventListener('click', () => cicla(1));

  document.querySelectorAll('[data-op-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const prefs = APP_PREFS.get();
      APP_PREFS.set({
        operacoes_abertas: {
          ...prefs.operacoes_abertas,
          [btn.dataset.opToggle]: !(prefs.operacoes_abertas[btn.dataset.opToggle] !== false),
        },
      });
      renderDashboard();
    });
  });

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
      <div class="detail-row"><span class="k">Username</span><span class="v">@${esc(c.username.replace(/^@/, ''))} ${copyBtnHTML('username')}</span></div>
      <div class="detail-row"><span class="k">Email</span><span class="v">${esc(c.email) || '—'}${c.email ? ' ' + copyBtnHTML('email') : ''}</span></div>
      <div class="detail-row">
        <span class="k">Senha</span>
        <span class="v">
          <span id="senha-v">${c.senha ? '••••••••' : '—'}</span>
          ${c.senha ? '<button class="senha-toggle" id="senha-toggle">mostrar</button>' : ''}
          ${c.senha ? copyBtnHTML('senha') : ''}
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
      <div class="section-row"><h2>Observações</h2>${copyBtnHTML('observacoes')}</div>
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

  // Copiar campo individual (usuário, email, senha, observações)
  document.querySelectorAll('[data-copiar]').forEach(btn => {
    btn.addEventListener('click', () => {
      const campo = btn.dataset.copiar;
      const valor = campo === 'username' ? c.username.replace(/^@/, '') : (c[campo] || '');
      if (!valor) return;
      copiarTexto(valor)
        .then(() => toast('Copiado ✓'))
        .catch(() => toast('Não foi possível copiar'));
    });
  });

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
   TTPOST  (#/ttpost)
   ============================================================ */
const TTPOST_BASE_LABEL = {
  mensal_compartilhado: 'Mensal compartilhado',
  mensal_por_conta: 'Mensal por conta',
  por_postagem: 'Por postagem publicada',
  por_hora_aquecimento: 'Por hora de aquecimento',
  por_conta_dia: 'Por conta por dia',
  fixo_por_conta: 'Fixo por conta',
};
const TTPOST_SCOPE_LABEL = {
  todos: 'Todos', adspower: 'AdsPower', dolphin: 'Dolphin', mobile: 'Celular',
};
const _numero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

function ttpostBridgeSheet() {
  const bridge = TTPOST_BRIDGE.state();
  openSheet(`
    <h3>Conectar ao TTpost desktop</h3>
    <div class="sheet-scroll">
      <div class="form-group">
        <label>Token do Gestão OP</label>
        <input id="ttp-bridge-token" type="password" value="" placeholder="${bridge.configured ? 'Token já configurado — deixe vazio para manter' : 'Cole o token fornecido na configuração'}" autocapitalize="none" autocomplete="off">
      </div>
      <div class="field-hint ttp-sheet-hint">O token fica somente neste aparelho. Ele não entra no backup nem no código público do site.</div>
      <div class="form-error" id="ttp-bridge-err"></div>
      <button class="btn btn-primary" id="ttp-bridge-save">Salvar e testar conexão</button>
      ${bridge.configured ? '<button class="btn btn-danger-ghost" id="ttp-bridge-disconnect">Desconectar este aparelho</button>' : ''}
      <button class="btn btn-secondary" id="ttp-bridge-cancel">Cancelar</button>
    </div>
  `, sheet => {
    const saveButton = sheet.querySelector('#ttp-bridge-save');
    saveButton.addEventListener('click', async () => {
      const errorElement = sheet.querySelector('#ttp-bridge-err');
      errorElement.classList.remove('show');
      saveButton.disabled = true;
      saveButton.textContent = 'Conectando...';
      try {
        const enteredToken = sheet.querySelector('#ttp-bridge-token').value.trim();
        if (enteredToken) TTPOST_BRIDGE.setToken(enteredToken);
        else if (!bridge.configured) throw new Error('Cole o token do Gestão OP.');
        await TTPOST_BRIDGE.refresh();
        closeSheet();
        toast('TTpost conectado ✓');
        renderTtpost(true);
      } catch (err) {
        errorElement.textContent = err.message;
        errorElement.classList.add('show');
        saveButton.disabled = false;
        saveButton.textContent = 'Salvar e testar conexão';
      }
    });
    const disconnectButton = sheet.querySelector('#ttp-bridge-disconnect');
    if (disconnectButton) disconnectButton.addEventListener('click', () => {
      if (!confirm('Desconectar o TTpost deste aparelho?')) return;
      TTPOST_BRIDGE.disconnect();
      closeSheet();
      toast('Ponte desconectada');
      renderTtpost(true);
    });
    sheet.querySelector('#ttp-bridge-cancel').addEventListener('click', closeSheet);
  });
}

function ttpostContaSheet(conta) {
  const vinculadas = DB.listarContasTtpost();
  const disponiveis = DB.listarFarm().filter(f =>
    f.id === conta?.farm_id || (f.status !== 'Vendida' && !vinculadas.some(c => c.farm_id === f.id))
  );
  if (!disponiveis.length) {
    toast('Cadastre uma conta no Farm primeiro');
    return;
  }
  const atual = conta || {};
  openSheet(`
    <h3>${conta ? 'Editar conta TTpost' : 'Vincular conta ao TTpost'}</h3>
    <div class="sheet-scroll">
      <div class="form-group">
        <label>Conta do Farm</label>
        <div class="select-wrap"><select id="ttp-farm">
          ${disponiveis.map(f => `<option value="${f.id}" ${f.id === atual.farm_id ? 'selected' : ''}>@${esc(f.username.replace(/^@/, ''))}</option>`).join('')}
        </select></div>
      </div>
      <div class="form-group">
        <label>Nome do perfil no multilogin</label>
        <input id="ttp-nome" value="${esc(atual.nome_perfil || '')}" placeholder="Ex.: garthhwbg9z" autocapitalize="none">
      </div>
      <div class="form-group">
        <label>Onde a conta roda</label>
        <div class="select-wrap"><select id="ttp-provider">
          ${[['adspower','AdsPower'],['dolphin','Dolphin'],['mobile','Celular']].map(([v,l]) => `<option value="${v}" ${v === (atual.provider || 'adspower') ? 'selected' : ''}>${l}</option>`).join('')}
        </select></div>
      </div>
      <div class="form-group">
        <label>ID do perfil ou serial do celular</label>
        <input id="ttp-profile" value="${esc(atual.profile_id || atual.device_serial || '')}" autocapitalize="none">
      </div>
      <div class="form-group"><label>Seguidores</label><input id="ttp-followers" type="number" inputmode="numeric" min="0" value="${Number(atual.followers || 0)}"></div>
      <div class="ttp-form-grid">
        <div class="form-group"><label>Posts concluídos</label><input id="ttp-posts" type="number" inputmode="numeric" min="0" value="${Number(atual.posts_success || 0)}"></div>
        <div class="form-group"><label>Falhas</label><input id="ttp-fails" type="number" inputmode="numeric" min="0" value="${Number(atual.posts_failed || 0)}"></div>
      </div>
      <div class="ttp-form-grid">
        <div class="form-group"><label>Min. aquecidos</label><input id="ttp-warmup" type="number" inputmode="numeric" min="0" value="${Number(atual.warmup_minutes_total || 0)}"></div>
        <div class="form-group"><label>Vídeos usados</label><input id="ttp-used" type="number" inputmode="numeric" min="0" value="${Number(atual.videos_used || 0)}"></div>
      </div>
      <div class="ttp-form-grid">
        <div class="form-group"><label>Posts hoje</label><input id="ttp-posts-today" type="number" inputmode="numeric" min="0" value="${Number(atual.posts_today || 0)}"></div>
        <div class="form-group"><label>Falhas hoje</label><input id="ttp-fails-today" type="number" inputmode="numeric" min="0" value="${Number(atual.failures_today || 0)}"></div>
      </div>
      <div class="ttp-form-grid">
        <div class="form-group"><label>Aquecimentos hoje</label><input id="ttp-warmups-today" type="number" inputmode="numeric" min="0" value="${Number(atual.warmups_today || 0)}"></div>
        <div class="form-group"><label>Situação</label><div class="select-wrap"><select id="ttp-active"><option value="1" ${atual.active !== false ? 'selected' : ''}>Ativa</option><option value="0" ${atual.active === false ? 'selected' : ''}>Inativa</option></select></div></div>
      </div>
      <div class="field-hint ttp-sheet-hint">Seguidores, postagens e aquecimento serão preenchidos automaticamente quando a ponte online for conectada. Por enquanto você pode ajustar manualmente.</div>
      <div class="form-error" id="ttp-conta-err"></div>
      <button class="btn btn-primary" id="ttp-save-account">Salvar</button>
      ${conta ? '<button class="btn btn-danger-ghost" id="ttp-delete-account">Remover vínculo</button>' : ''}
      <button class="btn btn-secondary" id="ttp-cancel-account">Cancelar</button>
    </div>
  `, sheet => {
    sheet.querySelector('#ttp-save-account').addEventListener('click', () => {
      try {
        const provider = sheet.querySelector('#ttp-provider').value;
        const identificador = sheet.querySelector('#ttp-profile').value;
        DB.salvarContaTtpost({
          id: conta?.id,
          farm_id: sheet.querySelector('#ttp-farm').value,
          nome_perfil: sheet.querySelector('#ttp-nome').value,
          provider,
          profile_id: provider === 'mobile' ? '' : identificador,
          device_serial: provider === 'mobile' ? identificador : '',
          followers: sheet.querySelector('#ttp-followers').value,
          follower_goal: atual.follower_goal || 0,
          posts_success: sheet.querySelector('#ttp-posts').value,
          posts_failed: sheet.querySelector('#ttp-fails').value,
          warmup_minutes_total: sheet.querySelector('#ttp-warmup').value,
          videos_used: sheet.querySelector('#ttp-used').value,
          posts_today: sheet.querySelector('#ttp-posts-today').value,
          failures_today: sheet.querySelector('#ttp-fails-today').value,
          warmups_today: sheet.querySelector('#ttp-warmups-today').value,
          active: sheet.querySelector('#ttp-active').value === '1',
        });
        closeSheet(); toast('Conta TTpost salva ✓'); renderTtpost();
      } catch (err) {
        const el = sheet.querySelector('#ttp-conta-err');
        el.textContent = err.message; el.classList.add('show');
      }
    });
    const del = sheet.querySelector('#ttp-delete-account');
    if (del) del.addEventListener('click', () => {
      if (!confirm('Remover este vínculo do TTpost?')) return;
      DB.excluirContaTtpost(conta.id); closeSheet(); toast('Vínculo removido'); renderTtpost();
    });
    sheet.querySelector('#ttp-cancel-account').addEventListener('click', closeSheet);
  });
}

function ttpostCustoSheet(custo) {
  const atual = custo || {};
  openSheet(`
    <h3>${custo ? 'Editar custo' : 'Novo custo operacional'}</h3>
    <div class="form-group"><label>Nome do custo</label><input id="ttp-cost-name" value="${esc(atual.nome || '')}" placeholder="Ex.: Dolphin, energia, edição"></div>
    <div class="form-group"><label>Valor (R$)</label><input id="ttp-cost-value" type="number" inputmode="decimal" step="0.01" min="0" value="${atual.valor != null ? atual.valor : ''}"></div>
    <div class="form-group"><label>Como calcular</label><div class="select-wrap"><select id="ttp-cost-base">
      ${Object.entries(TTPOST_BASE_LABEL).map(([v,l]) => `<option value="${v}" ${v === (atual.base || 'mensal_por_conta') ? 'selected' : ''}>${l}</option>`).join('')}
    </select></div></div>
    <div class="form-group"><label>Aplicar em</label><div class="select-wrap"><select id="ttp-cost-scope">
      ${Object.entries(TTPOST_SCOPE_LABEL).map(([v,l]) => `<option value="${v}" ${v === (atual.escopo || 'todos') ? 'selected' : ''}>${l}</option>`).join('')}
    </select></div></div>
    <div class="field-hint ttp-sheet-hint">Exemplo: um custo mensal compartilhado é dividido entre as contas ativas. Um custo por postagem usa apenas publicações concluídas.</div>
    <div class="form-error" id="ttp-cost-err"></div>
    <button class="btn btn-primary" id="ttp-save-cost">Salvar custo</button>
    ${custo ? '<button class="btn btn-danger-ghost" id="ttp-delete-cost">Excluir custo</button>' : ''}
    <button class="btn btn-secondary" id="ttp-cancel-cost">Cancelar</button>
  `, sheet => {
    sheet.querySelector('#ttp-save-cost').addEventListener('click', () => {
      try {
        DB.salvarCustoTtpost({
          id: custo?.id, nome: sheet.querySelector('#ttp-cost-name').value,
          valor: sheet.querySelector('#ttp-cost-value').value,
          base: sheet.querySelector('#ttp-cost-base').value,
          escopo: sheet.querySelector('#ttp-cost-scope').value,
        });
        closeSheet(); toast('Custo salvo ✓'); renderTtpost();
      } catch (err) {
        const el = sheet.querySelector('#ttp-cost-err'); el.textContent = err.message; el.classList.add('show');
      }
    });
    const del = sheet.querySelector('#ttp-delete-cost');
    if (del) del.addEventListener('click', () => {
      if (!confirm(`Excluir o custo "${custo.nome}"?`)) return;
      DB.excluirCustoTtpost(custo.id); closeSheet(); toast('Custo excluído'); renderTtpost();
    });
    sheet.querySelector('#ttp-cancel-cost').addEventListener('click', closeSheet);
  });
}

function ttpostEstoqueSheet(item) {
  const atual = item || {};
  openSheet(`
    <h3>${item ? 'Editar estoque' : 'Novo estoque de vídeos'}</h3>
    <div class="form-group"><label>Nome</label><input id="ttp-stock-name" value="${esc(atual.nome || '')}" placeholder="Ex.: Vídeos produto A"></div>
    <div class="form-group"><label>Pasta</label><input id="ttp-stock-folder" value="${esc(atual.pasta || '')}" placeholder="C:\\Videos\\Produto A" autocapitalize="none"></div>
    <div class="ttp-form-grid">
      <div class="form-group"><label>Disponíveis</label><input id="ttp-stock-count" type="number" inputmode="numeric" min="0" value="${Number(atual.disponiveis || 0)}"></div>
      <div class="form-group"><label>Alerta abaixo de</label><input id="ttp-stock-min" type="number" inputmode="numeric" min="0" value="${Number(atual.minimo || 0)}"></div>
    </div>
    <div class="form-error" id="ttp-stock-err"></div>
    <button class="btn btn-primary" id="ttp-save-stock">Salvar estoque</button>
    ${item ? '<button class="btn btn-danger-ghost" id="ttp-delete-stock">Excluir estoque</button>' : ''}
    <button class="btn btn-secondary" id="ttp-cancel-stock">Cancelar</button>
  `, sheet => {
    sheet.querySelector('#ttp-save-stock').addEventListener('click', () => {
      try {
        DB.salvarEstoqueTtpost({ id: item?.id, nome: sheet.querySelector('#ttp-stock-name').value,
          pasta: sheet.querySelector('#ttp-stock-folder').value,
          disponiveis: sheet.querySelector('#ttp-stock-count').value,
          minimo: sheet.querySelector('#ttp-stock-min').value });
        closeSheet(); toast('Estoque salvo ✓'); renderTtpost();
      } catch (err) {
        const el = sheet.querySelector('#ttp-stock-err'); el.textContent = err.message; el.classList.add('show');
      }
    });
    const del = sheet.querySelector('#ttp-delete-stock');
    if (del) del.addEventListener('click', () => {
      if (!confirm(`Excluir o estoque "${item.nome}"?`)) return;
      DB.excluirEstoqueTtpost(item.id); closeSheet(); toast('Estoque excluído'); renderTtpost();
    });
    sheet.querySelector('#ttp-cancel-stock').addEventListener('click', closeSheet);
  });
}

function ttpostRankingRemoto(snapshot) {
  const followers = Array.isArray(snapshot?.followers) ? snapshot.followers : [];
  if (!followers.length) return DB.rankingTtpost();
  const contasLocais = DB.rankingTtpost();
  const contasRemotas = Array.isArray(snapshot.accounts) ? snapshot.accounts : [];
  return followers.map(item => {
    const profileId = String(item.profile_id || '');
    const profileName = String(item.profile_name || profileId || 'Perfil');
    const local = contasLocais.find(c =>
      (profileId && c.profile_id === profileId)
      || String(c.nome_perfil || '').toLowerCase() === profileName.toLowerCase()
    );
    const remoteAccount = contasRemotas.find(c => c.profile_id === profileId);
    return {
      ...(local || {}),
      id: local?.id || '',
      nome_perfil: profileName,
      profile_id: profileId,
      provider: local?.provider || remoteAccount?.provider || (profileId.startsWith('dolphin:') ? 'dolphin' : 'adspower'),
      followers: Number(item.followers || 0),
      media_dia: item.average_per_day == null ? null : Number(item.average_per_day),
      followers_updated_at: item.captured_at || null,
      remote_only: !local,
      active: local?.active !== false,
      custo_operacional: Number(local?.custo_operacional || 0),
    };
  }).sort((a, b) => Number(b.followers || 0) - Number(a.followers || 0));
}

function idMetaTtpost(conta) {
  return String(conta.profile_id || conta.id || conta.nome_perfil || '').trim().toLowerCase();
}

async function verificarMetasTtpost(ranking) {
  const meta = DB.getMetaSeguidoresTtpost();
  if (!meta || !Array.isArray(ranking) || typeof Notification === 'undefined' || Notification.permission !== 'granted') return 0;
  const atingidas = ranking.filter(c =>
    c.active !== false
    && Number(c.followers || 0) >= meta
    && idMetaTtpost(c)
    && !DB.metaTtpostJaNotificada(idMetaTtpost(c))
  );
  if (!atingidas.length) return 0;

  const nomes = atingidas.map(c => c.nome_perfil || c.farm?.username || 'Perfil');
  const titulo = atingidas.length === 1 ? 'Meta de seguidores atingida' : `${atingidas.length} contas atingiram a meta`;
  const body = atingidas.length === 1
    ? `${nomes[0]} chegou a ${_numero.format(meta)} seguidores.`
    : `${nomes.slice(0, 3).join(', ')}${nomes.length > 3 ? ` e mais ${nomes.length - 3}` : ''} chegaram a ${_numero.format(meta)} seguidores.`;

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(titulo, {
        body,
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        tag: `ttpost-meta-${meta}`,
        data: { url: './#/ttpost' },
      });
    } else {
      new Notification(titulo, { body, icon: 'icons/icon-192.png', tag: `ttpost-meta-${meta}` });
    }
    atingidas.forEach(c => DB.marcarMetaTtpostNotificada(idMetaTtpost(c)));
    return atingidas.length;
  } catch (_err) {
    return 0;
  }
}

function ttpostMetaSheet(ranking) {
  openSheet(`
    <h3>Meta de seguidores</h3>
    <div class="form-group">
      <label>Meta para todas as contas</label>
      <input id="ttp-global-goal" type="number" inputmode="numeric" min="0" value="${DB.getMetaSeguidoresTtpost() || ''}" placeholder="Ex.: 10000">
    </div>
    <div class="field-hint ttp-sheet-hint">A mesma meta será aplicada a todas as contas. Quando uma conta atingir o valor, este celular recebe uma notificação.</div>
    <div class="form-error" id="ttp-meta-err"></div>
    <button class="btn btn-primary" id="ttp-save-meta">Salvar meta</button>
    <button class="btn btn-secondary" id="ttp-cancel-meta">Cancelar</button>
  `, sheet => {
    sheet.querySelector('#ttp-save-meta').addEventListener('click', async () => {
      const errEl = sheet.querySelector('#ttp-meta-err');
      try {
        DB.setMetaSeguidoresTtpost(sheet.querySelector('#ttp-global-goal').value);
        let permission = typeof Notification === 'undefined' ? 'indisponivel' : Notification.permission;
        if (permission === 'default') permission = await Notification.requestPermission();
        closeSheet();
        const notificadas = await verificarMetasTtpost(ranking);
        if (permission === 'granted') toast(notificadas ? 'Meta salva e notificação enviada ✓' : 'Meta salva · notificações ativas ✓');
        else toast('Meta salva · permita notificações no celular');
        renderTtpost(true);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.add('show');
      }
    });
    sheet.querySelector('#ttp-cancel-meta').addEventListener('click', closeSheet);
  });
}

// Marcação manual de quais perfis falharam a postagem de hoje. Vale só para o
// dia atual (some sozinho ao virar o dia).
function ttpostFalhasSheet(ranking) {
  const perfis = (Array.isArray(ranking) ? ranking : []).map(c => ({
    key: idMetaTtpost(c),
    nome: c.nome_perfil || c.farm?.username || 'Perfil',
    provider: TTPOST_SCOPE_LABEL[c.provider] || c.provider || '',
  })).filter(p => p.key);
  const marcadas = new Set(DB.getFalhasPostagemHoje());

  openSheet(`
    <h3>Falhas de postagem — hoje</h3>
    <div class="field-hint ttp-sheet-hint">Marque os perfis que <b>não</b> conseguiram postar hoje. A marcação vale só para hoje e some sozinha amanhã.</div>
    ${perfis.length ? `
      <div class="opts ttp-falhas-lista">
        ${perfis.map(p => `
          <button type="button" class="opt ttp-falha-opt ${marcadas.has(p.key) ? 'marcada' : ''}" data-key="${esc(p.key)}">
            <span><strong>${esc(p.nome)}</strong>${p.provider ? `<small>${esc(p.provider)}</small>` : ''}</span>
            <span class="check">${marcadas.has(p.key) ? '✓' : ''}</span>
          </button>`).join('')}
      </div>` : '<div class="card ttp-compact-empty">Nenhum perfil disponível para marcar ainda.</div>'}
    <div class="form-error" id="ttp-falhas-err"></div>
    <button class="btn btn-primary" id="ttp-save-falhas">Salvar falhas</button>
    <button class="btn btn-secondary" id="ttp-cancel-falhas">Cancelar</button>
  `, sheet => {
    sheet.querySelectorAll('.ttp-falha-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        const on = btn.classList.toggle('marcada');
        btn.querySelector('.check').textContent = on ? '✓' : '';
      });
    });
    sheet.querySelector('#ttp-save-falhas').addEventListener('click', () => {
      const keys = [...sheet.querySelectorAll('.ttp-falha-opt.marcada')].map(b => b.dataset.key);
      DB.definirFalhasPostagemHoje(keys);
      closeSheet();
      toast(keys.length ? `${keys.length} falha(s) marcada(s) ✓` : 'Falhas limpas ✓');
      renderTtpost(true);
    });
    sheet.querySelector('#ttp-cancel-falhas').addEventListener('click', closeSheet);
  });
}

function renderTtpost(skipRemoteRefresh = false) {
  const resumoLocal = DB.resumoTtpost();
  const bridge = TTPOST_BRIDGE.state();
  const snapshot = bridge.snapshot;
  const summary = snapshot?.summary || null;
  const ranking = ttpostRankingRemoto(snapshot);
  const falhasMarcadas = DB.getFalhasPostagemHoje();
  const metaSeguidores = DB.getMetaSeguidoresTtpost();
  const rankingExpandido = APP_PREFS.get().ranking_expandido;
  const rankingVisivel = rankingExpandido ? ranking : ranking.slice(0, 3);
  const estoquesRemotos = Array.isArray(snapshot?.presets) ? snapshot.presets.map(p => ({
    id: `remote-${p.preset_id}`,
    nome: p.name || 'Preset',
    pasta: p.folder || '',
    disponiveis: Number.isFinite(Number(p.videos_available)) ? Number(p.videos_available) : 0,
    duplicada: !!p.duplicate_folder,
    remoto: true,
  })) : [];
  const estoques = estoquesRemotos.length ? estoquesRemotos : DB.listarEstoquesTtpost();
  const resumo = summary ? {
    ...resumoLocal,
    contas: Number(summary.accounts_in_presets || 0),
    ativas: Number(summary.accounts_in_presets || 0),
    postsHoje: Number(summary.posts_today || 0),
    falhasHoje: Number(summary.failures_today || 0),
    aquecimentosHoje: Number(Boolean(summary.browser_warming)) + Number(Boolean(summary.mobile_warming)),
    videos: Number(summary.videos_available || 0),
    estoquesBaixos: 0,
    atualizado_em: bridge.synced_at || snapshot.generated_at || null,
  } : resumoLocal;
  const statusClass = bridge.snapshot ? 'connected' : (bridge.error ? 'error' : 'pending');
  const statusTitle = bridge.snapshot ? 'Conectado ao TTpost desktop'
    : (bridge.configured ? 'Aguardando dados do TTpost' : 'Ponte online não conectada');
  const statusDetail = bridge.error ? bridge.error
    : (resumo.atualizado_em ? `Atualizado ${fmtDataHora(resumo.atualizado_em)}`
    : 'Configure o token para receber os dados automaticamente');

  $view.innerHTML = `
    <div class="page-head">
      <div class="page-head-row ttp-head-row">
        <h1>TTpost</h1>
        <div class="ttp-head-actions">
          <button class="btn-small" id="ttp-config-bridge">Conexão</button>
          <button class="btn-small" id="ttp-meta">Meta</button>
        </div>
      </div>
    </div>

    <div class="ttp-status ${statusClass}">
      <span class="ttp-status-dot"></span>
      <div><b>${esc(statusTitle)}</b><small>${esc(statusDetail)}</small></div>
    </div>

    <div class="stats-grid ttp-stats">
      <div class="stat"><div class="label">Contas ativas</div><div class="value">${resumo.ativas}</div><div class="sub">${snapshot ? 'nos Presets do PC' : `de ${resumo.contas} vinculadas`}</div></div>
      <button type="button" class="stat stat-clicavel" id="ttp-posts-stat"><div class="label">Posts hoje</div><div class="value">${resumo.postsHoje}</div><div class="sub">${falhasMarcadas.length} falha(s) marcada(s) ›</div></button>
      <div class="stat"><div class="label">${snapshot ? 'Aquecendo agora' : 'Aquecimentos hoje'}</div><div class="value">${resumo.aquecimentosHoje}</div></div>
      <div class="stat"><div class="label">Vídeos disponíveis</div><div class="value ${resumo.estoquesBaixos ? 'neg' : ''}">${resumo.videos}</div><div class="sub">${snapshot ? 'nas pastas dos Presets' : `${resumo.estoquesBaixos} estoque(s) baixo(s)`}</div></div>
    </div>

    <div class="section-row"><h2>Ranking de seguidores</h2>${ranking.length > 3 ? `<button class="collapse-toggle section-toggle ${rankingExpandido ? 'open' : ''}" id="ttp-toggle-ranking" type="button" aria-label="${rankingExpandido ? 'Mostrar somente as três maiores contas' : 'Mostrar todas as contas'}" aria-expanded="${rankingExpandido}">⌄</button>` : ''}</div>
    <div class="ttp-ranking-head"><span>User</span><span>Qtd. seg.</span><span>Média seg./d</span></div>
    <div class="ttp-ranking">
      ${ranking.length ? rankingVisivel.map((c, i) => {
        const nome = c.nome_perfil || c.farm?.username || 'Perfil';
        const media = c.media_dia == null ? '—' : `${c.media_dia >= 0 ? '+' : ''}${_numero.format(c.media_dia)}`;
        const meta = metaSeguidores;
        const pct = meta > 0 ? Math.min(100, Number(c.followers || 0) / meta * 100) : 0;
        const tag = c.id ? 'button' : 'div';
        const accountAttr = c.id ? ` data-ttp-account="${c.id}"` : '';
        return `<${tag} class="ttp-rank-row ${c.active === false ? 'inactive' : ''} ${c.remote_only ? 'remote-only' : ''}"${accountAttr}>
          <span class="ttp-rank-user"><b class="ttp-position">#${i + 1}</b><span><strong>${esc(nome)}</strong><small>${TTPOST_SCOPE_LABEL[c.provider] || c.provider}</small></span></span>
          <span class="ttp-followers">${_numero.format(c.followers)}</span>
          <span class="ttp-average ${c.media_dia > 0 ? 'pos' : c.media_dia < 0 ? 'neg' : ''}">${media}</span>
          ${meta > 0 ? `<span class="ttp-goal"><span style="--pct:${pct}%"></span><small>Meta ${_numero.format(meta)} · ${pct.toFixed(0)}%</small></span>` : '<span class="ttp-goal empty-goal"><small>Sem meta</small></span>'}
        </${tag}>`;
      }).join('') : `<div class="card empty ttp-empty"><p>${bridge.configured ? 'O TTpost ainda não enviou seguidores.' : 'Conecte a ponte para receber o ranking automaticamente.'}</p></div>`}
    </div>

    <div class="section-row"><h2>Estoque de vídeos</h2></div>
    <div class="ttp-stock-list">
      ${estoques.length ? estoques.map(e => {
        const baixo = !e.remoto && Number(e.disponiveis) <= Number(e.minimo);
        const tag = e.remoto ? 'div' : 'button';
        const stockAttr = e.remoto ? '' : ` data-ttp-stock="${e.id}"`;
        const pasta = e.duplicada ? 'Mesma pasta de outro preset — não somada' : (esc(e.pasta) || 'Pasta ainda não informada');
        return `<${tag} class="ttp-stock-row${e.duplicada ? ' repetida' : ''}"${stockAttr}><span><strong>${esc(e.nome)}</strong><small>${pasta}</small></span><b class="${baixo ? 'neg' : ''}">${e.disponiveis}</b></${tag}>`;
      }).join('') : '<div class="card ttp-compact-empty">Os estoques aparecerão aqui quando o TTpost enviar os Presets.</div>'}
    </div>

    <div class="section-row"><h2>Central remota</h2></div>
    <div class="card ttp-bridge-card">
      <div><strong>${esc(statusTitle)}</strong><span>${bridge.snapshot ? 'Sincronização automática disponível' : `${resumo.comandosPendentes} comando(s) aguardando envio`}</span></div>
      <p>${bridge.snapshot ? 'Os seguidores, posts e vídeos vêm diretamente do banco do TTpost no computador.' : 'Configure o token seguro uma vez neste aparelho para receber o ranking automaticamente.'}</p>
      <div class="ttp-bridge-actions">
        ${bridge.configured ? '<button class="btn btn-secondary" id="ttp-refresh-bridge">Atualizar agora</button>' : ''}
        <button class="btn btn-secondary" id="ttp-open-bridge">${bridge.configured ? 'Configurar conexão' : 'Conectar Supabase'}</button>
      </div>
    </div>
  `;

  document.getElementById('ttp-config-bridge').addEventListener('click', ttpostBridgeSheet);
  document.getElementById('ttp-open-bridge').addEventListener('click', ttpostBridgeSheet);
  document.getElementById('ttp-meta').addEventListener('click', () => ttpostMetaSheet(ranking));
  document.getElementById('ttp-posts-stat').addEventListener('click', () => ttpostFalhasSheet(ranking));
  const rankingToggle = document.getElementById('ttp-toggle-ranking');
  if (rankingToggle) rankingToggle.addEventListener('click', () => {
    APP_PREFS.set({ ranking_expandido: !APP_PREFS.get().ranking_expandido });
    renderTtpost(true);
  });
  document.querySelectorAll('[data-ttp-account]').forEach(btn => btn.addEventListener('click', () => {
    ttpostContaSheet(DB.listarContasTtpost().find(c => c.id === btn.dataset.ttpAccount));
  }));
  document.querySelectorAll('[data-ttp-stock]').forEach(btn => btn.addEventListener('click', () => {
    ttpostEstoqueSheet(DB.listarEstoquesTtpost().find(e => e.id === btn.dataset.ttpStock));
  }));
  const refreshButton = document.getElementById('ttp-refresh-bridge');
  if (refreshButton) refreshButton.addEventListener('click', async () => {
    refreshButton.disabled = true;
    refreshButton.textContent = 'Atualizando...';
    try {
      await TTPOST_BRIDGE.refresh();
      await verificarMetasTtpost(ttpostRankingRemoto(TTPOST_BRIDGE.state().snapshot));
      toast('Dados atualizados ✓');
    } catch (err) {
      toast(err.message);
    }
    renderTtpost(true);
  });

  if (!skipRemoteRefresh && bridge.configured && !bridge.refreshing) {
    sincronizarTtpost();
  }
}

/* ============================================================
   CONFIGURAÇÕES  (#/configuracoes)
   ============================================================ */
function renderConfiguracoes() {
  const formato = APP_PREFS.get().roi_formato;
  const opcoes = [
    ['percentual', 'Percentual', 'Exibe 100,0% ou 200,0%'],
    ['multiplicador', 'Multiplicador', 'Exibe 2,0x ou 3,0x'],
  ];
  const crescendoComCusto = DB.listarFarm({ status: 'Crescendo' })
    .filter(f => Number(f.custo_proprio || 0) > 0 || Number(f.custo_recursos_legado || 0) > 0);
  const totalAZerar = crescendoComCusto.reduce((s, f) =>
    s + Number(f.custo_proprio || 0) + Number(f.custo_recursos_legado || 0), 0);

  $view.innerHTML = `
    <a class="back-link" href="#/">
      <svg viewBox="0 0 12 12"><path d="M8 1L3 6l5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
      Início
    </a>
    <div class="page-head">
      <h1>Configurações</h1>
      <div class="subtitle">Preferências de exibição do app</div>
    </div>

    <div class="card settings-card">
      <div class="setting-title">Formato do ROI</div>
      <div class="setting-options">
        ${opcoes.map(([valor, titulo, descricao]) => `
          <button class="setting-option ${formato === valor ? 'active' : ''}" type="button" data-roi-format="${valor}" aria-pressed="${formato === valor}">
            <span><strong>${titulo}</strong><small>${descricao}</small></span>
            <b>${formato === valor ? '✓' : ''}</b>
          </button>`).join('')}
      </div>
    </div>

    <div class="card settings-card">
      <div class="setting-title">Zerar custos das contas em Crescendo</div>
      <p style="font-size:13px;color:var(--ink-2);margin:8px 0 12px;">
        Apaga o custo de aquisição e o custo de recursos antigo das contas em
        Crescendo, para elas passarem a ter custo só pelos Custos do mês.
        Vendidas e outros estágios não são tocados.
      </p>
      <div class="detail-row"><span class="k">Contas afetadas</span><span class="v">${crescendoComCusto.length}</span></div>
      <div class="detail-row"><span class="k">Custo que será apagado</span><span class="v">${fmtBRL(totalAZerar)}</span></div>
      <button class="btn btn-danger-ghost" id="btn-zerar-custos" ${crescendoComCusto.length ? '' : 'disabled'}>Zerar custos</button>
    </div>
  `;

  document.querySelectorAll('[data-roi-format]').forEach(btn => {
    btn.addEventListener('click', () => {
      APP_PREFS.set({ roi_formato: btn.dataset.roiFormat });
      toast('Formato do ROI atualizado ✓');
      renderConfiguracoes();
    });
  });

  document.getElementById('btn-zerar-custos').addEventListener('click', () => {
    if (!confirm(`Zerar ${fmtBRL(totalAZerar)} de custo em ${crescendoComCusto.length} conta(s) em Crescendo? Faça um backup antes — isso não tem como desfazer.`)) return;
    const n = DB.zerarCustosFarmCrescendo();
    toast(`${n} conta(s) zerada(s) ✓`);
    renderConfiguracoes();
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
      <div class="detail-row"><span class="k">Contas no TTpost</span><span class="v">${t.ttpostContas}</span></div>
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

    ${searchHTML('farm-search', 'Pesquisar username')}

    <a class="recurso-link" href="#/farm/lotes">
      <span class="rl-left"><svg class="rl-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"/></svg>Lotes${ind.lotes ? ` (${ind.lotes})` : ''}</span>
      <span class="op-chevron">›</span>
    </a>

    <a class="recurso-link" href="#/farm/custos-fixos">
      <span class="rl-left"><svg class="rl-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M3 6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6zm0 8a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4zm4-6.5A.5.5 0 0 1 7.5 7h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 1-.5-.5zM7 16h4v1H7v-1z"/></svg>Custos fixos${ind.custosFixos > 0 ? ` · ${fmtBRL(ind.custosFixos)}/mês` : ''}</span>
      <span class="op-chevron">›</span>
    </a>

    <p class="recurso-hint" style="margin-top:14px;">Resultado de <strong>${MESES_ABREV[ind.mes]}/${ind.ano}</strong> — zera sozinho todo mês.</p>
    <div class="stats-grid">
      <div class="stat wide">
        <div class="label">Lucro do mês</div>
        <div class="value ${ind.lucro >= 0 ? 'pos' : 'neg'}">${fmtBRL(ind.lucro)}</div>
        <div class="sub">Faturamento ${fmtBRL(ind.receita)} − custo ${fmtBRL(ind.investido)}</div>
      </div>
      <div class="stat">
        <div class="label">Custo do mês</div>
        <div class="value">${fmtBRL(ind.investido)}</div>
        <div class="sub">${fmtBRL(ind.custoLotes)} lotes + ${fmtBRL(ind.custosFixos)} fixos</div>
      </div>
      <div class="stat">
        <div class="label">Faturamento do mês</div>
        <div class="value">${fmtBRL(ind.receita)}</div>
      </div>
      <div class="stat">
        <div class="label">Em farm agora</div>
        <div class="value">${ind.ativas}</div>
        <div class="sub">${ind.total} no total</div>
      </div>
      <div class="stat">
        <div class="label">Vendidas no mês</div>
        <div class="value">${ind.vendidas}</div>
        <div class="sub">${ind.vendidasTotal} no total</div>
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
    ${searchHTML('farm-lista-search', 'Pesquisar username')}
    <div class="chips" id="farm-chips">
      ${statusList.map(s => `<button class="chip ${farmListaState.status === s ? 'active' : ''}" data-status="${esc(s)}">${esc(s)}</button>`).join('')}
    </div>
    <div class="sort-row">
      <span id="farm-count"></span>
      <label>Ordenar:
        <select id="farm-ordenar">
          <option value="recente">Mais recente</option>
          <option value="antiga">Mais antiga</option>
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
        <label>Email</label>
        <div class="email-search">
          <input name="email" id="farm-email" type="email" placeholder="Digite para buscar na reserva" autocapitalize="none" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="farm-email-search-results">
          <div class="email-search-results hidden" id="farm-email-search-results" role="listbox"></div>
        </div>
        <div class="field-hint" id="farm-email-search-hint">Digite pelo menos 2 caracteres para encontrar um email disponível.</div>
      </div>
      <div class="form-group">
        <label>Senha do email</label>
        <input name="senha" id="farm-senha" type="text" placeholder="Senha do email" autocapitalize="none" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Senha do TikTok</label>
        <input name="senha_tiktok" type="text" placeholder="Senha da conta do TikTok" autocapitalize="none" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Lote</label>
        <div class="select-wrap">
          <select name="lote_id">
            <option value="">Sem lote</option>
            ${DB.listarFarmLotes().map(l => `<option value="${esc(l.id)}">${esc(l.nome)}</option>`).join('')}
          </select>
        </div>
        <div class="field-hint">Vincule a conta a um lote existente para agrupar custo e faturamento.</div>
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

  const emailsDisponiveis = DB.listarEmails('Disponível');
  const $email = document.getElementById('farm-email');
  const $senha = document.getElementById('farm-senha');
  const $resultados = document.getElementById('farm-email-search-results');
  const $hint = document.getElementById('farm-email-search-hint');
  let emailReservaSelecionado = null;

  if (!emailsDisponiveis.length) {
    $hint.textContent = 'Nenhum email disponível na reserva. Você ainda pode preencher manualmente.';
  }

  function fecharBuscaEmail() {
    $resultados.classList.add('hidden');
    $email.setAttribute('aria-expanded', 'false');
  }

  function limparSelecaoEmail() {
    if (!emailReservaSelecionado) return;
    emailReservaSelecionado = null;
    $hint.textContent = emailsDisponiveis.length
      ? 'Digite pelo menos 2 caracteres para encontrar um email disponível.'
      : 'Nenhum email disponível na reserva. Você ainda pode preencher manualmente.';
  }

  function atualizarBuscaEmail() {
    const termo = $email.value.trim().toLowerCase();
    if (emailReservaSelecionado && termo !== emailReservaSelecionado.email.toLowerCase()) {
      limparSelecaoEmail();
      $senha.value = '';
    }
    if (emailReservaSelecionado || termo.length < 2 || !emailsDisponiveis.length) {
      fecharBuscaEmail();
      return;
    }

    const encontrados = emailsDisponiveis
      .filter(e => e.email.toLowerCase().includes(termo))
      .slice(0, 5);
    $resultados.innerHTML = encontrados.length
      ? encontrados.map(e => `
          <button type="button" class="email-search-option" role="option" data-email-reserva="${e.id}">
            <span>${esc(e.email)}</span>
            <small>${esc(e.senha) || 'Sem senha'}</small>
          </button>`).join('')
      : '<div class="email-search-empty">Nenhum email disponível encontrado.</div>';
    $resultados.classList.remove('hidden');
    $email.setAttribute('aria-expanded', 'true');
  }

  $email.addEventListener('input', atualizarBuscaEmail);
  $email.addEventListener('focus', atualizarBuscaEmail);
  $email.addEventListener('keydown', e => {
    if (e.key === 'Escape') fecharBuscaEmail();
  });
  $email.addEventListener('blur', () => setTimeout(fecharBuscaEmail, 120));
  $senha.addEventListener('input', () => {
    if (emailReservaSelecionado && $senha.value !== emailReservaSelecionado.senha) limparSelecaoEmail();
  });
  $resultados.addEventListener('click', e => {
    const opcao = e.target.closest('[data-email-reserva]');
    if (!opcao) return;
    const selecionado = emailsDisponiveis.find(item => item.id === opcao.dataset.emailReserva);
    if (!selecionado) return;
    emailReservaSelecionado = selecionado;
    $email.value = selecionado.email;
    $senha.value = selecionado.senha;
    $hint.textContent = 'Email da reserva selecionado. Será marcado como usado ao adicionar ao farm.';
    fecharBuscaEmail();
    $senha.focus();
  });

  document.getElementById('form-farm').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const conta = DB.criarFarm({
        username: f.get('username'),
        email: f.get('email'),
        senha: f.get('senha'),
        senha_tiktok: f.get('senha_tiktok'),
        lote_id: f.get('lote_id') || null,
        status: f.get('status'),
        observacoes: f.get('observacoes'),
        email_reserva_id: emailReservaSelecionado ? emailReservaSelecionado.id : null,
      });
      toast(emailReservaSelecionado ? 'Conta adicionada e email marcado como usado ✓' : 'Conta adicionada ao farm ✓');
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
  const vendida = c.status === 'Vendida';
  const lote = c.lote_id ? DB.getFarmLote(c.lote_id) : null;

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
      <div class="detail-row"><span class="k">Username</span><span class="v">@${esc(c.username.replace(/^@/, ''))} ${copyBtnHTML('username')}</span></div>
      <div class="detail-row"><span class="k">Email</span><span class="v">${esc(c.email) || '—'}${c.email ? ' ' + copyBtnHTML('email') : ''}</span></div>
      <div class="detail-row">
        <span class="k">Senha do email</span>
        <span class="v">
          <span id="senha-v">${c.senha ? '••••••••' : '—'}</span>
          ${c.senha ? '<button class="senha-toggle" id="senha-toggle">mostrar</button>' : ''}
          ${c.senha ? copyBtnHTML('senha') : ''}
        </span>
      </div>
      <div class="detail-row">
        <span class="k">Senha do TikTok</span>
        <span class="v">
          <span id="senhatt-v">${c.senha_tiktok ? '••••••••' : '—'}</span>
          ${c.senha_tiktok ? '<button class="senha-toggle" id="senhatt-toggle">mostrar</button>' : ''}
          ${c.senha_tiktok ? copyBtnHTML('senha_tiktok') : ''}
        </span>
      </div>
    </div>

    <h2>Situação</h2>
    <div class="card detail-rows">
      <div class="detail-row"><span class="k">Lote</span><span class="v">${lote ? `<a href="#/farm/lote/${lote.id}">${esc(lote.nome)}</a>` : 'Sem lote'}</span></div>
      <div class="detail-row"><span class="k">Estágio</span><span class="v"><span class="badge ${esc(badgeSlug(c.status))}">${esc(c.status)}</span></span></div>
      <div class="detail-row"><span class="k">Início do farm</span><span class="v">${fmtData(c.data_inicio)}</span></div>
      <div class="detail-row"><span class="k">Vendida</span><span class="v">${vendida ? 'Sim' : 'Não'}</span></div>
      <div class="detail-row"><span class="k">Data da venda</span><span class="v">${fmtData(c.data_venda)}</span></div>
    </div>

    ${c.observacoes ? `
      <div class="section-row"><h2>Observações</h2>${copyBtnHTML('observacoes')}</div>
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
      ${!vendida ? `<a class="btn btn-success" href="#/farm/venda/${c.id}">Marcar como vendida</a>` : ''}
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
  const $tgTt = document.getElementById('senhatt-toggle');
  if ($tgTt) {
    let visivel = false;
    $tgTt.addEventListener('click', () => {
      visivel = !visivel;
      document.getElementById('senhatt-v').textContent = visivel ? c.senha_tiktok : '••••••••';
      $tgTt.textContent = visivel ? 'ocultar' : 'mostrar';
    });
  }

  // Copiar campo individual (usuário, email, senha, observações)
  document.querySelectorAll('[data-copiar]').forEach(btn => {
    btn.addEventListener('click', () => {
      const campo = btn.dataset.copiar;
      const valor = campo === 'username' ? c.username.replace(/^@/, '') : (c[campo] || '');
      if (!valor) return;
      copiarTexto(valor)
        .then(() => toast('Copiado ✓'))
        .catch(() => toast('Não foi possível copiar'));
    });
  });

  // Cancelar venda (comprador desistiu): desfaz o financeiro e volta ao estágio padrão
  const $cancelar = document.getElementById('btn-cancelar-venda');
  if ($cancelar) {
    $cancelar.addEventListener('click', () => {
      if (confirm(`Cancelar a venda de @${c.username.replace(/^@/, '')}? A conta volta para "Crescendo".`)) {
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
          // "Vendida" passa pela tela de venda para capturar a data.
          if (novo === 'Vendida' && c.status !== 'Vendida') {
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
  if (c.status === 'Vendida') { location.hash = '#/farm/conta/' + id; return; }
  const lote = c.lote_id ? DB.getFarmLote(c.lote_id) : null;

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
      <h1>Marcar como vendida</h1>
      <div class="subtitle">@${esc(c.username.replace(/^@/, ''))}</div>
    </div>

    <form id="form-farm-venda" novalidate>
      <div class="form-group">
        <label>Data da venda</label>
        <input name="data_venda" type="date" value="${hojeStr}">
      </div>
      <div class="form-group">
        <label>Observações</label>
        <textarea name="observacoes" placeholder="Anotações sobre a venda"></textarea>
      </div>
      <p class="recurso-hint">O faturamento e o lucro desta venda são lançados no ${lote ? esc(lote.nome) : 'lote da conta'}, na tela de Lotes.</p>
      <div class="form-error" id="form-error"></div>
      <button class="btn btn-success" type="submit">Confirmar</button>
    </form>
  `;

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
        data_venda: dataVenda,
        observacoes: f.get('observacoes'),
      });
      toast('Conta marcada como vendida ✓');
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
        <label>Email</label>
        <input name="email" type="email" value="${esc(c.email)}" autocapitalize="none" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Senha do email</label>
        <input name="senha" type="text" value="${esc(c.senha)}" autocapitalize="none" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Senha do TikTok</label>
        <input name="senha_tiktok" type="text" value="${esc(c.senha_tiktok)}" autocapitalize="none" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Lote</label>
        <div class="select-wrap">
          <select name="lote_id">
            <option value="" ${!c.lote_id ? 'selected' : ''}>Sem lote</option>
            ${DB.listarFarmLotes().map(l => `<option value="${esc(l.id)}" ${c.lote_id === l.id ? 'selected' : ''}>${esc(l.nome)}</option>`).join('')}
          </select>
        </div>
      </div>
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
        email: f.get('email'),
        senha: f.get('senha'),
        senha_tiktok: f.get('senha_tiktok'),
        lote_id: f.get('lote_id') || null,
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
        <div class="sub">ROI de ${res.investimento > 0 ? fmtROI(res.roi) : '—'}</div>
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
      <div class="detail-row"><span class="k">ROI do mês</span><span class="v ${roiMes >= 0 ? 'pos' : 'neg'}">${investimento > 0 ? fmtROI(roiMes) : '—'}</span></div>
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
   LOTES DO FARM  (#/farm/lotes  ·  #/farm/lote/:id)
   Custo total e faturamento agrupados por lote de contas.
   ============================================================ */
function loteItemHTML(l) {
  const r = DB.resumoLote(l);
  return `
    <a class="conta-item" href="#/farm/lote/${l.id}">
      <div class="avatar">L</div>
      <div class="info">
        <div class="username">${esc(l.nome)}</div>
        <div class="meta">${r.contas} conta(s) · custo ${fmtBRL(r.custo)}</div>
      </div>
      <div class="fin">
        <div class="lucro ${r.lucro >= 0 ? 'pos' : 'neg'}">${fmtBRL(r.lucro)}</div>
        <div class="valores">Fat: ${fmtBRL(r.receita)}</div>
      </div>
    </a>`;
}

function renderFarmLotes() {
  const lotes = DB.listarFarmLotes();
  const totalCusto = lotes.reduce((s, l) => s + DB.resumoLote(l).custo, 0);
  const totalReceita = lotes.reduce((s, l) => s + DB.resumoLote(l).receita, 0);

  $view.innerHTML = `
    <a class="back-link" href="#/farm">
      <svg viewBox="0 0 12 12"><path d="M8 1L3 6l5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
      Farm
    </a>
    <div class="page-head">
      <div class="page-head-row">
        <div><h1>Lotes</h1><div class="subtitle">Custo e faturamento por lote</div></div>
        <button class="btn-small" id="btn-novo-lote">+ Novo lote</button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat">
        <div class="label">Lucro dos lotes</div>
        <div class="value ${totalReceita - totalCusto >= 0 ? 'pos' : 'neg'}">${fmtBRL(totalReceita - totalCusto)}</div>
      </div>
      <div class="stat">
        <div class="label">Custo total</div>
        <div class="value">${fmtBRL(totalCusto)}</div>
      </div>
      <div class="stat">
        <div class="label">Faturamento</div>
        <div class="value">${fmtBRL(totalReceita)}</div>
      </div>
      <div class="stat">
        <div class="label">Lotes</div>
        <div class="value">${lotes.length}</div>
      </div>
    </div>

    <h2>Seus lotes</h2>
    <div class="conta-list">
      ${lotes.length
        ? lotes.map(loteItemHTML).join('')
        : `<div class="card empty"><p>Nenhum lote ainda.<br>Toque em <strong>+ Novo lote</strong> para começar.</p></div>`}
    </div>
  `;

  document.getElementById('btn-novo-lote').addEventListener('click', () => {
    openSheet(`
      <h3>Novo lote</h3>
      <div class="form-group">
        <label>Nome do lote</label>
        <input id="inp-lote-nome" type="text" placeholder="Ex.: Lote 1">
      </div>
      <div class="form-error" id="sheet-err"></div>
      <button class="btn btn-primary" id="save-lote">Criar lote</button>
      <button class="btn btn-secondary" id="cancel-lote">Cancelar</button>
    `, sheet => {
      const nome = sheet.querySelector('#inp-lote-nome');
      setTimeout(() => nome.focus(), 50);
      sheet.querySelector('#save-lote').addEventListener('click', () => {
        try {
          const lote = DB.criarFarmLote({ nome: nome.value });
          closeSheet();
          toast('Lote criado ✓');
          location.hash = '#/farm/lote/' + lote.id;
        } catch (err) {
          const e = sheet.querySelector('#sheet-err');
          e.textContent = err.message; e.classList.add('show');
        }
      });
      sheet.querySelector('#cancel-lote').addEventListener('click', closeSheet);
    });
  });
}

function renderFarmLoteDetalhes(id) {
  const l = DB.getFarmLote(id);
  if (!l) {
    $view.innerHTML = `<div class="card empty"><p>Lote não encontrado.</p></div>`;
    return;
  }
  const r = DB.resumoLote(l);
  const contas = DB.contasDoLote(id);
  const receitas = [...l.receitas].sort((a, b) => String(b.data).localeCompare(String(a.data)));

  $view.innerHTML = `
    <a class="back-link" href="#/farm/lotes">
      <svg viewBox="0 0 12 12"><path d="M8 1L3 6l5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
      Lotes
    </a>
    <div class="page-head">
      <div class="page-head-row">
        <div><h1>${esc(l.nome)}</h1><div class="subtitle">${contas.length} conta(s) no lote</div></div>
        <button class="btn-small" id="btn-renomear-lote">Renomear</button>
      </div>
    </div>

    <h2>Financeiro do lote</h2>
    <div class="card detail-rows">
      <div class="detail-row"><span class="k">Custo total</span><span class="v">${fmtBRL(r.custo)} <button class="senha-toggle" id="btn-custo-lote">${r.custo > 0 ? 'editar' : 'definir'}</button></span></div>
      <div class="detail-row"><span class="k">Faturamento</span><span class="v">${fmtBRL(r.receita)}</span></div>
      <div class="detail-row"><span class="k">Lucro do lote</span><span class="v ${r.lucro >= 0 ? 'pos' : 'neg'}" style="font-weight:700;">${fmtBRL(r.lucro)}</span></div>
    </div>

    <div class="section-row">
      <h2>Faturamentos</h2>
      <button class="btn-small" id="btn-add-receita">+ Faturamento</button>
    </div>
    <div class="card" id="receitas-lista">
      ${receitas.length
        ? receitas.map(rec => `
          <div class="receita-row" data-id="${rec.id}">
            <div class="rr-info">
              <div class="rr-val">${fmtBRL(rec.valor)}</div>
              <div class="rr-meta">${fmtData(rec.data)}${rec.descricao ? ' · ' + esc(rec.descricao) : ''}</div>
            </div>
            <button class="rr-del" data-id="${rec.id}" aria-label="Excluir faturamento">✕</button>
          </div>`).join('')
        : `<div class="empty" style="padding:24px;"><p>Nenhum faturamento lançado ainda.</p></div>`}
    </div>

    <h2>Contas do lote</h2>
    <div class="card detail-rows">
      ${contas.length
        ? contas.map(c => `<div class="detail-row"><span class="k"><a href="#/farm/conta/${c.id}">@${esc(c.username.replace(/^@/, ''))}</a></span><span class="v"><span class="badge ${esc(badgeSlug(c.status))}">${esc(c.status)}</span></span></div>`).join('')
        : '<div class="detail-row"><span class="k">Nenhuma conta vinculada. Vincule no cadastro ou na edição da conta.</span></div>'}
    </div>

    <div style="margin-top:24px;">
      <button class="btn btn-danger-ghost" id="btn-excluir-lote">Excluir lote</button>
    </div>
    <p class="recurso-hint">Excluir o lote não apaga as contas — elas apenas ficam sem lote.</p>
  `;

  document.getElementById('btn-renomear-lote').addEventListener('click', () => {
    openSheet(`
      <h3>Renomear lote</h3>
      <div class="form-group">
        <label>Nome do lote</label>
        <input id="inp-lote-nome" type="text" value="${esc(l.nome)}">
      </div>
      <div class="form-error" id="sheet-err"></div>
      <button class="btn btn-primary" id="save-lote">Salvar</button>
      <button class="btn btn-secondary" id="cancel-lote">Cancelar</button>
    `, sheet => {
      sheet.querySelector('#save-lote').addEventListener('click', () => {
        try {
          DB.renomearFarmLote(id, sheet.querySelector('#inp-lote-nome').value);
          closeSheet(); toast('Lote renomeado ✓'); renderFarmLoteDetalhes(id);
        } catch (err) {
          const e = sheet.querySelector('#sheet-err');
          e.textContent = err.message; e.classList.add('show');
        }
      });
      sheet.querySelector('#cancel-lote').addEventListener('click', closeSheet);
    });
  });

  document.getElementById('btn-custo-lote').addEventListener('click', () => {
    openSheet(`
      <h3>Custo total do lote</h3>
      <div class="form-group">
        <label>Custo total (R$)</label>
        <input id="inp-custo-lote" type="number" inputmode="decimal" step="0.01" min="0" value="${l.custo_total || ''}" placeholder="0,00">
        <div class="field-hint">Quanto custou montar/aquecer todas as contas deste lote.</div>
      </div>
      <div class="form-error" id="sheet-err"></div>
      <button class="btn btn-primary" id="save-custo-lote">Salvar</button>
      <button class="btn btn-secondary" id="cancel-custo-lote">Cancelar</button>
    `, sheet => {
      const inp = sheet.querySelector('#inp-custo-lote');
      setTimeout(() => inp.focus(), 50);
      sheet.querySelector('#save-custo-lote').addEventListener('click', () => {
        try {
          DB.definirCustoLote(id, inp.value);
          closeSheet(); toast('Custo salvo ✓'); renderFarmLoteDetalhes(id);
        } catch (err) {
          const e = sheet.querySelector('#sheet-err');
          e.textContent = err.message; e.classList.add('show');
        }
      });
      sheet.querySelector('#cancel-custo-lote').addEventListener('click', closeSheet);
    });
  });

  document.getElementById('btn-add-receita').addEventListener('click', () => {
    const hoje = new Date();
    const hojeStr = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0') + '-' + String(hoje.getDate()).padStart(2, '0');
    openSheet(`
      <h3>Lançar faturamento</h3>
      <div class="form-group">
        <label>Valor (R$)</label>
        <input id="inp-rec-valor" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0,00">
      </div>
      <div class="form-group">
        <label>Data</label>
        <input id="inp-rec-data" type="date" value="${hojeStr}">
      </div>
      <div class="form-group">
        <label>Descrição (opcional)</label>
        <input id="inp-rec-desc" type="text" placeholder="Ex.: venda de 3 contas">
      </div>
      <div class="form-error" id="sheet-err"></div>
      <button class="btn btn-primary" id="save-rec">Lançar</button>
      <button class="btn btn-secondary" id="cancel-rec">Cancelar</button>
    `, sheet => {
      const valor = sheet.querySelector('#inp-rec-valor');
      setTimeout(() => valor.focus(), 50);
      sheet.querySelector('#save-rec').addEventListener('click', () => {
        try {
          let dataRec = null;
          const dv = sheet.querySelector('#inp-rec-data').value;
          if (dv) {
            const [a, m, d] = dv.split('-').map(Number);
            const ag = new Date();
            dataRec = new Date(a, m - 1, d, ag.getHours(), ag.getMinutes()).toISOString();
          }
          DB.adicionarReceitaLote(id, { valor: valor.value, data: dataRec, descricao: sheet.querySelector('#inp-rec-desc').value });
          closeSheet(); toast('Faturamento lançado ✓'); renderFarmLoteDetalhes(id);
        } catch (err) {
          const e = sheet.querySelector('#sheet-err');
          e.textContent = err.message; e.classList.add('show');
        }
      });
      sheet.querySelector('#cancel-rec').addEventListener('click', closeSheet);
    });
  });

  document.getElementById('receitas-lista').addEventListener('click', e => {
    const btn = e.target.closest('[data-id]');
    if (!btn) return;
    if (!confirm('Excluir este faturamento?')) return;
    try {
      DB.excluirReceitaLote(id, btn.dataset.id);
      renderFarmLoteDetalhes(id);
    } catch (err) { toast(err.message); }
  });

  document.getElementById('btn-excluir-lote').addEventListener('click', () => {
    if (!confirm(`Excluir o ${l.nome}? As contas vinculadas ficam sem lote (não são apagadas).`)) return;
    DB.excluirFarmLote(id);
    toast('Lote excluído');
    location.hash = '#/farm/lotes';
  });
}

/* ============================================================
   FARM — CUSTOS FIXOS  (#/farm/custos-fixos)
   Custos recorrentes da operação; o total entra todo mês no
   cálculo do Farm.
   ============================================================ */
function renderFarmCustosFixos() {
  const itens = DB.listarFarmCustosFixos();
  const total = DB.totalFarmCustosFixosMensal();

  $view.innerHTML = `
    <a class="back-link" href="#/farm">
      <svg viewBox="0 0 12 12"><path d="M8 1L3 6l5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
      Farm
    </a>
    <div class="page-head">
      <div class="page-head-row">
        <div><h1>Custos fixos</h1><div class="subtitle">Custos recorrentes da operação</div></div>
        <button class="btn-small" id="btn-add-fixo">+ Custo</button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat wide">
        <div class="label">Total fixo por mês</div>
        <div class="value">${fmtBRL(total)}</div>
        <div class="sub">Entra todo mês no cálculo do Farm</div>
      </div>
    </div>

    <h2>Lançamentos</h2>
    <div class="card" id="fixos-lista">
      ${itens.length
        ? itens.map(c => `
          <div class="receita-row" data-id="${c.id}">
            <div class="rr-info">
              <div class="rr-val">${fmtBRL(c.valor)}<span style="font-size:12px;color:var(--ink-3);font-weight:500;">/mês</span></div>
              <div class="rr-meta">${esc(c.nome) || 'Custo fixo'}</div>
            </div>
            <button class="rr-del" data-id="${c.id}" aria-label="Excluir custo fixo">✕</button>
          </div>`).join('')
        : `<div class="empty" style="padding:24px;"><p>Nenhum custo fixo ainda.<br>Toque em <strong>+ Custo</strong> para adicionar.</p></div>`}
    </div>
    <p class="recurso-hint">Coloque aqui o que você paga todo mês independente dos lotes: proxies, chips, ferramentas, aluguel de aparelhos etc. O total é descontado do lucro do Farm de cada mês.</p>
  `;

  document.getElementById('btn-add-fixo').addEventListener('click', () => abrirSheetCustoFixo());

  document.getElementById('fixos-lista').addEventListener('click', e => {
    const del = e.target.closest('.rr-del');
    if (del) {
      if (!confirm('Excluir este custo fixo?')) return;
      DB.excluirFarmCustoFixo(del.dataset.id);
      renderFarmCustosFixos();
      return;
    }
    const row = e.target.closest('.receita-row');
    if (row) {
      const item = DB.listarFarmCustosFixos().find(c => c.id === row.dataset.id);
      if (item) abrirSheetCustoFixo(item);
    }
  });
}

function abrirSheetCustoFixo(item) {
  const editando = !!item;
  openSheet(`
    <h3>${editando ? 'Editar custo fixo' : 'Novo custo fixo'}</h3>
    <div class="form-group">
      <label>Nome</label>
      <input id="inp-fixo-nome" type="text" value="${editando ? esc(item.nome) : ''}" placeholder="Ex.: Proxies, chips, ferramenta…">
    </div>
    <div class="form-group">
      <label>Valor por mês (R$)</label>
      <input id="inp-fixo-valor" type="number" inputmode="decimal" step="0.01" min="0" value="${editando ? item.valor : ''}" placeholder="0,00">
    </div>
    <div class="form-error" id="sheet-err"></div>
    <button class="btn btn-primary" id="save-fixo">${editando ? 'Salvar' : 'Adicionar'}</button>
    <button class="btn btn-secondary" id="cancel-fixo">Cancelar</button>
  `, sheet => {
    const nome = sheet.querySelector('#inp-fixo-nome');
    setTimeout(() => nome.focus(), 50);
    sheet.querySelector('#save-fixo').addEventListener('click', () => {
      try {
        const valor = sheet.querySelector('#inp-fixo-valor').value;
        if (editando) DB.atualizarFarmCustoFixo(item.id, { nome: nome.value, valor });
        else DB.adicionarFarmCustoFixo({ nome: nome.value, valor });
        closeSheet();
        toast(editando ? 'Custo fixo salvo ✓' : 'Custo fixo adicionado ✓');
        renderFarmCustosFixos();
      } catch (err) {
        const el = sheet.querySelector('#sheet-err');
        el.textContent = err.message; el.classList.add('show');
      }
    });
    sheet.querySelector('#cancel-fixo').addEventListener('click', closeSheet);
  });
}

/* ============================================================
   EMAILS  (#/emails)
   ============================================================ */
const emailState = { filtro: 'Disponível' };

function emailItemHTML(e) {
  const usado = e.status === 'Usado';
  const ico = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>';
  return `
    <div class="email-item ${usado ? 'usado' : ''}">
      <div class="ei-main">
        <div class="ei-email">${esc(e.email)} <button class="copy-btn" data-emcopy="${e.id}" data-campo="email" aria-label="Copiar email">${ico}</button></div>
        <div class="ei-senha">${esc(e.senha) || '—'} <button class="copy-btn" data-emcopy="${e.id}" data-campo="senha" aria-label="Copiar senha">${ico}</button></div>
      </div>
      <div class="ei-actions">
        <button class="btn-mini ${usado ? '' : 'on'}" data-toggle="${e.id}">${usado ? 'Reativar' : 'Marcar usado'}</button>
        <button class="ei-del" data-del="${e.id}" aria-label="Excluir">✕</button>
      </div>
    </div>`;
}

function renderEmails() {
  const cont = DB.contarEmails();
  const lista = DB.listarEmails(emailState.filtro === 'Todos' ? null : emailState.filtro);
  const filtros = [['Disponível', 'Disponíveis'], ['Usado', 'Usados'], ['Todos', 'Todos']];

  $view.innerHTML = `
    <a class="back-link" href="#/">
      <svg viewBox="0 0 12 12"><path d="M8 1L3 6l5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
      Início
    </a>
    <div class="page-head">
      <div class="page-head-row">
        <div><h1>Emails</h1><div class="subtitle">Reserva de emails comprados</div></div>
        <button class="btn-small" id="btn-add-emails">+ Adicionar</button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat"><div class="label">Disponíveis</div><div class="value">${cont.disponiveis}</div></div>
      <div class="stat"><div class="label">Usados</div><div class="value">${cont.usados}</div></div>
    </div>

    <div class="chips" id="email-chips">
      ${filtros.map(([v, r]) => `<button class="chip ${emailState.filtro === v ? 'active' : ''}" data-filtro="${v}">${r}</button>`).join('')}
    </div>

    <div id="emails-lista">
      ${lista.length
        ? lista.map(emailItemHTML).join('')
        : `<div class="card empty"><p>Nenhum email aqui.<br>Toque em <strong>+ Adicionar</strong> e cole no formato <strong>email:senha</strong>.</p></div>`}
    </div>
  `;

  // Adicionar emails em massa
  document.getElementById('btn-add-emails').addEventListener('click', () => {
    openSheet(`
      <h3>Adicionar emails</h3>
      <div class="form-group">
        <label>Cole os emails (um por linha, formato email:senha)</label>
        <textarea id="inp-emails" style="min-height:160px;" placeholder="email@dominio.com:senha" autocapitalize="none"></textarea>
      </div>
      <div class="form-error" id="em-err"></div>
      <button class="btn btn-primary" id="save-emails">Adicionar</button>
      <button class="btn btn-secondary" id="cancel-emails">Cancelar</button>
    `, sheet => {
      const inp = sheet.querySelector('#inp-emails');
      setTimeout(() => inp.focus(), 50);
      sheet.querySelector('#save-emails').addEventListener('click', () => {
        const r = DB.adicionarEmails(inp.value);
        if (r.adicionados === 0 && r.duplicados === 0 && r.invalidos === 0) {
          const e = sheet.querySelector('#em-err');
          e.textContent = 'Cole ao menos um email no formato email:senha.';
          e.classList.add('show');
          return;
        }
        closeSheet();
        let msg = `${r.adicionados} adicionado(s)`;
        if (r.duplicados) msg += ` · ${r.duplicados} repetido(s)`;
        if (r.invalidos) msg += ` · ${r.invalidos} inválido(s)`;
        toast(msg + ' ✓');
        emailState.filtro = 'Disponível';
        renderEmails();
      });
      sheet.querySelector('#cancel-emails').addEventListener('click', closeSheet);
    });
  });

  // Filtros
  document.getElementById('email-chips').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    emailState.filtro = chip.dataset.filtro;
    renderEmails();
  });

  // Ações da lista
  const $lista = document.getElementById('emails-lista');
  $lista.querySelectorAll('[data-emcopy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const em = DB.listarEmails(null).find(x => x.id === btn.dataset.emcopy);
      if (!em) return;
      const valor = btn.dataset.campo === 'senha' ? em.senha : em.email;
      copiarTexto(valor).then(() => toast('Copiado ✓')).catch(() => toast('Não foi possível copiar'));
    });
  });
  $lista.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => { DB.alternarEmail(btn.dataset.toggle); renderEmails(); });
  });
  $lista.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm('Excluir este email?')) { DB.excluirEmail(btn.dataset.del); renderEmails(); }
    });
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
