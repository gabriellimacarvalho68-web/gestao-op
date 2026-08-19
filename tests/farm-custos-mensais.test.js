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

// Mês totalmente no passado (o teste roda em 2026-08-17): evita que o
// "hoje" real limite os intervalos de Crescendo durante os cálculos.
const ANO = 2026, MES = 6; // julho/2026

function iso(dia) {
  return new Date(ANO, MES, dia).toISOString();
}

// Troca o evento 'Estágio alterado para X' mais recente de uma conta pela
// data informada, via round-trip de backup — é a única forma de simular uma
// mudança de estágio no passado, já que alterarStatusFarm sempre grava com
// o horário atual.
function forcarDataDoUltimoEvento(farmId, evento, dataIso) {
  const backup = JSON.parse(DB.exportar());
  const eventos = backup.farm_historico.filter(h => h.farm_id === farmId && h.evento === evento);
  const alvo = eventos[eventos.length - 1];
  assert.ok(alvo, `evento '${evento}' não encontrado para ${farmId}`);
  alvo.criado_em = dataIso;
  DB.importar(JSON.stringify(backup));
}

// ---- 1. Dias em Crescendo proporcionais a data_inicio diferentes ----

const contaA = DB.criarFarm({ username: 'conta-a', data_inicio: iso(1) });
const contaB = DB.criarFarm({ username: 'conta-b', data_inicio: iso(16) });

const diasA = DB.diasCrescendoNoMes(contaA.id, ANO, MES);
const diasB = DB.diasCrescendoNoMes(contaB.id, ANO, MES);
assert.ok(Math.abs(diasA - 31) < 0.01, `conta-a deveria ter 31 dias; obteve ${diasA}`);
assert.ok(Math.abs(diasB - 16) < 0.01, `conta-b deveria ter 16 dias; obteve ${diasB}`);

// ---- 2. Mudança de estágio no meio do mês interrompe a contagem ----

const contaC = DB.criarFarm({ username: 'conta-c', data_inicio: iso(1) });
DB.alterarStatusFarm(contaC.id, 'Monetizada');
forcarDataDoUltimoEvento(contaC.id, 'Estágio alterado para Monetizada', iso(15));

const diasC = DB.diasCrescendoNoMes(contaC.id, ANO, MES);
assert.ok(Math.abs(diasC - 14) < 0.01, `conta-c deveria ter 14 dias (parou dia 15); obteve ${diasC}`);
assert.strictEqual(DB.diasCrescendoNoMes(contaC.id, ANO, MES + 1), 0, 'conta-c não deve contar dias em agosto');

// ---- 3. Lançar custos, fechar o mês, conferir splits e custo/lucro ----

DB.adicionarFarmCustoMes(ANO, MES, { nome: 'Proxy', valor: 100 });
DB.adicionarFarmCustoMes(ANO, MES, { nome: 'Outro recurso', valor: 50 });

const previewAntes = DB.previewFechamentoFarmCustosMes(ANO, MES);
assert.strictEqual(previewAntes.total, 150);

const custoAAntes = DB.getFarm(contaA.id).custo;
const custoBAntes = DB.getFarm(contaB.id).custo;

const mesFechado = DB.fecharFarmCustosMes(ANO, MES);
const somaSplits = mesFechado.splits.reduce((s, x) => s + x.valor, 0);
assert.ok(Math.abs(somaSplits - 150) < 0.01, `soma dos splits deveria ser ~150; obteve ${somaSplits}`);

const splitA = mesFechado.splits.find(s => s.farm_id === contaA.id).valor;
assert.ok(
  Math.abs(DB.getFarm(contaA.id).custo - (custoAAntes + splitA)) < 0.01,
  'custo da conta-a deveria refletir o split aplicado'
);
assert.notStrictEqual(DB.getFarm(contaB.id).custo, custoBAntes, 'custo da conta-b deveria mudar após o fechamento');

