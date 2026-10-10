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

const campos = { fornecedor: 'Fornecedor', preco_compra: 100 };
const pendente = DB.criarConta({ username: 'compra-pendente', ...campos });
const anunciada = DB.criarConta({ username: 'compra-anunciada', anunciada: true, ...campos });
assert.strictEqual(DB.getConta(pendente.id).anunciada, false);
assert.strictEqual(DB.getConta(anunciada.id).anunciada, true);

DB.atualizarConta(pendente.id, { anunciada: true });
assert.strictEqual(DB.getConta(pendente.id).anunciada, true);
assert.ok(
  DB.historicoDaConta(pendente.id).some(h => h.evento === 'Anúncio atualizado' && h.descricao === 'Conta marcada como anunciada.'),
  'a alteração do anúncio deve entrar no histórico'
);

const backup = JSON.parse(DB.exportar());
DB.importar(JSON.stringify(backup));
assert.strictEqual(DB.getConta(anunciada.id).anunciada, true);

const antigo = JSON.parse(DB.exportar());
delete antigo.contas[0].anunciada;
DB.importar(JSON.stringify(antigo));
assert.strictEqual(DB.getConta(antigo.contas[0].id).anunciada, false);

const idExcluida = DB.getConta(anunciada.id).id;
DB.excluirConta(idExcluida);
const aposExcluir = JSON.parse(DB.exportar());
assert.ok(
  aposExcluir.sync_exclusoes.some(item => item.colecao === 'contas' && item.id === idExcluida),
  'a exclusão precisa acompanhar o backup para chegar ao outro aparelho'
);
