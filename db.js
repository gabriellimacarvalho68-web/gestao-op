/* ============================================================
   Camada de dados — localStorage
   Tabelas: contas (1:N) historico
   Regras de negócio RN1–RN6 implementadas aqui.
   ============================================================ */

const DB = (() => {
  const KEY = 'gestao-op-v1';

  const STATUS = ['Comprada', 'Vendida', 'Shop', 'Monetizada', 'Ambos', 'Nada'];

  // Estágios do farm (módulo independente de contas)
  const FARM_STATUS = ['Crescendo', 'Shop aceito', 'Monetizada', 'Sem nada', 'Vendida'];

  // Categorias sugeridas para lançamentos do Grupo de Ofertas
  const OFERTAS_CATEGORIAS = ['Tráfego Meta', 'Google Ads', 'Ferramentas', 'Comissão', 'Venda diária', 'Outros'];

  const MESES_NOME = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

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
      if (raw) {
        const obj = JSON.parse(raw);
        // Retrocompatível: dados antigos não têm as chaves do farm
        obj.contas = obj.contas || [];
        obj.historico = obj.historico || [];
        obj.farm = obj.farm || [];
        obj.farm_historico = obj.farm_historico || [];
        obj.ofertas = obj.ofertas || [];
        obj.ofertas_historico = obj.ofertas_historico || [];
        return obj;
      }
    } catch (e) { /* dados corrompidos: recomeça vazio */ }
    return { contas: [], historico: [], farm: [], farm_historico: [], ofertas: [], ofertas_historico: [] };
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

  function addFarmHistorico(farmId, evento, descricao) {
    data.farm_historico.push({
      id: uuid(),
      farm_id: farmId,
      evento,
      descricao: descricao || '',
      criado_em: now(),
    });
  }

  function addOfertaHistorico(ofertaId, evento, descricao) {
    data.ofertas_historico.push({
      id: uuid(),
      oferta_id: ofertaId,
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

  // Farm — lucro = venda − custo investido; R$ 0,00 enquanto não vendida
  function calcLucroFarm(f) {
    if (f.preco_venda == null) return 0;
    return Number(f.preco_venda) - Number(f.custo || 0);
  }

  // Username único dentro do farm (independente das contas de compra/venda)
  function farmUsernameExiste(username, ignorarId) {
    const norm = String(username).trim().replace(/^@/, '').toLowerCase();
    return data.farm.some(f =>
      f.id !== ignorarId &&
      f.username.trim().replace(/^@/, '').toLowerCase() === norm
    );
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

  // Desfaz a venda (ex.: comprador cancelou): zera financeiro e volta ao estoque
  function cancelarVenda(id) {
    const conta = getConta(id);
    if (!conta) throw new Error('Conta não encontrada.');
    if (conta.preco_venda == null) throw new Error('Esta conta não está vendida.');
    const valorAnterior = conta.preco_venda;
    const statusAnterior = conta.status;
    conta.preco_venda = null;
    conta.data_venda = null;
    conta.lucro = 0;
    conta.status = 'Comprada';
    conta.atualizado_em = now();
    addHistorico(id, 'Venda cancelada', `Venda de ${fmtBRL(valorAnterior)} desfeita. Conta voltou ao estoque.`);
    if (statusAnterior !== 'Comprada') {
      addHistorico(id, 'Status alterado para Comprada', `De ${statusAnterior} para Comprada.`);
    }
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

  // ============================================================
  //   FARM — contas em criação/aquecimento (módulo independente)
  // ============================================================
  function getFarm(id) {
    return data.farm.find(f => f.id === id) || null;
  }

  function criarFarm({ username, plataforma, email, senha, custo, status, observacoes, data_inicio }) {
    username = String(username || '').trim();
    plataforma = String(plataforma || '').trim();
    if (!username) throw new Error('Username é obrigatório.');
    if (custo !== '' && custo != null && isNaN(Number(custo)))
      throw new Error('Custo inválido.');
    if (farmUsernameExiste(username)) throw new Error('Já existe uma conta em farm com esse username.');

    const f = {
      id: uuid(),
      username,
      plataforma,
      email: String(email || '').trim(),
      senha: String(senha || ''),
      custo: custo == null || custo === '' ? 0 : Number(custo),
      preco_venda: null,
      lucro: 0,
      status: FARM_STATUS.includes(status) ? status : 'Crescendo',
      observacoes: String(observacoes || '').trim(),
      data_inicio: data_inicio || now(),
      data_venda: null,
      criado_em: now(),
      atualizado_em: now(),
    };
    data.farm.push(f);
    addFarmHistorico(f.id, 'Conta criada', `Conta @${f.username} adicionada ao farm${f.plataforma ? ' — ' + f.plataforma : ''}.`);
    if (f.custo > 0) {
      addFarmHistorico(f.id, 'Custo registrado', `Investimento inicial de ${fmtBRL(f.custo)}.`);
    }
    persist();
    return f;
  }

  function atualizarFarm(id, campos) {
    const f = getFarm(id);
    if (!f) throw new Error('Conta não encontrada.');
    if (campos.username != null) {
      const u = String(campos.username).trim();
      if (!u) throw new Error('Username é obrigatório.');
      if (farmUsernameExiste(u, id)) throw new Error('Já existe uma conta em farm com esse username.');
      f.username = u;
    }
    ['plataforma', 'email', 'senha', 'observacoes'].forEach(k => {
      if (campos[k] != null) f[k] = String(campos[k]).trim();
    });
    if (campos.custo != null && campos.custo !== '' && !isNaN(Number(campos.custo)) && Number(campos.custo) >= 0) {
      const anterior = f.custo;
      f.custo = Number(campos.custo);
      f.lucro = calcLucroFarm(f);
      if (anterior !== f.custo) {
        addFarmHistorico(id, 'Custo atualizado', `De ${fmtBRL(anterior)} para ${fmtBRL(f.custo)}.`);
      }
    }
    f.atualizado_em = now();
    persist();
    return f;
  }

  // Alteração de estágio gera histórico
  function alterarStatusFarm(id, novoStatus) {
    const f = getFarm(id);
    if (!f) throw new Error('Conta não encontrada.');
    if (!FARM_STATUS.includes(novoStatus)) throw new Error('Estágio inválido.');
    if (f.status === novoStatus) return f;
    const anterior = f.status;
    f.status = novoStatus;
    f.atualizado_em = now();
    addFarmHistorico(id, `Estágio alterado para ${novoStatus}`, `De ${anterior} para ${novoStatus}.`);
    persist();
    return f;
  }

  // Uma única venda; lucro = venda − custo
  function registrarVendaFarm(id, { preco_venda, data_venda, observacoes }) {
    const f = getFarm(id);
    if (!f) throw new Error('Conta não encontrada.');
    if (f.preco_venda != null) throw new Error('Esta conta já foi vendida.');
    if (preco_venda == null || preco_venda === '' || isNaN(Number(preco_venda)))
      throw new Error('Valor da venda é obrigatório.');

    f.preco_venda = Number(preco_venda);
    f.lucro = calcLucroFarm(f);
    f.data_venda = data_venda || now();
    f.atualizado_em = now();
    const anterior = f.status;
    f.status = 'Vendida';
    if (anterior !== 'Vendida') {
      addFarmHistorico(id, 'Estágio alterado para Vendida', `De ${anterior} para Vendida.`);
    }
    let desc = `Venda de ${fmtBRL(f.preco_venda)} — lucro de ${fmtBRL(f.lucro)}.`;
    if (observacoes && observacoes.trim()) desc += ` Obs.: ${observacoes.trim()}`;
    addFarmHistorico(id, 'Venda registrada', desc);
    persist();
    return f;
  }

  // Desfaz a venda de uma conta em farm: zera financeiro e volta o estágio ao padrão
  function cancelarVendaFarm(id) {
    const f = getFarm(id);
    if (!f) throw new Error('Conta não encontrada.');
    if (f.preco_venda == null) throw new Error('Esta conta não está vendida.');
    const valorAnterior = f.preco_venda;
    const statusAnterior = f.status;
    f.preco_venda = null;
    f.data_venda = null;
    f.lucro = 0;
    f.status = 'Crescendo';
    f.atualizado_em = now();
    addFarmHistorico(id, 'Venda cancelada', `Venda de ${fmtBRL(valorAnterior)} desfeita.`);
    if (statusAnterior !== 'Crescendo') {
      addFarmHistorico(id, 'Estágio alterado para Crescendo', `De ${statusAnterior} para Crescendo.`);
    }
    persist();
    return f;
  }

  function excluirFarm(id) {
    data.farm = data.farm.filter(f => f.id !== id);
    data.farm_historico = data.farm_historico.filter(h => h.farm_id !== id);
    persist();
  }

  function listarFarm({ busca, status, ordenar } = {}) {
    let lista = [...data.farm];
    if (busca && busca.trim()) {
      const q = busca.trim().toLowerCase();
      lista = lista.filter(f =>
        f.username.toLowerCase().includes(q) ||
        (f.plataforma || '').toLowerCase().includes(q)
      );
    }
    if (status && status !== 'Todas') {
      lista = lista.filter(f => f.status === status);
    }
    switch (ordenar) {
      case 'antiga':       lista.sort((a, b) => a.criado_em.localeCompare(b.criado_em)); break;
      case 'maior-lucro':  lista.sort((a, b) => b.lucro - a.lucro); break;
      case 'menor-lucro':  lista.sort((a, b) => a.lucro - b.lucro); break;
      default:             lista.sort((a, b) => b.criado_em.localeCompare(a.criado_em));
    }
    return lista;
  }

  function historicoDoFarm(id) {
    return data.farm_historico
      .filter(h => h.farm_id === id)
      .sort((a, b) => a.criado_em.localeCompare(b.criado_em));
  }

  function indicadoresFarm() {
    const farm = data.farm;
    const vendidas = farm.filter(f => f.preco_venda != null);
    const ativas = farm.filter(f => f.status !== 'Vendida');
    const investido = farm.reduce((s, f) => s + Number(f.custo || 0), 0);
    const receita = vendidas.reduce((s, f) => s + Number(f.preco_venda || 0), 0);
    const lucro = vendidas.reduce((s, f) => s + Number(f.lucro || 0), 0);

    const porEstagio = {};
    FARM_STATUS.forEach(s => { porEstagio[s] = 0; });
    farm.forEach(f => { if (porEstagio[f.status] != null) porEstagio[f.status]++; });

    return {
      total: farm.length,
      ativas: ativas.length,
      vendidas: vendidas.length,
      investido,
      receita,
      lucro,
      porEstagio,
    };
  }

  // ============================================================
  //   GRUPO DE OFERTAS — financeiro por mês (afiliado)
  //   Investimento único por mês (definido no início) + receitas
  //   lançadas ao longo do mês (ex.: semanalmente).
  // ============================================================
  function getOfertaMes(ano, mes) {
    return data.ofertas.find(o => o.ano === ano && o.mes === mes) || null;
  }

  function getOfertaMesId(id) {
    return data.ofertas.find(o => o.id === id) || null;
  }

  function garantirMes(ano, mes) {
    let o = getOfertaMes(ano, mes);
    if (!o) {
      o = { id: uuid(), ano, mes, investimento: 0, receitas: [], criado_em: now(), atualizado_em: now() };
      data.ofertas.push(o);
    }
    return o;
  }

  function totalReceitasMes(o) {
    return o.receitas.reduce((s, r) => s + Number(r.valor || 0), 0);
  }

  function definirInvestimentoMes(ano, mes, valor) {
    if (valor == null || valor === '' || isNaN(Number(valor)) || Number(valor) < 0)
      throw new Error('Informe um valor de investimento válido.');
    const o = garantirMes(ano, mes);
    const anterior = o.investimento;
    o.investimento = Number(valor);
    o.atualizado_em = now();
    const rotulo = MESES_NOME[mes] + '/' + o.ano;
    if (anterior === 0) {
      addOfertaHistorico(o.id, 'Investimento definido', `Investimento de ${fmtBRL(o.investimento)} para ${rotulo}.`);
    } else if (anterior !== o.investimento) {
      addOfertaHistorico(o.id, 'Investimento atualizado', `De ${fmtBRL(anterior)} para ${fmtBRL(o.investimento)} em ${rotulo}.`);
    }
    persist();
    return o;
  }

  function adicionarReceitaOferta(ano, mes, { valor, data: dataReceita, categoria, descricao }) {
    if (valor == null || valor === '' || isNaN(Number(valor)))
      throw new Error('Informe um valor de receita válido.');
    const o = garantirMes(ano, mes);
    const receita = {
      id: uuid(),
      valor: Number(valor),
      data: dataReceita || now(),
      categoria: String(categoria || '').trim(),
      descricao: String(descricao || '').trim(),
    };
    o.receitas.push(receita);
    o.atualizado_em = now();
    const detalhe = receita.descricao || receita.categoria;
    addOfertaHistorico(o.id, 'Receita registrada',
      `Receita de ${fmtBRL(receita.valor)} em ${MESES_NOME[mes]}/${o.ano}${detalhe ? ' — ' + detalhe : ''}.`);
    persist();
    return receita;
  }

  function excluirReceitaOferta(mesId, receitaId) {
    const o = getOfertaMesId(mesId);
    if (!o) throw new Error('Mês não encontrado.');
    o.receitas = o.receitas.filter(r => r.id !== receitaId);
    o.atualizado_em = now();
    persist();
    return o;
  }

  function listarOfertasMeses() {
    return [...data.ofertas].sort((a, b) => (b.ano - a.ano) || (b.mes - a.mes));
  }

  function historicoDasOfertas(mesId) {
    return data.ofertas_historico
      .filter(h => h.oferta_id === mesId)
      .sort((a, b) => a.criado_em.localeCompare(b.criado_em));
  }

  // ============================================================
  //   RESUMOS PADRONIZADOS — consumidos pelo Dashboard Geral
  //   Modelo caixa: lucro = receita − investimento; roi = lucro/investimento.
  //   Toda nova operação só precisa expor um resumo neste formato.
  // ============================================================
  function roiDe(receita, investimento) {
    return investimento > 0 ? ((receita - investimento) / investimento) * 100 : 0;
  }

  function resumoCompraVenda() {
    const vendidas = data.contas.filter(c => c.preco_venda != null);
    const investimento = data.contas.reduce((s, c) => s + Number(c.preco_compra || 0), 0);
    const receita = vendidas.reduce((s, c) => s + Number(c.preco_venda || 0), 0);
    const estoque = data.contas.length - vendidas.length;
    const agora = new Date();
    const vendidasMes = vendidas.filter(c => {
      const d = new Date(c.data_venda);
      return d.getFullYear() === agora.getFullYear() && d.getMonth() === agora.getMonth();
    }).length;
    return {
      id: 'compra-venda', nome: 'Compra e Venda', rota: '#/contas',
      receita, investimento, lucro: receita - investimento, roi: roiDe(receita, investimento),
      ativas: estoque, concluidas: vendidas.length,
      extra: { estoque, vendidasMes },
    };
  }

  function resumoFarm() {
    const vendidas = data.farm.filter(f => f.preco_venda != null);
    const investimento = data.farm.reduce((s, f) => s + Number(f.custo || 0), 0);
    const receita = vendidas.reduce((s, f) => s + Number(f.preco_venda || 0), 0);
    const emFarm = data.farm.filter(f => f.status !== 'Vendida').length;
    return {
      id: 'farm', nome: 'Farm', rota: '#/farm',
      receita, investimento, lucro: receita - investimento, roi: roiDe(receita, investimento),
      ativas: emFarm, concluidas: vendidas.length,
      extra: { emFarm, vendidas: vendidas.length },
    };
  }

  function resumoOfertas() {
    const investimento = data.ofertas.reduce((s, o) => s + Number(o.investimento || 0), 0);
    const receita = data.ofertas.reduce((s, o) => s + totalReceitasMes(o), 0);
    const agora = new Date();
    const mesAtual = getOfertaMes(agora.getFullYear(), agora.getMonth());
    const lancamentosMes = mesAtual ? mesAtual.receitas.length : 0;
    return {
      id: 'ofertas', nome: 'Grupo de Ofertas', rota: '#/ofertas',
      receita, investimento, lucro: receita - investimento, roi: roiDe(receita, investimento),
      ativas: data.ofertas.length, concluidas: 0,
      extra: { lancamentosMes },
    };
  }

  // Registro de operações — adicionar uma nova é só incluir seu resumo aqui.
  function resumosOperacoes() {
    return [resumoCompraVenda(), resumoFarm(), resumoOfertas()];
  }

  function resumoGeral() {
    const ops = resumosOperacoes();
    const receita = ops.reduce((s, o) => s + o.receita, 0);
    const investimento = ops.reduce((s, o) => s + o.investimento, 0);
    return { receita, investimento, lucro: receita - investimento, roi: roiDe(receita, investimento), operacoes: ops };
  }

  // Evolução mensal por operação (modelo caixa: entradas − saídas no mês)
  function evolucaoMensal(n = 6) {
    const meses = [];
    const agora = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
      meses.push({ ano: d.getFullYear(), mes: d.getMonth(), compraVenda: 0, farm: 0, ofertas: 0, geral: 0 });
    }
    const bucket = (ano, mes) => meses.find(m => m.ano === ano && m.mes === mes);

    data.contas.forEach(c => {
      if (c.data_compra) { const d = new Date(c.data_compra); const b = bucket(d.getFullYear(), d.getMonth()); if (b) b.compraVenda -= Number(c.preco_compra || 0); }
      if (c.data_venda) { const d = new Date(c.data_venda); const b = bucket(d.getFullYear(), d.getMonth()); if (b) b.compraVenda += Number(c.preco_venda || 0); }
    });
    data.farm.forEach(f => {
      if (f.data_inicio) { const d = new Date(f.data_inicio); const b = bucket(d.getFullYear(), d.getMonth()); if (b) b.farm -= Number(f.custo || 0); }
      if (f.data_venda) { const d = new Date(f.data_venda); const b = bucket(d.getFullYear(), d.getMonth()); if (b) b.farm += Number(f.preco_venda || 0); }
    });
    data.ofertas.forEach(o => {
      const b = bucket(o.ano, o.mes);
      if (b) b.ofertas += totalReceitasMes(o) - Number(o.investimento || 0);
    });
    meses.forEach(m => { m.geral = m.compraVenda + m.farm + m.ofertas; });
    return meses;
  }

  // Feed unificado dos últimos eventos de todas as operações
  function atividadeRecente(limite = 12) {
    const itens = [];
    data.historico.forEach(h => itens.push({
      operacao: 'Compra/Venda', evento: h.evento, descricao: h.descricao,
      criado_em: h.criado_em, rota: '#/conta/' + h.conta_id,
    }));
    data.farm_historico.forEach(h => itens.push({
      operacao: 'Farm', evento: h.evento, descricao: h.descricao,
      criado_em: h.criado_em, rota: '#/farm/conta/' + h.farm_id,
    }));
    data.ofertas_historico.forEach(h => itens.push({
      operacao: 'Ofertas', evento: h.evento, descricao: h.descricao,
      criado_em: h.criado_em, rota: '#/ofertas',
    }));
    return itens.sort((a, b) => b.criado_em.localeCompare(a.criado_em)).slice(0, limite);
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
      versao: 3,
      exportado_em: now(),
      contas: data.contas,
      historico: data.historico,
      farm: data.farm,
      farm_historico: data.farm_historico,
      ofertas: data.ofertas,
      ofertas_historico: data.ofertas_historico,
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
    // Farm e Ofertas: opcionais (retrocompatível com backups das versões 1 e 2)
    const farm = Array.isArray(obj.farm) ? obj.farm : [];
    const farmHist = Array.isArray(obj.farm_historico) ? obj.farm_historico : [];
    if (farm.some(f => !f.id || !f.username))
      throw new Error('Backup corrompido: farm sem id/username.');
    const ofertas = Array.isArray(obj.ofertas) ? obj.ofertas : [];
    const ofertasHist = Array.isArray(obj.ofertas_historico) ? obj.ofertas_historico : [];
    if (ofertas.some(o => !o.id || !Array.isArray(o.receitas)))
      throw new Error('Backup corrompido: ofertas em formato inválido.');
    data = {
      contas: obj.contas, historico: obj.historico,
      farm, farm_historico: farmHist,
      ofertas, ofertas_historico: ofertasHist,
    };
    persist();
    return { contas: data.contas.length, eventos: data.historico.length, farm: data.farm.length, ofertas: data.ofertas.length };
  }

  function totais() {
    return {
      contas: data.contas.length,
      eventos: data.historico.length,
      farm: data.farm.length,
      farmEventos: data.farm_historico.length,
      ofertas: data.ofertas.length,
      ofertasEventos: data.ofertas_historico.length,
    };
  }

  return {
    STATUS, FARM_STATUS, OFERTAS_CATEGORIAS,
    criarConta, atualizarConta, alterarStatus, registrarVenda, cancelarVenda, excluirConta,
    getConta, listarContas, historicoDaConta,
    indicadores, lucroMensal,
    criarFarm, atualizarFarm, alterarStatusFarm, registrarVendaFarm, cancelarVendaFarm, excluirFarm,
    getFarm, listarFarm, historicoDoFarm, indicadoresFarm,
    getOfertaMes, getOfertaMesId, definirInvestimentoMes, adicionarReceitaOferta,
    excluirReceitaOferta, listarOfertasMeses, historicoDasOfertas, totalReceitasMes,
    resumoCompraVenda, resumoFarm, resumoOfertas, resumosOperacoes, resumoGeral,
    evolucaoMensal, atividadeRecente,
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
