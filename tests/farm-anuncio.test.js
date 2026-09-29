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

// Novas contas começam pendentes de anúncio, salvo quando a opção é marcada.
const pendente = DB.criarFarm({ username: 'conta-pendente' });
const anunciada = DB.criarFarm({ username: 'conta-anunciada', anunciada: true });
assert.strictEqual(DB.getFarm(pendente.id).anunciada, false);
assert.strictEqual(DB.getFarm(anunciada.id).anunciada, true);

// A ação pode ser alterada sem mexer nos demais dados e fica no histórico.
DB.atualizarFarm(pendente.id, { anunciada: true });
assert.strictEqual(DB.getFarm(pendente.id).anunciada, true);
assert.ok(
  DB.historicoDoFarm(pendente.id).some(h => h.evento === 'Anúncio atualizado' && h.descricao === 'Conta marcada como anunciada.'),
  'a alteração do anúncio deve entrar no histórico'
);

// O campo sobrevive ao backup e a backups anteriores sem o novo campo.
const backup = JSON.parse(DB.exportar());
DB.importar(JSON.stringify(backup));
assert.strictEqual(DB.getFarm(anunciada.id).anunciada, true);

const antigo = JSON.parse(DB.exportar());
delete antigo.farm[0].anunciada;
DB.importar(JSON.stringify(antigo));
assert.strictEqual(DB.getFarm(antigo.farm[0].id).anunciada, false);
