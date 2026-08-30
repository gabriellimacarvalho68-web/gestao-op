const fs = require('fs');
const XLSX = require('xlsx');

function normalizarCabecalho(valor) {
  return String(valor || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function linhaTemCabecalhoFarm(linha) {
  const cabecalhos = linha.map(normalizarCabecalho);
  return cabecalhos.includes('usuario') || cabecalhos.includes('username');
}

function lerPlanilhaFarm(caminho) {
  if (!caminho || !fs.existsSync(caminho)) {
    throw new Error('A planilha selecionada não foi encontrada. Escolha o arquivo novamente.');
  }

  let livro;
  try {
    livro = XLSX.readFile(caminho, { cellDates: false });
  } catch (_erro) {
    throw new Error('Não foi possível ler este arquivo Excel. Salve-o como .xlsx e tente novamente.');
  }

  for (const nomeAba of livro.SheetNames) {
    const aba = livro.Sheets[nomeAba];
    const linhas = XLSX.utils.sheet_to_json(aba, { header: 1, defval: '', raw: false });
    const indiceCabecalho = linhas.findIndex(linhaTemCabecalhoFarm);
    if (indiceCabecalho < 0) continue;

    const cabecalhos = linhas[indiceCabecalho].map(normalizarCabecalho);
    const registros = linhas.slice(indiceCabecalho + 1).map((celulas, indice) => {
      const valores = {};
      cabecalhos.forEach((cabecalho, coluna) => {
        if (cabecalho) valores[cabecalho] = String(celulas[coluna] ?? '').trim();
      });
      return { linha: indiceCabecalho + indice + 2, valores };
    }).filter(registro => Object.values(registro.valores).some(Boolean));

    const estat = fs.statSync(caminho);
    return {
      aba: nomeAba,
      atualizadoEm: estat.mtime.toISOString(),
      registros,
    };
  }

  throw new Error('Não encontrei a coluna “usuario” na planilha. Confira o cabeçalho e tente novamente.');
}

module.exports = { lerPlanilhaFarm, normalizarCabecalho };
