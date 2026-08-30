const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const test = require('node:test');
const XLSX = require('xlsx');
const { lerPlanilhaFarm } = require('../farm-excel');

test('lê a tabela FARM mesmo quando existe um título antes do cabeçalho', () => {
  const arquivo = path.join(os.tmpdir(), `gestao-op-farm-${Date.now()}.xlsx`);
  const planilha = XLSX.utils.aoa_to_sheet([
    ['CONTAS CRIADAS'],
    [],
    ['data', 'usuario', 'email', 'senha', 'IP', 'observações', 'estágio', 'lote'],
    ['29/08/2026', 'usuario_teste', 'teste@example.com', 'senha-teste', '200.1.1.1', 'importada', 'crescendo', 5],
  ]);
  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, planilha, 'Contas');
  XLSX.writeFile(livro, arquivo);

  try {
    const resultado = lerPlanilhaFarm(arquivo);
    assert.strictEqual(resultado.aba, 'Contas');
    assert.strictEqual(resultado.registros.length, 1);
    assert.strictEqual(resultado.registros[0].linha, 4);
    assert.strictEqual(resultado.registros[0].valores.usuario, 'usuario_teste');
    assert.strictEqual(resultado.registros[0].valores.observacoes, 'importada');
    assert.strictEqual(resultado.registros[0].valores.lote, '5');
  } finally {
    if (fs.existsSync(arquivo)) fs.unlinkSync(arquivo);
  }
});
