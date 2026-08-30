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

  async function push(force = false) {
    const config = read();
    if (!config.sync_id || !config.access_key || pushing) return state();
    pushing = true;
    try {
      const modifiedAt = config.local_updated_at || new Date().toISOString();
      const result = await request({
        action: 'push', sync_id: config.sync_id, access_key: config.access_key,
        source_id: sourceId(), modified_at: modifiedAt, snapshot: snapshot(), force,
      });
      write({ remote_updated_at: result.updated_at, local_updated_at: result.modified_at, error: null });
      window.dispatchEvent(new CustomEvent('gestao-op-sync-status'));
      return state();
    } catch (error) {
      write({ error: error.message || 'Não foi possível sincronizar.' });
      // Um aparelho ficou offline e outro foi alterado antes dele voltar.
      // Preserva a versão mais nova do servidor, sem apagar silenciosamente.
      if (error.status === 409 && error.body?.snapshot && !force) await applyRemote(error.body);
      window.dispatchEvent(new CustomEvent('gestao-op-sync-status'));
      throw error;
    } finally { pushing = false; }
  }

  async function applyRemote(result) {
    const config = read();
    const remoteAt = String(result.modified_at || result.updated_at || '');
    const localAt = String(config.local_updated_at || '');
    if (!result.snapshot || (localAt && remoteAt && localAt > remoteAt)) return false;
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

  function markChanged() {
    if (applyingRemote || !state().configured) return;
    write({ local_updated_at: new Date().toISOString(), error: null });
    clearTimeout(timer);
    timer = setTimeout(() => push().catch(() => {}), 800);
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
    write({ sync_id: parts[0], access_key: parts[1], error: null });
    const result = await request({ action: 'pull', sync_id: parts[0], access_key: parts[1] });
    if (!result.snapshot) throw new Error('Ainda não há dados neste espaço de sincronização.');
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