// Mês anterior (junho), totalmente fechado no passado e sem nenhuma outra
// conta em Crescendo — conta-d fica com 100% do rateio.
const contaD = DB.criarFarm({ username: 'conta-d', data_inicio: new Date(ANO, MES - 1, 1).toISOString() });
DB.adicionarFarmCustoMes(ANO, MES - 1, { nome: 'Setup', valor: 90 });
DB.fecharFarmCustosMes(ANO, MES - 1);
DB.registrarVendaFarm(contaD.id, { preco_venda: 500, data_venda: new Date(ANO, MES - 1, 28).toISOString() });
assert.ok(Math.abs(DB.getFarm(contaD.id).custo - 90) < 0.01, `custo da conta-d deveria ser 90; obteve ${DB.getFarm(contaD.id).custo}`);
assert.ok(Math.abs(DB.getFarm(contaD.id).lucro - 410) < 0.01, `lucro da conta-d deveria ser 410; obteve ${DB.getFarm(contaD.id).lucro}`);

// ---- 4. Fechar o mesmo mês duas vezes deve lançar erro ----

assert.throws(() => DB.fecharFarmCustosMes(ANO, MES), /já foi fechado/);

// ---- 5. Fechar um mês sem nenhuma conta em Crescendo dá erro claro e preserva o lançamento ----

DB.adicionarFarmCustoMes(2020, 0, { nome: 'Sem contas', valor: 10 });
assert.throws(() => DB.fecharFarmCustosMes(2020, 0), /Nenhuma conta esteve em Crescendo/);
const mesVazio = DB.getFarmCustosMes(2020, 0);
assert.strictEqual(mesVazio.fechado, false);
assert.strictEqual(mesVazio.itens.length, 1, 'o lançamento não deve se perder quando o fechamento falha');

// ---- 6. Conta criada/excluída depois do fechamento não altera splits congelados ----

// DB roda dentro de um vm.createContext (outro realm): comparar os arrays
// retornados por ele direto contra objetos deste realm falha no
// deepStrictEqual mesmo com conteúdo idêntico, então a comparação é feita
// via texto JSON.
const splitsCongelados = JSON.parse(JSON.stringify(DB.getFarmCustosMes(ANO, MES).splits));
DB.criarFarm({ username: 'conta-e', data_inicio: iso(1) });
const mesAposNovaConta = DB.getFarmCustosMes(ANO, MES);
assert.strictEqual(JSON.stringify(mesAposNovaConta.splits), JSON.stringify(splitsCongelados), 'splits de um mês fechado não podem mudar com novas contas');
DB.excluirFarm(contaA.id);
const mesAposExclusao = DB.getFarmCustosMes(ANO, MES);
assert.strictEqual(JSON.stringify(mesAposExclusao.splits), JSON.stringify(splitsCongelados), 'splits de um mês fechado não podem mudar após excluir uma conta');

// ---- 7. exportar()/importar() preserva farm_custos_mensais e não duplica custo_recursos_legado ----

const backup1 = JSON.parse(DB.exportar());
assert.strictEqual(backup1.versao, 11);
const legadoB1 = backup1.farm.find(f => f.id === contaB.id).custo_recursos_legado;

DB.importar(JSON.stringify(backup1));
const backup2 = JSON.parse(DB.exportar());
const legadoB2 = backup2.farm.find(f => f.id === contaB.id).custo_recursos_legado;
assert.strictEqual(legadoB2, legadoB1, 'custo_recursos_legado não deve mudar em reimportações sucessivas');
assert.strictEqual(backup2.farm_custos_mensais.length, backup1.farm_custos_mensais.length);
const mesReimportado = backup2.farm_custos_mensais.find(m => m.ano === ANO && m.mes === MES);
assert.strictEqual(mesReimportado.fechado, true);
assert.deepStrictEqual(mesReimportado.splits, splitsCongelados);

// ---- 8. Zerar custos só afeta contas em Crescendo ----

