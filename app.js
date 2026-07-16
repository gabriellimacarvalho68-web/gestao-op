/* ============================================================
   Gestão Operações — SPA com roteamento por hash
   Rotas: #/  #/contas  #/nova  #/conta/:id  #/venda/:id
   ============================================================ */

const $view = document.getElementById('view');
const $toast = document.getElementById('toast');
const $backdrop = document.getElementById('sheet-backdrop');

// Estado da lista (persiste enquanto navega)
const listaState = { busca: '', status: 'Todas', ordenar: 'recente' };

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
  else renderDashboard();

  // Tab ativa
  const tab = parts[0] === 'contas' ? 'contas' : (parts[0] === 'nova' ? 'nova' : 'dashboard');
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

function searchHTML(id, placeholder) {
  return `
    <div class="search">
      <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/></svg>
      <input id="${id}" type="search" placeholder="${placeholder}" autocomplete="off">
    </div>`;
}

/* ============================================================
   DASHBOARD  (#/)
   ============================================================ */
function renderDashboard() {
  const ind = DB.indicadores();
  const ultimas = DB.listarContas().slice(0, 4);

  $view.innerHTML = `
    <div class="page-head">
      <div class="page-head-row">
        <div>
          <h1>Gestão Operações</h1>
          <div class="subtitle">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        </div>
        <a class="btn-icon" href="#/backup" aria-label="Backup dos dados">
          <svg viewBox="0 0 24 24"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>
        </a>
      </div>
    </div>

    ${searchHTML('dash-search', 'Pesquisar username ou fornecedor')}

    <div class="stats-grid">
      <div class="stat wide">
        <div class="label">Lucro realizado</div>
        <div class="value ${ind.lucro >= 0 ? 'pos' : 'neg'}">${fmtBRL(ind.lucro)}</div>
        <div class="sub">Margem média de ${ind.margem.toFixed(1).replace('.', ',')}%</div>
      </div>
      <div class="stat">
        <div class="label">Total investido</div>
        <div class="value">${fmtBRL(ind.investido)}</div>
      </div>
      <div class="stat">
        <div class="label">Ticket médio</div>
        <div class="value">${fmtBRL(ind.ticket)}</div>
      </div>
      <div class="stat">
        <div class="label">Contas cadastradas</div>
        <div class="value">${ind.total}</div>
        <div class="sub">${ind.estoque} em estoque</div>
      </div>
      <div class="stat">
        <div class="label">Vendidas no mês</div>
        <div class="value">${ind.vendidasMes}</div>
      </div>
    </div>

    <h2>Lucro mensal</h2>
    <div class="card chart-card">
      <div class="chart-sub">Últimos 6 meses · toque em uma barra para ver o valor</div>
      <div class="chart-wrap" id="chart-wrap"></div>
    </div>

    <div class="section-row">
      <h2>Últimas contas</h2>
      <a href="#/contas">Ver todas</a>
    </div>
    <div class="conta-list">
      ${ultimas.length
        ? ultimas.map(contaItemHTML).join('')
        : `<div class="card empty"><div class="icon">📱</div><p>Nenhuma conta cadastrada ainda.<br>Toque em <strong>+</strong> para começar.</p></div>`}
    </div>
  `;

  renderChart(document.getElementById('chart-wrap'), DB.lucroMensal(6));

  // Pesquisa no dashboard leva para a lista já filtrada
  const input = document.getElementById('dash-search');
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && input.value.trim()) {
      listaState.busca = input.value.trim();
      location.hash = '#/contas';
    }
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
    <div class="page-head">
      <h1>Contas</h1>
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
      : `<div class="card empty"><div class="icon">🔍</div><p>Nenhuma conta encontrada.</p></div>`;
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
    $view.innerHTML = `<div class="card empty"><div class="icon">❓</div><p>Conta não encontrada.</p></div>`;
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
      <div class="detail-row"><span class="k">Eventos de histórico</span><span class="v">${t.eventos}</span></div>
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
