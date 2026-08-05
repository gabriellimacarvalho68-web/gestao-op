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
        obj.farm_recursos = obj.farm_recursos || [];
        obj.ofertas = obj.ofertas || [];
        obj.ofertas_historico = obj.ofertas_historico || [];
        obj.ofertas_grupos = obj.ofertas_grupos || [];
        // Migração: custo passa a ser custo_proprio + fatias de recursos
        obj.farm.forEach(f => {
          if (f.custo_proprio == null) f.custo_proprio = Number(f.custo || 0);
          if (!Array.isArray(f.recursos)) f.recursos = [];
        });
        return obj;
      }
    } catch (e) { /* dados corrompidos: recomeça vazio */ }
    return { contas: [], historico: [], farm: [], farm_historico: [], farm_recursos: [], ofertas: [], ofertas_historico: [], ofertas_grupos: [] };
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

  // ---- Recursos compartilhados do farm (proxies etc.) ----
  // Quantas contas usam um recurso (divisor do custo)
  function contasDoRecurso(recursoId) {
    return data.farm.filter(f => (f.recursos || []).includes(recursoId)).length;
  }

  // Fatia do custo de um recurso por conta que o usa
  function custoRecursoPorConta(recursoId) {
    const r = data.farm_recursos.find(x => x.id === recursoId);
    if (!r) return 0;
    const n = contasDoRecurso(recursoId);
    return n > 0 ? Number(r.custo_total || 0) / n : 0;
  }

  // Custo total de uma conta = custo próprio + soma das fatias dos recursos
  function custoTotalFarm(f) {
    let total = Number(f.custo_proprio || 0);
    (f.recursos || []).forEach(rid => { total += custoRecursoPorConta(rid); });
    return total;
  }

  // Recalcula o custo (e o lucro das vendidas) de TODAS as contas de farm.
  // Chamado sempre que muda um recurso, um vínculo ou o custo próprio.
  function recalcularCustosFarm() {
    data.farm.forEach(f => {
      f.custo = custoTotalFarm(f);
      f.lucro = calcLucroFarm(f);
    });
  }

  function listarRecursosFarm() {
    return [...data.farm_recursos].sort((a, b) => a.criado_em.localeCompare(b.criado_em));
  }

  function criarRecursoFarm(nome, custoTotal) {
    nome = String(nome || '').trim();
    if (!nome) throw new Error('Dê um nome ao recurso.');
    if (custoTotal == null || custoTotal === '' || isNaN(Number(custoTotal)) || Number(custoTotal) < 0)
      throw new Error('Informe um custo válido para o recurso.');
    const r = { id: uuid(), nome, custo_total: Number(custoTotal), criado_em: now() };
    data.farm_recursos.push(r);
    persist();
    return r;
  }

  function atualizarRecursoFarm(id, { nome, custo_total }) {
    const r = data.farm_recursos.find(x => x.id === id);
    if (!r) throw new Error('Recurso não encontrado.');
    if (nome != null) {
      const n = String(nome).trim();
      if (!n) throw new Error('Dê um nome ao recurso.');
      r.nome = n;
    }
    if (custo_total != null && custo_total !== '' && !isNaN(Number(custo_total)) && Number(custo_total) >= 0) {
      r.custo_total = Number(custo_total);
    }
    recalcularCustosFarm(); // custo por conta muda
    persist();
    return r;
  }

  function excluirRecursoFarm(id) {
    data.farm_recursos = data.farm_recursos.filter(r => r.id !== id);
    data.farm.forEach(f => { f.recursos = (f.recursos || []).filter(rid => rid !== id); });
    recalcularCustosFarm();
    persist();
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
    let mudou = false;
    if (campos.username != null) {
      const u = String(campos.username).trim();
      if (!u) throw new Error('Username é obrigatório.');
      if (usernameExiste(u, id)) throw new Error('Já existe uma conta com esse username.');
      if (u !== conta.username) { conta.username = u; mudou = true; }
    }
    ['email', 'senha', 'fornecedor', 'observacoes'].forEach(k => {
      if (campos[k] != null) {
        const v = String(campos[k]).trim();
        if (v !== conta[k]) { conta[k] = v; mudou = true; }
      }
    });
    if (campos.preco_compra != null && campos.preco_compra !== '' &&
        !isNaN(Number(campos.preco_compra)) && Number(campos.preco_compra) >= 0) {
      const anterior = conta.preco_compra;
      if (Number(campos.preco_compra) !== anterior) {
        conta.preco_compra = Number(campos.preco_compra);
        conta.lucro = calcLucro(conta);
        addHistorico(id, 'Compra atualizada', `De ${fmtBRL(anterior)} para ${fmtBRL(conta.preco_compra)}.`);
      }
    }
    // Valor da venda só é editável quando a conta já foi vendida
    if (conta.preco_venda != null && campos.preco_venda != null && campos.preco_venda !== '' &&
        !isNaN(Number(campos.preco_venda)) && Number(campos.preco_venda) >= 0) {
      const anterior = conta.preco_venda;
      if (Number(campos.preco_venda) !== anterior) {
        conta.preco_venda = Number(campos.preco_venda);
        conta.lucro = calcLucro(conta);
        addHistorico(id, 'Venda atualizada', `De ${fmtBRL(anterior)} para ${fmtBRL(conta.preco_venda)}.`);
      }
    }
    if (mudou) addHistorico(id, 'Dados atualizados', 'Informações da conta editadas.');
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

  function criarFarm({ username, plataforma, email, senha, custo_proprio, custo, status, observacoes, data_inicio, recursos }) {
    username = String(username || '').trim();
    plataforma = String(plataforma || '').trim();
    if (!username) throw new Error('Username é obrigatório.');
    // custo_proprio (aquisição da conta); aceita 'custo' como alias legado
    const proprio = custo_proprio != null ? custo_proprio : custo;
    if (proprio !== '' && proprio != null && isNaN(Number(proprio)))
      throw new Error('Custo inválido.');
    if (farmUsernameExiste(username)) throw new Error('Já existe uma conta em farm com esse username.');

    const f = {
      id: uuid(),
      username,
      plataforma,
      email: String(email || '').trim(),
      senha: String(senha || ''),
      custo_proprio: proprio == null || proprio === '' ? 0 : Number(proprio),
      recursos: Array.isArray(recursos) ? recursos.slice() : [],
      custo: 0, // calculado abaixo
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
    recalcularCustosFarm(); // define f.custo e redivide recursos entre as contas
    addFarmHistorico(f.id, 'Conta criada', `Conta @${f.username} adicionada ao farm${f.plataforma ? ' — ' + f.plataforma : ''}.`);
    if (f.custo > 0) {
      addFarmHistorico(f.id, 'Custo registrado', `Custo inicial de ${fmtBRL(f.custo)}.`);
    }
    persist();
    return f;
  }

  function atualizarFarm(id, campos) {
    const f = getFarm(id);
    if (!f) throw new Error('Conta não encontrada.');
    let mudou = false;
    if (campos.username != null) {
      const u = String(campos.username).trim();
      if (!u) throw new Error('Username é obrigatório.');
      if (farmUsernameExiste(u, id)) throw new Error('Já existe uma conta em farm com esse username.');
      if (u !== f.username) { f.username = u; mudou = true; }
    }
    ['plataforma', 'email', 'senha', 'observacoes'].forEach(k => {
      if (campos[k] != null) {
        const v = String(campos[k]).trim();
        if (v !== f[k]) { f[k] = v; mudou = true; }
      }
    });
    // Custo próprio (aquisição). Aceita 'custo' como alias legado.
    const proprio = campos.custo_proprio != null ? campos.custo_proprio : campos.custo;
    if (proprio != null && proprio !== '' && !isNaN(Number(proprio)) && Number(proprio) >= 0) {
      if (Number(proprio) !== Number(f.custo_proprio || 0)) { f.custo_proprio = Number(proprio); mudou = true; }
    }
    // Recursos vinculados (proxies etc.)
    if (Array.isArray(campos.recursos)) {
      const novo = campos.recursos.slice();
      if (JSON.stringify(novo) !== JSON.stringify(f.recursos || [])) { f.recursos = novo; mudou = true; }
    }
    // Valor da venda só é editável quando a conta já foi vendida
    if (f.preco_venda != null && campos.preco_venda != null && campos.preco_venda !== '' &&
        !isNaN(Number(campos.preco_venda)) && Number(campos.preco_venda) >= 0) {
      const anterior = f.preco_venda;
      if (Number(campos.preco_venda) !== anterior) {
        f.preco_venda = Number(campos.preco_venda);
        addFarmHistorico(id, 'Venda atualizada', `De ${fmtBRL(anterior)} para ${fmtBRL(f.preco_venda)}.`);
      }
    }
    recalcularCustosFarm(); // recalcula custo/lucro de todas (o split pode ter mudado)
    if (mudou) addFarmHistorico(id, 'Dados atualizados', 'Informações da conta editadas.');
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
    recalcularCustosFarm(); // remover a conta muda a divisão dos recursos dela
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
  // ---- Nichos (grupos) do Grupo de Ofertas ----
  // Garante ao menos um nicho e migra registros antigos (sem grupo_id) para ele.
  function garantirGruposOferta() {
    let mudou = false;
    if (data.ofertas_grupos.length === 0) {
      data.ofertas_grupos.push({ id: uuid(), nome: 'Nicho 1', criado_em: now() });
      mudou = true;
    }
    const primeiro = data.ofertas_grupos[0];
    data.ofertas.forEach(o => { if (!o.grupo_id) { o.grupo_id = primeiro.id; mudou = true; } });
    if (mudou) persist();
    return data.ofertas_grupos;
  }

  function listarGruposOferta() {
    garantirGruposOferta();
    return [...data.ofertas_grupos].sort((a, b) => a.criado_em.localeCompare(b.criado_em));
  }

  function criarGrupoOferta(nome) {
    nome = String(nome || '').trim();
    if (!nome) throw new Error('Dê um nome ao nicho.');
    garantirGruposOferta();
    const g = { id: uuid(), nome, criado_em: now() };
    data.ofertas_grupos.push(g);
    persist();
    return g;
  }

  function renomearGrupoOferta(id, nome) {
    nome = String(nome || '').trim();
    if (!nome) throw new Error('Dê um nome ao nicho.');
    const g = data.ofertas_grupos.find(x => x.id === id);
    if (!g) throw new Error('Nicho não encontrado.');
    g.nome = nome;
    persist();
    return g;
  }

  function excluirGrupoOferta(id) {
    const mesesIds = data.ofertas.filter(o => o.grupo_id === id).map(o => o.id);
    data.ofertas_grupos = data.ofertas_grupos.filter(g => g.id !== id);
    data.ofertas = data.ofertas.filter(o => o.grupo_id !== id);
    data.ofertas_historico = data.ofertas_historico.filter(h => !mesesIds.includes(h.oferta_id));
    persist();
  }

  function getOfertaMes(grupoId, ano, mes) {
    return data.ofertas.find(o => o.grupo_id === grupoId && o.ano === ano && o.mes === mes) || null;
  }

  function getOfertaMesId(id) {
    return data.ofertas.find(o => o.id === id) || null;
  }

  function garantirMes(grupoId, ano, mes) {
    let o = getOfertaMes(grupoId, ano, mes);
    if (!o) {
      o = { id: uuid(), grupo_id: grupoId, ano, mes, investimento: 0, receitas: [], criado_em: now(), atualizado_em: now() };
      data.ofertas.push(o);
    }
    return o;
  }

  function totalReceitasMes(o) {
    return o.receitas.reduce((s, r) => s + Number(r.valor || 0), 0);
  }

  function definirInvestimentoMes(grupoId, ano, mes, valor) {
    if (valor == null || valor === '' || isNaN(Number(valor)) || Number(valor) < 0)
      throw new Error('Informe um valor de investimento válido.');
    const o = garantirMes(grupoId, ano, mes);
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

  function adicionarReceitaOferta(grupoId, ano, mes, { valor, data: dataReceita, categoria, descricao }) {
    if (valor == null || valor === '' || isNaN(Number(valor)))
      throw new Error('Informe um valor de receita válido.');
    const o = garantirMes(grupoId, ano, mes);
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

  function historicoDasOfertas(mesId) {
    return data.ofertas_historico
      .filter(h => h.oferta_id === mesId)
      .sort((a, b) => a.criado_em.localeCompare(b.criado_em));
  }

  // ============================================================
  //   RESUMOS PADRONIZADOS — consumidos pelo Dashboard Geral
  //   Modelo REALIZADO: só contas vendidas entram em receita/investimento/
  //   lucro/ROI. O estoque não entra (mostrado à parte como capital parado).
  //   Cada resumo aceita um período: 'mes' | '6meses' | 'tudo'.
  //   Toda nova operação só precisa expor um resumo neste formato.
  // ============================================================
  function roiDe(receita, investimento) {
    return investimento > 0 ? ((receita - investimento) / investimento) * 100 : 0;
  }

  // Data inicial do período (null = tudo). Filtra pela data de realização.
  function inicioPeriodo(periodo) {
    const agora = new Date();
    if (periodo === 'mes') return new Date(agora.getFullYear(), agora.getMonth(), 1);
    if (periodo === '6meses') return new Date(agora.getFullYear(), agora.getMonth() - 5, 1);
    return null; // 'tudo'
  }

  function resumoCompraVenda(periodo) {
    const desde = inicioPeriodo(periodo);
    const desdeISO = desde ? desde.toISOString() : null;
    const noRange = iso => !desdeISO || (iso && iso >= desdeISO);
    // Receita/investimento só das vendidas no período
    const vendidas = data.contas.filter(c => c.preco_venda != null && noRange(c.data_venda));
    const investimento = vendidas.reduce((s, c) => s + Number(c.preco_compra || 0), 0);
    const receita = vendidas.reduce((s, c) => s + Number(c.preco_venda || 0), 0);
    // Estoque é sempre o estado atual (não depende do período)
    const estoqueLista = data.contas.filter(c => c.preco_venda == null);
    const capitalEstoque = estoqueLista.reduce((s, c) => s + Number(c.preco_compra || 0), 0);
    return {
      id: 'compra-venda', nome: 'Compra e Venda', rota: '#/contas',
      receita, investimento, lucro: receita - investimento, roi: roiDe(receita, investimento),
      ativas: estoqueLista.length, concluidas: vendidas.length,
      extra: { estoque: estoqueLista.length, capitalEstoque, vendidas: vendidas.length },
    };
  }

  function resumoFarm(periodo) {
    const desde = inicioPeriodo(periodo);
    const desdeISO = desde ? desde.toISOString() : null;
    const noRange = iso => !desdeISO || (iso && iso >= desdeISO);
    const vendidas = data.farm.filter(f => f.preco_venda != null && noRange(f.data_venda));
    const investimento = vendidas.reduce((s, f) => s + Number(f.custo || 0), 0);
    const receita = vendidas.reduce((s, f) => s + Number(f.preco_venda || 0), 0);
    const emFarmLista = data.farm.filter(f => f.preco_venda == null);
    const capitalFarm = emFarmLista.reduce((s, f) => s + Number(f.custo || 0), 0);
    return {
      id: 'farm', nome: 'Farm', rota: '#/farm',
      receita, investimento, lucro: receita - investimento, roi: roiDe(receita, investimento),
      ativas: emFarmLista.length, concluidas: vendidas.length,
      extra: { emFarm: emFarmLista.length, capitalFarm, vendidas: vendidas.length },
    };
  }

  // Resumo COMBINADO de todos os nichos (usado no card do dashboard)
  function resumoOfertas(periodo) {
    const desde = inicioPeriodo(periodo);
    const mesNoRange = (ano, mes) => !desde || new Date(ano, mes, 1) >= desde;
    const meses = data.ofertas.filter(o => mesNoRange(o.ano, o.mes));
    const investimento = meses.reduce((s, o) => s + Number(o.investimento || 0), 0);
    const receita = meses.reduce((s, o) => s + totalReceitasMes(o), 0);
    const agora = new Date();
    const lancamentosMes = data.ofertas
      .filter(o => o.ano === agora.getFullYear() && o.mes === agora.getMonth())
      .reduce((s, o) => s + o.receitas.length, 0);
    return {
      id: 'ofertas', nome: 'Grupo de Ofertas', rota: '#/ofertas',
      receita, investimento, lucro: receita - investimento, roi: roiDe(receita, investimento),
      ativas: data.ofertas_grupos.length, concluidas: 0,
      extra: { lancamentosMes, nichos: data.ofertas_grupos.length },
    };
  }

  // Resumo de UM nicho (usado na tela de Ofertas)
  function resumoOfertasGrupo(grupoId, periodo) {
    const desde = inicioPeriodo(periodo);
    const mesNoRange = (ano, mes) => !desde || new Date(ano, mes, 1) >= desde;
    const meses = data.ofertas.filter(o => o.grupo_id === grupoId && mesNoRange(o.ano, o.mes));
    const investimento = meses.reduce((s, o) => s + Number(o.investimento || 0), 0);
    const receita = meses.reduce((s, o) => s + totalReceitasMes(o), 0);
    return { receita, investimento, lucro: receita - investimento, roi: roiDe(receita, investimento) };
  }

  // Registro de operações — adicionar uma nova é só incluir seu resumo aqui.
  function resumosOperacoes(periodo) {
    return [resumoCompraVenda(periodo), resumoFarm(periodo), resumoOfertas(periodo)];
  }

  function resumoGeral(periodo) {
    const ops = resumosOperacoes(periodo);
    const receita = ops.reduce((s, o) => s + o.receita, 0);
    const investimento = ops.reduce((s, o) => s + o.investimento, 0);
    return { receita, investimento, lucro: receita - investimento, roi: roiDe(receita, investimento), operacoes: ops };
  }

  // Resumo geral filtrado por período (soma dos resumos das operações).
  // periodo: 'mes' | '6meses' | 'tudo'
  function resumoGeralPeriodo(periodo) {
    return resumoGeral(periodo);
  }

  // Evolução mensal por operação (modelo realizado: lucro da venda no mês da
  // venda; contas em estoque não entram. Ofertas: receitas − investimento do mês)
  function evolucaoMensal(n = 6) {
    const meses = [];
    const agora = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
      meses.push({ ano: d.getFullYear(), mes: d.getMonth(), compraVenda: 0, farm: 0, ofertas: 0, geral: 0 });
    }
    const bucket = (ano, mes) => meses.find(m => m.ano === ano && m.mes === mes);

    data.contas.forEach(c => {
      if (c.preco_venda == null || !c.data_venda) return;
      const d = new Date(c.data_venda);
      const b = bucket(d.getFullYear(), d.getMonth());
      if (b) b.compraVenda += Number(c.preco_venda || 0) - Number(c.preco_compra || 0);
    });
    data.farm.forEach(f => {
      if (f.preco_venda == null || !f.data_venda) return;
      const d = new Date(f.data_venda);
      const b = bucket(d.getFullYear(), d.getMonth());
      if (b) b.farm += Number(f.preco_venda || 0) - Number(f.custo || 0);
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
      versao: 5,
      exportado_em: now(),
      contas: data.contas,
      historico: data.historico,
      farm: data.farm,
      farm_historico: data.farm_historico,
      farm_recursos: data.farm_recursos,
      ofertas: data.ofertas,
      ofertas_historico: data.ofertas_historico,
      ofertas_grupos: data.ofertas_grupos,
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
    const farmRecursos = Array.isArray(obj.farm_recursos) ? obj.farm_recursos : [];
    if (farm.some(f => !f.id || !f.username))
      throw new Error('Backup corrompido: farm sem id/username.');
    const ofertas = Array.isArray(obj.ofertas) ? obj.ofertas : [];
    const ofertasHist = Array.isArray(obj.ofertas_historico) ? obj.ofertas_historico : [];
    const ofertasGrupos = Array.isArray(obj.ofertas_grupos) ? obj.ofertas_grupos : [];
    if (ofertas.some(o => !o.id || !Array.isArray(o.receitas)))
      throw new Error('Backup corrompido: ofertas em formato inválido.');
    // Migração dos itens de farm (custo_proprio/recursos)
    farm.forEach(f => {
      if (f.custo_proprio == null) f.custo_proprio = Number(f.custo || 0);
      if (!Array.isArray(f.recursos)) f.recursos = [];
    });
    data = {
      contas: obj.contas, historico: obj.historico,
      farm, farm_historico: farmHist, farm_recursos: farmRecursos,
      ofertas, ofertas_historico: ofertasHist, ofertas_grupos: ofertasGrupos,
    };
    recalcularCustosFarm();
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
    listarRecursosFarm, criarRecursoFarm, atualizarRecursoFarm, excluirRecursoFarm,
    contasDoRecurso, custoRecursoPorConta,
    listarGruposOferta, criarGrupoOferta, renomearGrupoOferta, excluirGrupoOferta,
    getOfertaMes, getOfertaMesId, definirInvestimentoMes, adicionarReceitaOferta,
    excluirReceitaOferta, historicoDasOfertas, totalReceitasMes,
    resumoCompraVenda, resumoFarm, resumoOfertas, resumoOfertasGrupo, resumosOperacoes, resumoGeral, resumoGeralPeriodo,
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