const zCrescendo = DB.criarFarm({ username: 'zerar-crescendo', custo_proprio: 40, data_inicio: iso(1) });
const zMonetizada = DB.criarFarm({ username: 'zerar-monetizada', custo_proprio: 70, data_inicio: iso(1) });
DB.alterarStatusFarm(zMonetizada.id, 'Monetizada');
const zVendida = DB.criarFarm({ username: 'zerar-vendida', custo_proprio: 60, data_inicio: iso(1) });
DB.registrarVendaFarm(zVendida.id, { preco_venda: 200 });
const lucroVendidaAntes = DB.getFarm(zVendida.id).lucro;

const zerados = DB.zerarCustosFarmCrescendo();
assert.strictEqual(DB.getFarm(zCrescendo.id).custo_proprio, 0, 'conta em Crescendo deveria ter o custo zerado');
assert.strictEqual(DB.getFarm(zMonetizada.id).custo_proprio, 70, 'conta Monetizada não pode ser zerada');
assert.strictEqual(DB.getFarm(zVendida.id).custo_proprio, 60, 'conta vendida não pode ser zerada');
assert.strictEqual(DB.getFarm(zVendida.id).lucro, lucroVendidaAntes, 'lucro já realizado não pode mudar');
assert.ok(zerados >= 1, 'deveria reportar ao menos uma conta zerada');
assert.strictEqual(DB.zerarCustosFarmCrescendo(), 0, 'rodar de novo não deve afetar nenhuma conta');

// ---- 9. Venda com data retroativa não estica os dias em Crescendo ----

// addFarmHistorico carimba o evento com a hora atual, então uma venda ocorrida
// em julho mas digitada hoje não pode fazer a conta contar como Crescendo até
// hoje — quem manda no fim da conta é data_venda.
const contaRetro = DB.criarFarm({ username: 'venda-retroativa', data_inicio: iso(1) });
DB.registrarVendaFarm(contaRetro.id, { preco_venda: 300, data_venda: iso(10) });

const diasRetro = DB.diasCrescendoNoMes(contaRetro.id, ANO, MES);
assert.ok(Math.abs(diasRetro - 9) < 0.01, `venda-retroativa deveria ter 9 dias (vendida no dia 10); obteve ${diasRetro}`);
assert.strictEqual(DB.diasCrescendoNoMes(contaRetro.id, ANO, MES + 1), 0, 'conta vendida não pode contar dias depois da data da venda');

// ---- 10. Reabrir um mês desfaz o rateio e deixa fechar de novo ----

assert.throws(() => DB.reabrirFarmCustosMes(ANO, MES - 2), /não encontrado/i);

const custoDAntes = DB.getFarm(contaD.id).custo;
const lucroDAntes = DB.getFarm(contaD.id).lucro;
DB.reabrirFarmCustosMes(ANO, MES - 1);

const junhoReaberto = DB.getFarmCustosMes(ANO, MES - 1);
assert.strictEqual(junhoReaberto.fechado, false);
assert.strictEqual(junhoReaberto.splits.length, 0, 'reabrir deve apagar o rateio congelado');
assert.strictEqual(junhoReaberto.itens.length, 1, 'os lançamentos voltam para edição');
assert.ok(Math.abs(DB.getFarm(contaD.id).custo - (custoDAntes - 90)) < 0.01, 'custo da conta-d deveria perder o split estornado');
assert.ok(Math.abs(DB.getFarm(contaD.id).lucro - (lucroDAntes + 90)) < 0.01, 'lucro da conta-d deveria voltar ao valor sem o rateio');
assert.throws(() => DB.reabrirFarmCustosMes(ANO, MES - 1), /não está fechado/);

DB.adicionarFarmCustoMes(ANO, MES - 1, { nome: 'Extra', valor: 10 });
DB.fecharFarmCustosMes(ANO, MES - 1);
assert.ok(Math.abs(DB.getFarm(contaD.id).custo - 100) < 0.01, `custo da conta-d deveria ser 100 após refechar; obteve ${DB.getFarm(contaD.id).custo}`);

console.log('Farm — Custos do mês: testes concluídos com sucesso.');
