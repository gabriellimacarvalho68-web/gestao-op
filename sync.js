/* ============================================================
   Gestão OP — sincronização privada entre aparelhos
   Os dados seguem locais/offline. Quando configurada, esta camada envia um
   backup completo por HTTPS ao cofre privado do próprio usuário.
   ============================================================ */
const GESTAO_OP_SYNC = (() => {
  const KEY = 'gestao-op-sync-v1';
  const URL = 'https://oakylrntjdqnrybxbpvo.supabase.co/functions/v1/gestao-op-sync';
  const SOURCE_ID_KEY = 'gestao-op-sync-source-id-v1';
  let applyingRemote = false;
  let pushing = false;
  let timer = null;

  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch (_err) { return {}; }
  }

  function write(patch) {
    const next = { ...read(), ...patch };
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  }

  function sourceId() {
    let id = localStorage.getItem(SOURCE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
      localStorage.setItem(SOURCE_ID_KEY, id);
    }
    return id;
  }

  function pairingCode(config = read()) {
    return config.sync_id && config.access_key ? `${config.sync_id}.${config.access_key}` : '';
  }

  function state() {
    const config = read();
    return {
      configured: Boolean(config.sync_id && config.access_key),
      pairingCode: pairingCode(config),
      syncedAt: config.remote_updated_at || null,
      error: config.error || null,
      syncing: pushing,
    };
  }

  function newAccessKey() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  async function request(body) {
    const response = await fetch(URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    let result = {};
    try { result = await response.json(); } catch (_err) { /* resposta inválida */ }
    if (!response.ok) {
      const error = new Error(result.error || `Sincronização respondeu HTTP ${response.status}.`);
      error.status = response.status;
      error.body = result;
      throw error;
    }
    return result;
  }

  function snapshot() { return JSON.parse(DB.exportar()); }

  function protegerContraPerdaLocal(remoto, { criacoes = [], anuncios = [] } = {}) {
    const local = snapshot();
    const pendentes = itens => new Set(itens.map(item => `${item.colecao}:${item.id}`));
    const criacoesPendentes = pendentes(criacoes);
    const anunciosPendentes = pendentes(anuncios);
    for (const colecao of ['contas', 'farm']) {
      const locais = Array.isArray(local[colecao]) ? local[colecao] : [];
      const recebidos = new Map((Array.isArray(remoto[colecao]) ? remoto[colecao] : [])
        .map(conta => [conta.id, conta]));
      for (const conta of locais) {
        const recebida = recebidos.get(conta.id);
        const chave = `${colecao}:${conta.id}`;
        if (!recebida) {
          if (criacoesPendentes.has(chave)) continue;
          throw new Error(`Sincronização protegida: o servidor não contém a conta @${conta.username}. Os dados deste aparelho foram mantidos.`);
        }
        const localEm = Date.parse(conta.atualizado_em || conta.criado_em || '') || 0;
        const remotoEm = Date.parse(recebida.atualizado_em || recebida.criado_em || '') || 0;
        if (localEm > remotoEm && JSON.stringify(conta) !== JSON.stringify(recebida)) {
          if (anunciosPendentes.has(chave)) {
            const semAnuncio = item => {
              const copia = { ...item };
              delete copia.anunciada;
              delete copia.atualizado_em;
              return JSON.stringify(copia);
            };
            if (semAnuncio(conta) === semAnuncio(recebida)) continue;
          }
          throw new Error(`Sincronização protegida: o servidor tem uma versão antiga da conta @${conta.username}. Os dados deste aparelho foram mantidos.`);
        }
      }
    }
  }

  function temAlteracaoPendente(config = read()) {
    return config.pending === true || (config.pending == null && Boolean(
      config.local_updated_at && config.remote_updated_at &&
      config.local_updated_at > config.remote_updated_at
    ));
  }

  function agendarEnvio(atraso = 800) {
    clearTimeout(timer);
    timer = setTimeout(() => push().catch(() => {}), atraso);
  }

  function reaplicarAlteracoes(remoto, local, criacoes, anuncios, data) {
    const dados = JSON.parse(JSON.stringify(remoto));
    for (const item of criacoes) {
      const lista = dados[item.colecao];
      const localLista = local[item.colecao];
      const conta = Array.isArray(localLista) ? localLista.find(c => c.id === item.id) : null;
      if (!Array.isArray(lista) || !conta) return null;
      if (!lista.some(c => c.id === item.id)) {
        const nome = String(conta.username || '').replace(/^@/, '').toLowerCase();
        if (lista.some(c => String(c.username || '').replace(/^@/, '').toLowerCase() === nome)) return null;
        lista.push(conta);
      }
      const chave = item.colecao === 'farm' ? 'farm_id' : 'conta_id';
      const historico = item.colecao === 'farm' ? dados.farm_historico : dados.historico;
      const historicoLocal = item.colecao === 'farm' ? local.farm_historico : local.historico;
      if (!Array.isArray(historico) || !Array.isArray(historicoLocal)) return null;
      const existentes = new Set(historico.map(h => h.id));
      historicoLocal.filter(h => h[chave] === item.id && !existentes.has(h.id))
        .forEach(h => historico.push(h));
    }
    for (const item of anuncios) {
      const lista = dados[item.colecao];
      const conta = Array.isArray(lista) ? lista.find(c => c.id === item.id) : null;
      if (!conta) return null;
      conta.anunciada = item.anunciada;
      conta.atualizado_em = data;
      const historico = item.colecao === 'farm' ? dados.farm_historico : dados.historico;
      if (!Array.isArray(historico)) return null;
      historico.push({
        id: crypto.randomUUID(),
        [item.colecao === 'farm' ? 'farm_id' : 'conta_id']: item.id,
        evento: 'Anúncio atualizado',
        descricao: item.anunciada ? 'Conta marcada como anunciada.' : 'Conta marcada como não anunciada.',
        criado_em: data,
      });
    }
    return dados;
  }

  async function push(force = false) {
    const config = read();
    if (!config.sync_id || !config.access_key || pushing ||
        (!force && !temAlteracaoPendente(config) && config.remote_updated_at)) return state();
    pushing = true;
    try {
      let envio = snapshot();
      let dataEnvio = config.local_updated_at || new Date().toISOString();
      const revisao = Number(config.local_revision || 0);
      let rebase = false;
      for (let tentativa = 0; tentativa < 3; tentativa++) {
        try {
          const result = await request({
            action: 'push', sync_id: config.sync_id, access_key: config.access_key,
            source_id: sourceId(), modified_at: dataEnvio, snapshot: envio, force,
          });
          const atual = read();
          if (Number(atual.local_revision || 0) === revisao) {
            if (rebase) {
              applyingRemote = true;
              try { DB.importar(JSON.stringify(envio)); } finally { applyingRemote = false; }
            }
            write({
              remote_updated_at: result.updated_at, local_updated_at: result.modified_at,
              pending: false, pending_other: false, pending_anuncios: [], pending_criacoes: [], error: null,
            });
          } else {
            write({ remote_updated_at: result.updated_at, error: null });
            agendarEnvio(0);
          }
          window.dispatchEvent(new CustomEvent('gestao-op-sync-status'));
          return state();
        } catch (error) {
          const atual = read();
          const anuncios = Array.isArray(atual.pending_anuncios) ? atual.pending_anuncios : [];
          const criacoes = Array.isArray(atual.pending_criacoes) ? atual.pending_criacoes : [];
          if (error.status !== 409 || !error.body?.snapshot || atual.pending_other ||
              (!anuncios.length && !criacoes.length) ||
              Number(atual.local_revision || 0) !== revisao) throw error;
          const remotoEm = Date.parse(error.body.modified_at || '') || 0;
          dataEnvio = new Date(Math.max(Date.now(), remotoEm + 1)).toISOString();
          protegerContraPerdaLocal(error.body.snapshot, { criacoes, anuncios });
          envio = reaplicarAlteracoes(error.body.snapshot, envio, criacoes, anuncios, dataEnvio);
          if (!envio) throw error;
          rebase = true;
        }
      }
      throw new Error('A sincronização está recebendo mudanças simultâneas. Tente novamente em instantes.');
    } catch (error) {
      write({ error: error.message || 'Não foi possível sincronizar.' });
      window.dispatchEvent(new CustomEvent('gestao-op-sync-status'));
      throw error;
    } finally { pushing = false; }
  }

  async function applyRemote(result) {
    const config = read();
    const remoteAt = String(result.modified_at || result.updated_at || '');
    const localAt = String(config.local_updated_at || '');
    if (!result.snapshot || temAlteracaoPendente(config) ||
        (localAt && remoteAt && localAt > remoteAt)) return false;
    protegerContraPerdaLocal(result.snapshot);
    applyingRemote = true;
    try {
      DB.importar(JSON.stringify(result.snapshot));
      write({ remote_updated_at: result.updated_at || remoteAt, local_updated_at: remoteAt, error: null });
      return true;
    } finally { applyingRemote = false; }
  }

  async function pull() {
    const config = read();
    if (!config.sync_id || !config.access_key || pushing) return state();
    try {
      if (temAlteracaoPendente(config)) await push();
      if (temAlteracaoPendente()) return state();
      const result = await request({ action: 'pull', sync_id: config.sync_id, access_key: config.access_key });
      await applyRemote(result);
      write({ error: null });
      window.dispatchEvent(new CustomEvent('gestao-op-sync-status'));
      return state();
    } catch (error) {
      write({ error: error.message || 'Não foi possível consultar a sincronização.' });
      window.dispatchEvent(new CustomEvent('gestao-op-sync-status'));
      throw error;
    }
  }

  async function importarExcelPublico(url) {
    const config = read();
    if (!config.sync_id || !config.access_key) {
      throw new Error('Ative primeiro a sincronização entre celular e PC para criar seu espaço privado.');
    }
    const link = String(url || '').trim();
    if (!/^https:\/\/(?:1drv\.ms|(?:[a-z0-9-]+\.)*(?:sharepoint\.com|onedrive\.live\.com))\//i.test(link)) {
      throw new Error('Cole um link público válido do OneDrive.');
    }
    const result = await request({
      action: 'import_public_excel', sync_id: config.sync_id, access_key: config.access_key,
      public_url: link,
    });
    if (!result.snapshot) throw new Error('A planilha não devolveu dados para importar.');
    protegerContraPerdaLocal(result.snapshot);
    applyingRemote = true;
    try {
      DB.importar(JSON.stringify(result.snapshot));
      write({ remote_updated_at: result.updated_at, local_updated_at: result.modified_at, error: null });
    } finally {
      applyingRemote = false;
    }
    window.dispatchEvent(new CustomEvent('gestao-op-sync-status'));
    return result;
  }

  function markChanged(event) {
    if (applyingRemote || !state().configured) return;
    const atual = read();
    const detalhe = event.detail;
    const anuncios = Array.isArray(atual.pending_anuncios) ? atual.pending_anuncios.slice() : [];
    const criacoes = Array.isArray(atual.pending_criacoes) ? atual.pending_criacoes.slice() : [];
    if (detalhe?.tipo === 'anuncio') {
      const indice = anuncios.findIndex(item => item.colecao === detalhe.colecao && item.id === detalhe.id);
      if (indice >= 0) anuncios.splice(indice, 1);
      anuncios.push(detalhe);
    }
    if (detalhe?.tipo === 'nova_conta' &&
        !criacoes.some(item => item.colecao === detalhe.colecao && item.id === detalhe.id)) {
      criacoes.push(detalhe);
    }
    write({
      local_updated_at: new Date().toISOString(),
      local_revision: Number(atual.local_revision || 0) + 1,
      pending: true,
      pending_other: Boolean(atual.pending_other || !detalhe ||
        (detalhe.tipo !== 'anuncio' && detalhe.tipo !== 'nova_conta')),
      pending_anuncios: anuncios,
      pending_criacoes: criacoes,
      error: null,
    });
    agendarEnvio();
  }

  async function create() {
    const accessKey = newAccessKey();
    const result = await request({ action: 'create', access_key: accessKey, source_id: sourceId() });
    write({ sync_id: result.sync_id, access_key: accessKey, local_updated_at: new Date().toISOString(), remote_updated_at: null, error: null });
    await push(true);
    return state();
  }

  async function connect(code) {
    const parts = String(code || '').trim().split('.');
    if (parts.length !== 2 || !/^[a-f0-9-]{36}$/i.test(parts[0]) || !/^[a-f0-9]{64}$/i.test(parts[1])) {
      throw new Error('Código de pareamento inválido. Cole o código completo.');
    }
    write({ sync_id: parts[0], access_key: parts[1], pending: false, pending_other: false,
      pending_anuncios: [], pending_criacoes: [], error: null });
    const result = await request({ action: 'pull', sync_id: parts[0], access_key: parts[1] });
    if (!result.snapshot) throw new Error('Ainda não há dados neste espaço de sincronização.');
    protegerContraPerdaLocal(result.snapshot);
    applyingRemote = true;
    try {
      DB.importar(JSON.stringify(result.snapshot));
      write({ remote_updated_at: result.updated_at, local_updated_at: result.modified_at, error: null });
    } finally { applyingRemote = false; }
    return state();
  }

  function disconnect() { localStorage.removeItem(KEY); window.dispatchEvent(new CustomEvent('gestao-op-sync-status')); }

  window.addEventListener('gestao-op-dados-alterados', markChanged);
  window.addEventListener('online', () => pull().catch(() => {}));
  window.addEventListener('load', () => {
    if (state().configured) pull().catch(() => {});
  });
  setInterval(() => { if (!document.hidden) pull().catch(() => {}); }, 30000);

  return { state, create, connect, push, pull, importarExcelPublico, disconnect };
})();
