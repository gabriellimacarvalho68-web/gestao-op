const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const storage = new Map();
const context = vm.createContext({
  console,
  crypto: globalThis.crypto,
  Intl,
  Date,
  localStorage: {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  },
});

const source = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
vm.runInContext(`${source}\nthis.__DB = DB;`, context);
const DB = context.__DB;

const f1 = DB.criarFarm({ username: 'conta-a', data_inicio: '2026-08-01T00:00:00.000Z' });
const f2 = DB.criarFarm({ username: 'conta-b', data_inicio: '2026-08-01T00:00:00.000Z' });

DB.salvarContaTtpost({
  farm_id: f1.id, nome_perfil: 'perfil-a', provider: 'adspower',
  followers: 100, follower_goal: 1000, posts_success: 3,
  posts_failed: 1, warmup_minutes_total: 60, videos_used: 3,
  posts_today: 1, failures_today: 0, warmups_today: 1,
});
DB.salvarContaTtpost({
  farm_id: f2.id, nome_perfil: 'perfil-b', provider: 'adspower',
  followers: 200, follower_goal: 1000, posts_success: 1,
  posts_failed: 0, warmup_minutes_total: 30, videos_used: 1,
  posts_today: 1, failures_today: 0, warmups_today: 1,
});

DB.salvarCustoTtpost({ nome: 'AdsPower', valor: 300, base: 'mensal_compartilhado', escopo: 'adspower' });
DB.salvarCustoTtpost({ nome: 'Edição', valor: 2, base: 'por_postagem', escopo: 'todos' });
DB.salvarCustoTtpost({ nome: 'Celular', valor: 6, base: 'por_hora_aquecimento', escopo: 'todos' });
DB.salvarCustoTtpost({ nome: 'Setup', valor: 10, base: 'fixo_por_conta', escopo: 'todos' });

const ranking = DB.rankingTtpost();
assert.strictEqual(ranking[0].nome_perfil, 'perfil-b');
assert.strictEqual(DB.resumoTtpost().postsHoje, 2);
assert.strictEqual(DB.listarCustosTtpost().length, 4);

const detalhe = DB.detalharCustoTtpostFarm(f1.id);
assert.ok(Math.abs(detalhe.total - 27) < 0.01, `custo esperado 27; obtido ${detalhe.total}`);
assert.strictEqual(DB.getFarm(f1.id).custo, 0, 'custos antigos do TTpost não devem entrar no Farm');

DB.setMetaSeguidoresTtpost(1000);
assert.strictEqual(DB.getMetaSeguidoresTtpost(), 1000);
assert.strictEqual(DB.metaTtpostJaNotificada('perfil-a'), false);
DB.marcarMetaTtpostNotificada('perfil-a');
assert.strictEqual(DB.metaTtpostJaNotificada('perfil-a'), true);
DB.setMetaSeguidoresTtpost(2000);
assert.strictEqual(DB.metaTtpostJaNotificada('perfil-a'), false, 'trocar a meta deve liberar uma nova notificação');

DB.registrarVendaFarm(f1.id, { preco_venda: 100, data_venda: new Date().toISOString() });
const contaVendida = DB.listarContasTtpost().find(c => c.farm_id === f1.id);
assert.strictEqual(contaVendida.active, false);
assert.strictEqual(DB.resumoTtpost().comandosPendentes, 1);

const backup = JSON.parse(DB.exportar());
assert.strictEqual(backup.versao, 12);
assert.strictEqual(backup.ttpost.custos.length, 4);
DB.importar(JSON.stringify(backup));
assert.strictEqual(DB.totais().ttpostContas, 2);
assert.strictEqual(DB.totais().ttpostCustos, 4);

const antigo = JSON.stringify({ app: 'gestao-op', versao: 7, contas: [], historico: [] });
const restaurado = DB.importar(antigo);
assert.strictEqual(restaurado.contas, 0);
assert.strictEqual(DB.totais().ttpostContas, 0);

console.log('TTpost DB: testes concluídos com sucesso.');
