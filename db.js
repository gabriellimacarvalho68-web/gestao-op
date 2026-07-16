/* ============================================================
   Camada de dados — localStorage
   Tabelas: contas (1:N) historico
   Regras de negócio RN1–RN6 implementadas aqui.
   ============================================================ */

const DB = (() => {
  const KEY = 'gestao-op-v1';

  const STATUS = ['Comprada', 'Vendida', 'Shop', 'Monetizada', 'Ambos', 'Nada'];

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* dados corrompidos: recomeça vazio */ }
    return { contas: [], historico: [] };
  }

  let data = load();

  function persist() {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  function now() {
    return new Date().toISOString();
  }

  function addHistorico(contaId, evento, descricao) {
    data.historico.push({
      id: uuid(),
      conta_id: contaId,
      evento,
      descricao: descricao || '',
      criado_em: now(),
    });
  }

  // RN1 / RN2 — lucro = venda − compra; R$ 0,00 enquanto não vendida
  function calcLucro(conta) {
    if (conta.preco_venda == null) return 0;
    return Number(conta.preco_venda) - Number(conta.preco_compra || 0);
  }

  // RN4 — username único (ignora maiúsculas/minúsculas e @)
  function usernameExiste(username, ignorarId) {
    const norm = String(username).trim().replace(/^@/, '').toLowerCase();
    return data.contas.some(c =>
      c.id !== ignorarId &&
      c.username.trim().replace(/^@/, '').toLowerCase() === norm
    );
  }

  function getConta(id) {
    return data.contas.find(c => c.id === id) || null;
  }

  function criarConta({ username, email, senha, fornecedor, preco_compra, status, observacoes, data_compra }) {
    username = String(username || '').trim();
    fornecedor = String(fornecedor || '').trim();
    if (!username) throw new Error('Username é obrigatório.');
    if (!fornecedor) throw new Error('Fornecedor é obrigatório.');
    if (preco_compra == null || preco_compra === '' || isNaN(Number(preco_compra)))
      throw new Error('Valor de compra é obrigatório.');
    if (usernameExiste(username)) throw new Error('Já existe uma conta com esse username.');

    const conta = {
      id: uuid(),
      username,
      email: String(email || '').trim(),
      senha: String(senha || ''),
      fornecedor,
      preco_compra: Number(preco_compra),
      preco_venda: null,
      lucro: 0,
      status: STATUS.includes(status) ? status : 'Comprada',
      observacoes: String(observacoes || '').trim(),
      data_compra: data_compra || now(),
      data_venda: null,
      criado_em: now(),
      atualizado_em: now(),
    };
    data.contas.push(conta);
    addHistorico(conta.id, 'Conta criada', `Conta @${conta.username} cadastrada.`);
    addHistorico(conta.id, 'Compra registrada', `Compra de ${fmtBRL(conta.preco_compra)} — fornecedor ${conta.fornecedor}.`);
    persist();
    return conta;
  }

  function atualizarConta(id, campos) {
    const conta = getConta(id);
    if (!conta) throw new Error('Conta não encontrada.');
    if (campos.username != null) {
      const u = String(campos.username).trim();
      if (!u) throw new Error('Username é obrigatório.');
      if (usernameExiste(u, id)) throw new Error('Já existe uma conta com esse username.');
      conta.username = u;
    }
    ['email', 'senha', 'fornecedor', 'observacoes'].forEach(k => {
      if (campos[k] != null) conta[k] = String(campos[k]).trim();
    });
    if (campos.preco_compra != null && !isNaN(Number(campos.preco_compra))) {
      conta.preco_compra = Number(campos.preco_compra);
      conta.lucro = calcLucro(conta);
    }
    conta.atualizado_em = now();
    persist();
    return conta;
  }

  // RN6 — alteração de status gera histórico
  function alterarStatus(id, novoStatus) {
    const conta = getConta(id);
    if (!conta) throw new Error('Conta não encontrada.');
    if (!STATUS.includes(novoStatus)) throw new Error('Status inválido.');
    if (conta.status === novoStatus) return conta;
    const anterior = conta.status;
    conta.status = novoStatus;
    conta.atualizado_em = now();
    addHistorico(id, `Status alterado para ${novoStatus}`, `De ${anterior} para ${novoStatus}.`);
    persist();
    return conta;
  }

  // RN3 / RN5 — uma única venda; data preenchida automaticamente
  function registrarVenda(id, { preco_venda, data_venda, observacoes }) {
    const conta = getConta(id);
    if (!conta) throw new Error('Conta não encontrada.');
    if (conta.preco_venda != null) throw new Error('Esta conta já foi vendida.');
    if (preco_venda == null || preco_venda === '' || isNaN(Number(preco_venda)))
      throw new Error('Valor da venda é obrigatório.');

    conta.preco_venda = Number(preco_venda);
    conta.lucro = calcLucro(conta);
    conta.data_venda = data_venda || now();
    conta.atualizado_em = now();
    const anterior = conta.status;
    conta.status = 'Vendida';
    if (anterior !== 'Vendida') {
      addHistorico(id, 'Status alterado para Vendida', `De ${anterior} para Vendida.`);
    }
    let desc = `Venda de ${fmtBRL(conta.preco_venda)} — lucro de ${fmtBRL(conta.lucro)}.`;
    if (observacoes && observacoes.trim()) desc += ` Obs.: ${observacoes.trim()}`;
    addHistorico(id, 'Venda registrada', desc);
    persist();
    return conta;
  }

  function excluirConta(id) {
    data.contas = data.contas.filter(c => c.id !== id);
    data.historico = data.historico.filter(h => h.conta_id !== id);
    persist();
  }

  function listarContas({ busca, status, ordenar } = {}) {
    let lista = [...data.contas];
    if (busca && busca.trim()) {
      const q = busca.trim().toLowerCase();
      lista = lista.filter(c =>
        c.username.toLowerCase().includes(q) ||
        (c.fornecedor || '').toLowerCase().includes(q)
      );
    }
    if (status && status !== 'Todas') {
      lista = lista.filter(c => c.status === status);
    }
    switch (ordenar) {
      case 'antiga':       lista.sort((a, b) => a.criado_em.localeCompare(b.criado_em)); break;
      case 'maior-lucro':  lista.sort((a, b) => b.lucro - a.lucro); break;
      case 'menor-lucro':  lista.sort((a, b) => a.lucro - b.lucro); break;
      default:             lista.sort((a, b) => b.criado_em.localeCompare(a.criado_em));
    }
    return lista;
  }

  function historicoDaConta(id) {
    return data.historico
      .filter(h => h.conta_id === id)
      .sort((a, b) => a.criado_em.localeCompare(b.criado_em));
  }

  // ---------- Indicadores do dashboard ----------
  function indicadores() {
    const contas = data.contas;
    const vendidas = contas.filter(c => c.preco_venda != null);
    const estoque = contas.length - vendidas.length;
    const investido = contas.reduce((s, c) => s + Number(c.preco_compra || 0), 0);
    const lucro = vendidas.reduce((s, c) => s + Number(c.lucro || 0), 0);
    const receita = vendidas.reduce((s, c) => s + Number(c.preco_venda || 0), 0);
    const ticket = vendidas.length ? receita / vendidas.length : 0;

    const agora = new Date();
    const vendidasMes = vendidas.filter(c => {
      const d = new Date(c.data_venda);
      return d.getFullYear() === agora.getFullYear() && d.getMonth() === agora.getMonth();
    }).length;

    const custoVendidas = vendidas.reduce((s, c) => s + Number(c.preco_compra || 0), 0);
    const margem = custoVendidas > 0 ? (lucro / custoVendidas) * 100 : 0;

    return {
      total: contas.length,
      estoque,
      investido,
      lucro,
      ticket,
      vendidasMes,
      margem,
    };
  }

  // Lucro agregado por mês (últimos n meses) para o gráfico
  function lucroMensal(n = 6) {
    const meses = [];
    const agora = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
      meses.push({ ano: d.getFullYear(), mes: d.getMonth(), valor: 0 });
    }
    data.contas.forEach(c => {
      if (c.data_venda == null) return;
      const d = new Date(c.data_venda);
      const m = meses.find(x => x.ano === d.getFullYear() && x.mes === d.getMonth());
      if (m) m.valor += Number(c.lucro || 0);
    });
    return meses;
  }

  // ---------- Backup ----------
  function exportar() {
    return JSON.stringify({
      app: 'gestao-op',
      versao: 1,
      exportado_em: now(),
      contas: data.contas,
      historico: data.historico,
    }, null, 2);
  }

  function importar(texto) {
    let obj;
    try { obj = JSON.parse(texto); } catch (e) {
      throw new Error('Arquivo inválido: não é um backup do Gestão Op.');
    }
    if (!obj || obj.app !== 'gestao-op' || !Array.isArray(obj.contas) || !Array.isArray(obj.historico))
      throw new Error('Arquivo inválido: não é um backup do Gestão Op.');
    if (obj.contas.some(c => !c.id || !c.username))
      throw new Error('Backup corrompido: contas sem id/username.');
    data = { contas: obj.contas, historico: obj.historico };
    persist();
    return { contas: data.contas.length, eventos: data.historico.length };
  }

  function totais() {
    return { contas: data.contas.length, eventos: data.historico.length };
  }

  return {
    STATUS,
    criarConta, atualizarConta, alterarStatus, registrarVenda, excluirConta,
    getConta, listarContas, historicoDaConta,
    indicadores, lucroMensal,
    exportar, importar, totais,
  };
})();

// ---------- Formatadores globais ----------
const _brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function fmtBRL(v) {
  return _brl.format(Number(v || 0));
}

function fmtData(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDataHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) + ' · ' +
         d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
