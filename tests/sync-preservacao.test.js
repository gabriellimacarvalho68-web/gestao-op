const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'sync.js'), 'utf8');

function ambiente(dados, respostas) {
  const storage = new Map([['gestao-op-sync-v1', JSON.stringify({
    sync_id: '11111111-1111-1111-1111-111111111111', access_key: 'a'.repeat(64),
    local_updated_at: '2026-09-29T18:00:00.000Z',
    remote_updated_at: '2026-09-29T18:00:01.000Z',
  })]]);
  const eventos = new Map();
  const envios = [];
  const timers = [];
  let dadosLocais = structuredClone(dados);
  const janela = {
    addEventListener: (nome, fn) => eventos.set(nome, fn),
    dispatchEvent: evento => eventos.get(evento.type)?.(evento),
  };
  class CustomEvent {
    constructor(type, opcoes = {}) { this.type = type; this.detail = opcoes.detail; }
  }
  const contexto = vm.createContext({
    console, crypto: globalThis.crypto, Date, CustomEvent, window: janela,
    document: { hidden: true },
    localStorage: {
      getItem: chave => storage.get(chave) ?? null,
      setItem: (chave, valor) => storage.set(chave, String(valor)),
      removeItem: chave => storage.delete(chave),
    },
    DB: {
      exportar: () => JSON.stringify(dadosLocais),
      importar: texto => { dadosLocais = JSON.parse(texto); janela.dispatchEvent(new CustomEvent('gestao-op-dados-alterados')); },
    },
    fetch: async (_url, opcoes) => {
      const enviado = JSON.parse(opcoes.body);
      envios.push(enviado);
      const resposta = await respostas.shift()(enviado);
      return { ok: resposta.status < 400, status: resposta.status, json: async () => resposta.body };
    },
    setTimeout: fn => { timers.push(fn); return timers.length; },
    clearTimeout: () => {},
    setInterval: () => {},
  });
  vm.runInContext(`${source}\nthis.sync = GESTAO_OP_SYNC;`, contexto);
  return {
    sync: contexto.sync,
    dados: () => dadosLocais,
    definirDados: valor => { dadosLocais = structuredClone(valor); },
    config: () => JSON.parse(storage.get('gestao-op-sync-v1')),
    evento: detalhe => janela.dispatchEvent(new CustomEvent('gestao-op-dados-alterados', { detail: detalhe })),
    envios,
    timers,
  };
}

function snapshot(contas) {
  return { app: 'gestao-op', contas, historico: [], farm: [], farm_historico: [] };
}

test('reaplica anúncio após conflito sem apagar contas que chegaram de outro aparelho', async () => {
  const remoto = snapshot([
    { id: 'a', username: 'josefa', anunciada: false },
    { id: 'b', username: 'outra', anunciada: false },
  ]);
  const local = snapshot([{ id: 'a', username: 'josefa', anunciada: true }]);
  const env = ambiente(local, [
    () => ({ status: 409, body: { error: 'Conflito', snapshot: remoto, modified_at: '2026-09-29T19:00:00.000Z' } }),
    () => ({ status: 200, body: { modified_at: '2026-09-29T19:00:01.000Z', updated_at: '2026-09-29T19:00:02.000Z' } }),
  ]);
  env.evento({ tipo: 'anuncio', colecao: 'contas', id: 'a', anunciada: true });
  await env.sync.push();
  assert.equal(env.envios.length, 2);
  assert.equal(env.envios[1].snapshot.contas.find(c => c.id === 'a').anunciada, true);
  assert.ok(env.envios[1].snapshot.contas.some(c => c.id === 'b'));
  assert.equal(env.dados().contas.find(c => c.id === 'a').anunciada, true);
  assert.equal(env.config().pending, false);
});

test('preserva cadastro novo marcado como anunciado quando o servidor mudou', async () => {
  const local = snapshot([{ id: 'novo', username: 'josefa', anunciada: true }]);
  local.historico.push({ id: 'h1', conta_id: 'novo', evento: 'Conta criada' });
  const remoto = snapshot([{ id: 'existente', username: 'outra', anunciada: false }]);
  const env = ambiente(local, [
    () => ({ status: 409, body: { error: 'Conflito', snapshot: remoto, modified_at: '2026-09-29T19:00:00.000Z' } }),
    () => ({ status: 200, body: { modified_at: '2026-09-29T19:00:01.000Z', updated_at: '2026-09-29T19:00:02.000Z' } }),
  ]);
  env.evento({ tipo: 'nova_conta', colecao: 'contas', id: 'novo' });
  await env.sync.push();
  assert.equal(env.envios[1].snapshot.contas.length, 2);
  assert.equal(env.envios[1].snapshot.contas.find(c => c.id === 'novo').anunciada, true);
  assert.ok(env.envios[1].snapshot.historico.some(h => h.id === 'h1'));
  assert.equal(env.config().pending, false);
});

test('não substitui uma alteração local feita enquanto o pull aguardava resposta', async () => {
  let responder;
  const env = ambiente(snapshot([{ id: 'a', username: 'josefa', anunciada: false }]), [
    () => new Promise(resolve => { responder = resolve; }),
  ]);
  const consulta = env.sync.pull();
  await Promise.resolve();
  const alterado = env.dados();
  alterado.contas[0].anunciada = true;
  env.definirDados(alterado);
  env.evento({ tipo: 'anuncio', colecao: 'contas', id: 'a', anunciada: true });
  responder({ status: 200, body: {
    snapshot: snapshot([{ id: 'a', username: 'josefa', anunciada: false }]),
    modified_at: '2026-09-29T19:00:00.000Z', updated_at: '2026-09-29T19:00:01.000Z',
  } });
  await consulta;
  assert.equal(env.dados().contas[0].anunciada, true);
  assert.equal(env.config().pending, true);
});
