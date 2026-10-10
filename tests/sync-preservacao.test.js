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
    { id: 'a', username: 'josefa', anunciada: false, atualizado_em: '2026-09-29T18:00:00.000Z' },
    { id: 'b', username: 'outra', anunciada: false },
  ]);
  const local = snapshot([{ id: 'a', username: 'josefa', anunciada: true,
    atualizado_em: '2026-09-29T18:30:00.000Z' }]);
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

test('mescla cadastros locais quando o servidor devolve cópia sem eles', async () => {
  const local = snapshot([
    { id: 'a', username: 'primeira', criado_em: '2026-09-30T12:00:00.000Z' },
    { id: 'b', username: 'segunda', criado_em: '2026-09-30T12:01:00.000Z' },
    { id: 'c', username: 'terceira', criado_em: '2026-09-30T12:02:00.000Z' },
    { id: 'd', username: 'quarta', criado_em: '2026-09-30T12:03:00.000Z' },
  ]);
  const remoto = snapshot([local.contas[0]]);
  const env = ambiente(local, [() => ({ status: 200, body: {
    snapshot: remoto, modified_at: '2026-09-30T12:30:00.000Z', updated_at: '2026-09-30T12:30:01.000Z',
  } })]);
  await env.sync.pull();
  assert.equal(env.dados().contas.length, 4);
  assert.equal(env.config().pending, true);
  assert.equal(env.config().error, null);
});

test('mescla anúncio local quando o servidor tem versão antiga da conta', async () => {
  const local = snapshot([{ id: 'a', username: 'conta', anunciada: true,
    atualizado_em: '2026-09-30T12:20:00.000Z' }]);
  const remoto = snapshot([{ id: 'a', username: 'conta', anunciada: false,
    atualizado_em: '2026-09-30T12:10:00.000Z' }]);
  const env = ambiente(local, [() => ({ status: 200, body: {
    snapshot: remoto, modified_at: '2026-09-30T12:30:00.000Z', updated_at: '2026-09-30T12:30:01.000Z',
  } })]);
  await env.sync.pull();
  assert.equal(env.dados().contas[0].anunciada, true);
  assert.equal(env.config().pending, true);
});

test('recebe novas contas do servidor sem alterar as existentes', async () => {
  const existente = { id: 'a', username: 'primeira', criado_em: '2026-09-30T12:00:00.000Z' };
  const nova = { id: 'b', username: 'segunda', criado_em: '2026-09-30T12:30:00.000Z' };
  const env = ambiente(snapshot([existente]), [() => ({ status: 200, body: {
    snapshot: snapshot([existente, nova]), modified_at: '2026-09-30T12:30:00.000Z',
    updated_at: '2026-09-30T12:30:01.000Z',
  } })]);
  await env.sync.pull();
  assert.equal(env.dados().contas.length, 2);
  assert.equal(env.config().error, null);
});

test('conflito de envio mescla conta local já confirmada anteriormente', async () => {
  const local = snapshot([
    { id: 'antiga', username: 'salva', criado_em: '2026-09-29T12:00:00.000Z' },
    { id: 'nova', username: 'recente', criado_em: '2026-09-30T12:00:00.000Z' },
  ]);
  const remoto = snapshot([]);
  const env = ambiente(local, [
    () => ({ status: 409, body: { snapshot: remoto, modified_at: '2026-09-30T12:30:00.000Z' } }),
    () => ({ status: 200, body: { modified_at: '2026-09-30T12:30:01.000Z', updated_at: '2026-09-30T12:30:02.000Z' } }),
  ]);
  env.evento({ tipo: 'nova_conta', colecao: 'contas', id: 'nova' });
  await env.sync.push();
  assert.equal(env.envios.length, 2);
  assert.equal(env.dados().contas.length, 2);
  assert.equal(env.config().pending, false);
});

test('exclusão local impede que perfil antigo do servidor volte', async () => {
  const remoto = snapshot([{ id: 'a', username: 'apagada', criado_em: '2026-10-10T10:00:00.000Z' }]);
  const local = snapshot([]);
  local.sync_exclusoes = [{ colecao: 'contas', id: 'a', excluido_em: '2026-10-10T11:00:00.000Z' }];
  const env = ambiente(local, [() => ({ status: 200, body: {
    snapshot: remoto, modified_at: '2026-10-10T11:05:00.000Z', updated_at: '2026-10-10T11:05:01.000Z',
  } })]);
  await env.sync.pull();
  assert.equal(env.dados().contas.length, 0);
  assert.equal(env.dados().sync_exclusoes.length, 1);
  assert.equal(env.config().pending, true);
});

test('exclusão recebida do celular remove perfil antigo do PC', async () => {
  const local = snapshot([{ id: 'a', username: 'apagada', criado_em: '2026-10-10T10:00:00.000Z' }]);
  const remoto = snapshot([]);
  remoto.sync_exclusoes = [{ colecao: 'contas', id: 'a', excluido_em: '2026-10-10T11:00:00.000Z' }];
  const env = ambiente(local, [() => ({ status: 200, body: {
    snapshot: remoto, modified_at: '2026-10-10T11:05:00.000Z', updated_at: '2026-10-10T11:05:01.000Z',
  } })]);
  await env.sync.pull();
  assert.equal(env.dados().contas.length, 0);
  assert.equal(env.config().pending, false);
});
