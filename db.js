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

  // Bases disponíveis para custos livres do TTpost. O nome e o valor são
  // definidos pelo usuário; a base diz qual contador automático será usado.
  const TTPOST_CUSTO_BASES = [
    'mensal_compartilhado',
    'mensal_por_conta',
    'por_postagem',
    'por_hora_aquecimento',
    'por_conta_dia',
    'fixo_por_conta',
  ];
  const TTPOST_ESCOPOS = ['todos', 'adspower', 'dolphin', 'mobile'];

  const MESES_NOME = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function ttpostVazio() {
    return {
      custos: [],
      contas: [],
      estoques: [],
      comandos: [],
      eventos: [],
      meta_seguidores: 0,
      meta_notificadas: {},
      ranking_ocultos: [],
      atualizado_em: null,
    };
  }

  function normalizarTtpost(valor) {
    const t = valor && typeof valor === 'object' ? valor : ttpostVazio();
    t.custos = Array.isArray(t.custos) ? t.custos : [];
    t.contas = Array.isArray(t.contas) ? t.contas : [];
    t.estoques = Array.isArray(t.estoques) ? t.estoques : [];
    t.comandos = Array.isArray(t.comandos) ? t.comandos : [];
    t.eventos = Array.isArray(t.eventos) ? t.eventos : [];
    t.meta_seguidores = Number(t.meta_seguidores || 0);
    t.meta_notificadas = t.meta_notificadas && typeof t.meta_notificadas === 'object'
      ? t.meta_notificadas : {};
    // Perfis marcados manualmente como "falharam a postagem" no dia atual.
    t.falhas_postagem = t.falhas_postagem && typeof t.falhas_postagem === 'object'
      ? t.falhas_postagem : { data: null, perfis: [] };
    if (!Array.isArray(t.falhas_postagem.perfis)) t.falhas_postagem.perfis = [];
    // Perfis que o usuário escolheu ocultar do ranking de seguidores.
    t.ranking_ocultos = Array.isArray(t.ranking_ocultos)
      ? [...new Set(t.ranking_ocultos.map(String))] : [];
    t.atualizado_em = t.atualizado_em || null;
    t.custos.forEach(c => {
      if (!TTPOST_CUSTO_BASES.includes(c.base)) c.base = 'mensal_por_conta';
      if (!TTPOST_ESCOPOS.includes(c.escopo)) c.escopo = 'todos';
      c.valor = Number(c.valor || 0);
      c.ativo = c.ativo !== false;
    });
    t.contas.forEach(c => {
      if (!TTPOST_ESCOPOS.slice(1).includes(c.provider)) c.provider = 'adspower';
      c.followers = Number(c.followers || 0);
      c.follower_goal = Number(c.follower_goal || 0);
      c.followers_first = c.followers_first == null ? c.followers : Number(c.followers_first || 0);
      c.warmup_minutes_total = Number(c.warmup_minutes_total || 0);
      c.posts_success = Number(c.posts_success || 0);
      c.posts_failed = Number(c.posts_failed || 0);
      c.videos_used = Number(c.videos_used || 0);
      c.posts_today = Number(c.posts_today || 0);
      c.failures_today = Number(c.failures_today || 0);
      c.warmups_today = Number(c.warmups_today || 0);
      c.active = c.active !== false;
      c.rateios_fechados = c.rateios_fechados && typeof c.rateios_fechados === 'object'
        ? c.rateios_fechados : {};
    });
    t.estoques.forEach(e => {
      e.disponiveis = Number(e.disponiveis || 0);
      e.minimo = Number(e.minimo || 0);
    });
    return t;
  }

  // Congela, uma única vez, o custo de recursos/proxies calculado pela
  // fórmula antiga (custo_total do recurso dividido pelas contas que o
  // usavam). Preserva o lucro já realizado ao aposentar o sistema de
  // Recursos compartilhados em favor dos Custos do mês.
  function migrarCustoRecursosLegado(farmList, recursosList) {
    farmList.forEach(f => {
      if (f.custo_recursos_legado != null) return;
      const recs = Array.isArray(f.recursos) ? f.recursos : [];
      f.custo_recursos_legado = recs.reduce((total, rid) => {
        const r = recursosList.find(x => x.id === rid);
        if (!r) return total;
        const n = farmList.filter(x => (x.recursos || []).includes(rid)).length;
        return total + (n > 0 ? Number(r.custo_total || 0) / n : 0);
      }, 0);
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
        obj.farm_custos_mensais = obj.farm_custos_mensais || [];
        obj.farm_lotes = obj.farm_lotes || [];
        obj.farm_custos_fixos = obj.farm_custos_fixos || [];
        obj.ofertas = obj.ofertas || [];
        obj.ofertas.forEach(o => {
          if (o.investimento_em == null) o.investimento_em = o.criado_em || null;
        });
        obj.ofertas_historico = obj.ofertas_historico || [];
        obj.ofertas_grupos = obj.ofertas_grupos || [];
        obj.emails = obj.emails || [];
        obj.ttpost = normalizarTtpost(obj.ttpost);
        obj.meta_anual = obj.meta_anual != null ? obj.meta_anual : 10000;
        // Migração: custo passa a ser custo_proprio + fatias de recursos
        obj.farm.forEach(f => {
          if (f.custo_proprio == null) f.custo_proprio = Number(f.custo || 0);
          if (!Array.isArray(f.recursos)) f.recursos = [];
          if (f.lote_id === undefined) f.lote_id = null;
          if (f.senha_tiktok == null) f.senha_tiktok = '';
        });
        // Garante que todo lote tenha as chaves esperadas (custo/faturamento)
        obj.farm_lotes.forEach(l => {
          l.custo_total = Number(l.custo_total || 0);
          l.receitas = Array.isArray(l.receitas) ? l.receitas : [];
        });
        migrarCustoRecursosLegado(obj.farm, obj.farm_recursos);
        return obj;
      }
    } catch (e) { /* dados corrompidos: recomeça vazio */ }
    return { contas: [], historico: [], farm: [], farm_historico: [], farm_recursos: [], farm_custos_mensais: [], farm_lotes: [], farm_custos_fixos: [], ofertas: [], ofertas_historico: [], ofertas_grupos: [], emails: [], ttpost: ttpostVazio(), meta_anual: 10000 };
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

  // ---- TTpost: vínculos, ranking, estoque e custos operacionais ----
  function ttpostContaDoFarm(farmId) {
    return data.ttpost.contas.find(c => c.farm_id === farmId) || null;
  }

  function ttpostEscopoCombina(custo, conta) {
    return custo.escopo === 'todos' || custo.escopo === conta.provider;
  }

  function ttpostDiasCobrados(farm, conta, custo) {
    const inicioFarm = new Date(farm.data_inicio || farm.criado_em || now()).getTime();
    const inicioCusto = new Date(custo.criado_em || farm.data_inicio || now()).getTime();
    const inicio = Math.max(inicioFarm, inicioCusto);
    const fim = new Date(conta.desativado_em || farm.data_venda || now()).getTime();
    if (!Number.isFinite(inicio) || !Number.isFinite(fim) || fim < inicio) return 0;
    // Um custo mensal/diário criado e usado no mesmo dia conta como um dia.
    return Math.max(1, (fim - inicio) / 86400000);
  }

  function ttpostDivisorCompartilhado(custo, conta) {
    const fechado = Number((conta.rateios_fechados || {})[custo.id]);
    if (fechado > 0) return fechado;
    const ativas = data.ttpost.contas.filter(c =>
      c.active !== false && ttpostEscopoCombina(custo, c)
    ).length;
    return Math.max(1, ativas);
  }

  function detalharCustoTtpostFarm(farmId) {
    const farm = data.farm.find(f => f.id === farmId);
    const conta = ttpostContaDoFarm(farmId);
    if (!farm || !conta) return { total: 0, itens: [], dias: 0 };
    const itens = [];
    data.ttpost.custos.filter(c => c.ativo !== false && ttpostEscopoCombina(c, conta)).forEach(custo => {
      const valor = Number(custo.valor || 0);
      const dias = ttpostDiasCobrados(farm, conta, custo);
      if (dias <= 0) return;
      let qtd = 0;
      let total = 0;
      if (custo.base === 'mensal_compartilhado') {
        const divisor = ttpostDivisorCompartilhado(custo, conta);
        qtd = dias / 30 / divisor;
        total = valor * qtd;
      } else if (custo.base === 'mensal_por_conta') {
        qtd = dias / 30;
        total = valor * qtd;
      } else if (custo.base === 'por_postagem') {
        qtd = Number(conta.posts_success || 0);
        total = valor * qtd;
      } else if (custo.base === 'por_hora_aquecimento') {
        qtd = Number(conta.warmup_minutes_total || 0) / 60;
        total = valor * qtd;
      } else if (custo.base === 'por_conta_dia') {
        qtd = dias;
        total = valor * qtd;
      } else if (custo.base === 'fixo_por_conta') {
        qtd = 1;
        total = valor;
      }
      itens.push({ ...custo, qtd, total });
    });
    return {
      total: itens.reduce((s, i) => s + i.total, 0),
      itens,
      dias: itens.length ? ttpostDiasCobrados(farm, conta, itens[0]) : 0,
    };
  }

  function custoOperacionalTtpostFarm(farmId) {
    return detalharCustoTtpostFarm(farmId).total;
  }

  // Custo total = aquisição + custo de recursos legado (congelado na
  // migração) + soma dos Custos do mês já fechados que couberam a esta
  // conta. Custos operacionais antigos do TTpost ficam preservados apenas
  // no backup.
  function custoTotalFarm(f) {
    const custosMensais = data.farm_custos_mensais
      .filter(m => m.fechado)
      .flatMap(m => m.splits)
      .filter(s => s.farm_id === f.id)
      .reduce((s, x) => s + Number(x.valor || 0), 0);
    return Number(f.custo_proprio || 0) + Number(f.custo_recursos_legado || 0) + custosMensais;
  }

  // Recalcula o custo (e o lucro das vendidas) de TODAS as contas de farm.
  // Chamado sempre que muda o custo próprio de uma conta ou um mês fecha.
  function recalcularCustosFarm() {
    data.farm.forEach(f => {
      f.custo = custoTotalFarm(f);
      f.lucro = calcLucroFarm(f);
    });
  }

  // ---- Custos do mês do Farm (substitui Recursos compartilhados) ----

  // Reconstrói os intervalos de estágio de uma conta a partir do histórico
  // (todo evento 'Estágio alterado para X' já é gravado com timestamp em
  // alterarStatusFarm/registrarVendaFarm/cancelarVendaFarm). A conta sempre
  // nasce em 'Crescendo' a partir de data_inicio.
  function statusIntervalsFarm(f) {
    const eventos = historicoDoFarm(f.id)
      .filter(h => h.evento.startsWith('Estágio alterado para '));
    // A venda encerra a conta na data_venda informada pelo usuário, que pode
    // ser bem anterior ao registro no app — o histórico é carimbado com a hora
    // em que a venda foi digitada, então sozinho ele esticaria a conta como
    // "Crescendo" até o dia da digitação.
    const fimDeTudo = f.data_venda ? new Date(f.data_venda).getTime() : Date.now();
    let cursor = new Date(f.data_inicio || f.criado_em).getTime();
    let statusAtual = 'Crescendo';
    const intervalos = [];
    eventos.forEach(h => {
      const t = Math.min(new Date(h.criado_em).getTime(), fimDeTudo);
      if (t > cursor) intervalos.push({ status: statusAtual, inicio: cursor, fim: t });
      statusAtual = h.evento.slice('Estágio alterado para '.length);
      cursor = t;
    });
    if (fimDeTudo > cursor) intervalos.push({ status: statusAtual, inicio: cursor, fim: fimDeTudo });
    return intervalos;
  }

  // Dias que uma conta passou em 'Crescendo' dentro de um mês (0-11) —
  // usado como peso para dividir os Custos do mês. Não conta dias futuros:
  // um mês em andamento cresce dia a dia até o fechamento.
  function diasCrescendoNoMes(farmId, ano, mes) {
    const f = getFarm(farmId);
    if (!f) return 0;
    const inicioMes = new Date(ano, mes, 1).getTime();
    const fimMes = new Date(ano, mes + 1, 1).getTime();
    const limiteFim = Math.min(fimMes, Date.now());
    let total = 0;
    statusIntervalsFarm(f).forEach(iv => {
      if (iv.status !== 'Crescendo') return;
      const inicio = Math.max(iv.inicio, inicioMes);
      const fim = Math.min(iv.fim, limiteFim);
      if (fim > inicio) total += (fim - inicio) / 86400000;
    });
    return total;
  }

  function getFarmCustosMes(ano, mes) {
    return data.farm_custos_mensais.find(m => m.ano === ano && m.mes === mes) || null;
  }

  function garantirFarmCustosMes(ano, mes) {
    let m = getFarmCustosMes(ano, mes);
    if (!m) {
      m = { id: uuid(), ano, mes, itens: [], fechado: false, fechado_em: null, splits: [] };
      data.farm_custos_mensais.push(m);
    }
    return m;
  }

  function adicionarFarmCustoMes(ano, mes, { nome, valor }) {
    if (valor == null || valor === '' || isNaN(Number(valor)) || Number(valor) < 0)
      throw new Error('Informe um valor de custo válido.');
    const m = garantirFarmCustosMes(ano, mes);
    if (m.fechado) throw new Error('Este mês já foi fechado.');
    const item = { id: uuid(), nome: String(nome || '').trim(), valor: Number(valor), criado_em: now() };
    m.itens.push(item);
    persist();
    return item;
  }

  function excluirFarmCustoMes(mesId, itemId) {
    const m = data.farm_custos_mensais.find(x => x.id === mesId);
    if (!m) throw new Error('Mês não encontrado.');
    if (m.fechado) throw new Error('Este mês já foi fechado.');
    m.itens = m.itens.filter(i => i.id !== itemId);
    persist();
  }

  // Prévia ao vivo (não grava nada): total lançado e, por conta, quantos
  // dias em Crescendo ela teria neste mês e qual seria sua fatia.
  function previewFechamentoFarmCustosMes(ano, mes) {
    const m = getFarmCustosMes(ano, mes);
    const total = m ? m.itens.reduce((s, i) => s + Number(i.valor || 0), 0) : 0;
    const porConta = data.farm.map(f => ({
      farm_id: f.id, username: f.username, dias: diasCrescendoNoMes(f.id, ano, mes),
    })).filter(x => x.dias > 0);
    const totalDias = porConta.reduce((s, x) => s + x.dias, 0);
    porConta.forEach(x => { x.valor = totalDias > 0 ? total * (x.dias / totalDias) : 0; });
    return { total, totalDias, porConta };
  }

  // Custos do mês já fechados que couberam a uma conta específica, do mais
  // recente para o mais antigo — usado na tela de detalhes da conta.
  function custosMensaisAplicadosFarm(farmId) {
    return data.farm_custos_mensais
      .filter(m => m.fechado)
      .flatMap(m => m.splits.filter(s => s.farm_id === farmId).map(s => ({ ano: m.ano, mes: m.mes, valor: s.valor, dias: s.dias })))
      .sort((a, b) => (b.ano - a.ano) || (b.mes - a.mes));
  }

  function fecharFarmCustosMes(ano, mes) {
    const m = getFarmCustosMes(ano, mes);
    if (!m) throw new Error('Nenhum custo lançado neste mês.');
    if (m.fechado) throw new Error('Este mês já foi fechado.');
    const preview = previewFechamentoFarmCustosMes(ano, mes);
    if (preview.totalDias === 0)
      throw new Error('Nenhuma conta esteve em Crescendo neste mês — não há como dividir o custo lançado.');
    m.splits = preview.porConta.map(x => ({ farm_id: x.farm_id, dias: x.dias, valor: x.valor }));
    m.fechado = true;
    m.fechado_em = now();
    recalcularCustosFarm();
    const rotulo = MESES_NOME[mes] + '/' + ano;
    m.splits.forEach(s => {
      addFarmHistorico(s.farm_id, 'Custo do mês aplicado',
        `${rotulo}: ${fmtBRL(s.valor)} (${s.dias.toFixed(1)} dia(s) em Crescendo).`);
    });
    persist();
    return m;
  }

  // Desfaz um fechamento: apaga o rateio congelado e devolve os lançamentos
  // para edição. Mexe no lucro de contas já vendidas que receberam fatia, por
  // isso a tela confirma antes.
  function reabrirFarmCustosMes(ano, mes) {
    const m = getFarmCustosMes(ano, mes);
    if (!m) throw new Error('Mês não encontrado.');
    if (!m.fechado) throw new Error('Este mês não está fechado.');
    const rotulo = MESES_NOME[mes] + '/' + ano;
    m.splits.filter(s => getFarm(s.farm_id)).forEach(s => {
      addFarmHistorico(s.farm_id, 'Custo do mês estornado',
        `${rotulo}: ${fmtBRL(s.valor)} devolvido ao reabrir o mês.`);
    });
    m.splits = [];
    m.fechado = false;
    m.fechado_em = null;
    recalcularCustosFarm();
    persist();
    return m;
  }

  // Zera aquisição e legado das contas em Crescendo — virada de chave para o
  // modelo de Custos do mês. Vendidas e demais estágios ficam intactos para
  // não mexer no lucro já realizado.
  function zerarCustosFarmCrescendo() {
    const alvo = data.farm.filter(f => f.status === 'Crescendo' &&
      (Number(f.custo_proprio || 0) > 0 || Number(f.custo_recursos_legado || 0) > 0));
    alvo.forEach(f => {
      const anterior = Number(f.custo_proprio || 0) + Number(f.custo_recursos_legado || 0);
      f.custo_proprio = 0;
      f.custo_recursos_legado = 0;
      f.atualizado_em = now();
      addFarmHistorico(f.id, 'Custos zerados',
        `Custo anterior de ${fmtBRL(anterior)} zerado na virada para Custos do mês.`);
    });
    recalcularCustosFarm();
    persist();
    return alvo.length;
  }

  function listarCustosTtpost() {
    return [...data.ttpost.custos].sort((a, b) =>
      String(a.criado_em || '').localeCompare(String(b.criado_em || ''))
    );
  }

  function salvarCustoTtpost(campos) {
    const nome = String(campos.nome || '').trim();
    const valor = Number(campos.valor);
    const base = String(campos.base || 'mensal_por_conta');
    const escopo = String(campos.escopo || 'todos');
    if (!nome) throw new Error('Dê um nome ao custo.');
    if (campos.valor === '' || !Number.isFinite(valor) || valor < 0)
      throw new Error('Informe um valor válido.');
    if (!TTPOST_CUSTO_BASES.includes(base)) throw new Error('Base de cálculo inválida.');
    if (!TTPOST_ESCOPOS.includes(escopo)) throw new Error('Aplicação inválida.');
    let custo = campos.id ? data.ttpost.custos.find(c => c.id === campos.id) : null;
    if (campos.id && !custo) throw new Error('Custo não encontrado.');
    if (!custo) {
      custo = { id: uuid(), criado_em: now() };
      data.ttpost.custos.push(custo);
    }
    Object.assign(custo, { nome, valor, base, escopo, ativo: campos.ativo !== false, atualizado_em: now() });
    data.ttpost.atualizado_em = now();
    recalcularCustosFarm();
    persist();
    return custo;
  }

  function excluirCustoTtpost(id) {
    data.ttpost.custos = data.ttpost.custos.filter(c => c.id !== id);
    data.ttpost.contas.forEach(c => { delete c.rateios_fechados[id]; });
    data.ttpost.atualizado_em = now();
    recalcularCustosFarm();
    persist();
  }

  function registrarRateiosFechados(conta) {
    data.ttpost.custos
      .filter(c => c.ativo !== false && c.base === 'mensal_compartilhado' && ttpostEscopoCombina(c, conta))
      .forEach(c => { conta.rateios_fechados[c.id] = ttpostDivisorCompartilhado(c, conta); });
  }

  function enfileirarComandoTtpost(tipo, conta, motivo) {
    data.ttpost.comandos.push({
      id: uuid(), tipo, conta_id: conta.id, farm_id: conta.farm_id,
      provider: conta.provider, profile_id: conta.profile_id || '',
      device_serial: conta.device_serial || '', motivo: motivo || '',
      status: 'pendente', criado_em: now(),
    });
  }

  function desativarContaTtpostPorFarm(farmId, motivo, encerradoEm) {
    const conta = ttpostContaDoFarm(farmId);
    if (!conta || conta.active === false) return null;
    registrarRateiosFechados(conta);
    conta.active = false;
    conta.desativado_em = encerradoEm || now();
    conta.atualizado_em = now();
    enfileirarComandoTtpost('desativar_conta', conta, motivo || 'Conta vendida no Farm');
    return conta;
  }

  function listarContasTtpost() {
    return data.ttpost.contas.map(c => ({ ...c }));
  }

  function salvarContaTtpost(campos) {
    const farmId = String(campos.farm_id || '');
    const farm = data.farm.find(f => f.id === farmId);
    if (!farm) throw new Error('Escolha uma conta do Farm.');
    const repetida = data.ttpost.contas.find(c => c.farm_id === farmId && c.id !== campos.id);
    if (repetida) throw new Error('Esta conta do Farm já está vinculada ao TTpost.');
    const provider = String(campos.provider || 'adspower');
    if (!TTPOST_ESCOPOS.slice(1).includes(provider)) throw new Error('Multilogin inválido.');
    const numero = (v, nome) => {
      const n = v === '' || v == null ? 0 : Number(v);
      if (!Number.isFinite(n) || n < 0) throw new Error(`${nome} deve ser zero ou maior.`);
      return n;
    };
    let conta = campos.id ? data.ttpost.contas.find(c => c.id === campos.id) : null;
    if (campos.id && !conta) throw new Error('Vínculo não encontrado.');
    const seguidores = numero(campos.followers, 'Seguidores');
    if (!conta) {
      conta = {
        id: uuid(), criado_em: now(), active: true, desativado_em: null,
        followers_first: seguidores, followers_first_at: now(), rateios_fechados: {},
      };
      data.ttpost.contas.push(conta);
    }
    const ativo = campos.active !== false;
    if (conta.active !== false && !ativo) {
      registrarRateiosFechados(conta);
      conta.desativado_em = now();
    } else if (conta.active === false && ativo) {
      conta.desativado_em = null;
      conta.rateios_fechados = {};
    }
    Object.assign(conta, {
      farm_id: farmId,
      nome_perfil: String(campos.nome_perfil || farm.username).trim(),
      provider,
      profile_id: String(campos.profile_id || '').trim(),
      device_serial: String(campos.device_serial || '').trim(),
      followers: seguidores,
      follower_goal: numero(campos.follower_goal, 'Meta de seguidores'),
      warmup_minutes_total: numero(campos.warmup_minutes_total, 'Minutos de aquecimento'),
      posts_success: numero(campos.posts_success, 'Postagens'),
      posts_failed: numero(campos.posts_failed, 'Falhas'),
      videos_used: numero(campos.videos_used, 'Vídeos usados'),
      posts_today: numero(campos.posts_today, 'Postagens de hoje'),
      failures_today: numero(campos.failures_today, 'Falhas de hoje'),
      warmups_today: numero(campos.warmups_today, 'Aquecimentos de hoje'),
      active: ativo,
      followers_updated_at: now(),
      atualizado_em: now(),
    });
    data.ttpost.atualizado_em = now();
    recalcularCustosFarm();
    persist();
    return conta;
  }

  function excluirContaTtpost(id) {
    const conta = data.ttpost.contas.find(c => c.id === id);
    if (!conta) return;
    if (conta.active !== false) enfileirarComandoTtpost('desativar_conta', conta, 'Vínculo removido no Gestão Op');
    data.ttpost.contas = data.ttpost.contas.filter(c => c.id !== id);
    data.ttpost.atualizado_em = now();
    recalcularCustosFarm();
    persist();
  }

  function mediaSeguidoresTtpost(conta) {
    const inicio = new Date(conta.followers_first_at || conta.criado_em || now()).getTime();
    const fim = new Date(conta.followers_updated_at || now()).getTime();
    const dias = (fim - inicio) / 86400000;
    if (!Number.isFinite(dias) || dias < 1) return null;
    return (Number(conta.followers || 0) - Number(conta.followers_first || 0)) / dias;
  }

  function rankingTtpost() {
    return data.ttpost.contas.map(c => {
      const farm = data.farm.find(f => f.id === c.farm_id) || null;
      return { ...c, farm, media_dia: mediaSeguidoresTtpost(c), custo_operacional: custoOperacionalTtpostFarm(c.farm_id) };
    }).sort((a, b) => Number(b.followers || 0) - Number(a.followers || 0));
  }

  // Meta única de seguidores, compartilhada por todas as contas do TTpost.
  function getMetaSeguidoresTtpost() {
    return Number(data.ttpost.meta_seguidores || 0);
  }

  function setMetaSeguidoresTtpost(valor) {
    const meta = valor == null || valor === '' ? 0 : Number(valor);
    if (!Number.isFinite(meta) || meta < 0) throw new Error('Informe uma meta válida.');
    if (meta !== getMetaSeguidoresTtpost()) data.ttpost.meta_notificadas = {};
    data.ttpost.meta_seguidores = meta;
    data.ttpost.atualizado_em = now();
    persist();
    return meta;
  }

  function metaTtpostJaNotificada(contaId) {
    return Boolean(data.ttpost.meta_notificadas[String(contaId || '')]);
  }

  function marcarMetaTtpostNotificada(contaId) {
    const id = String(contaId || '');
    if (!id) return;
    data.ttpost.meta_notificadas[id] = now();
    persist();
  }

  // Perfis marcados manualmente como falha de postagem — só valem para o dia
  // corrente; ao virar o dia a marcação some sozinha.
  function hojeLocalStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  }

  function getFalhasPostagemHoje() {
    const fp = data.ttpost.falhas_postagem;
    if (!fp || fp.data !== hojeLocalStr()) return [];
    return Array.isArray(fp.perfis) ? fp.perfis.slice() : [];
  }

  function definirFalhasPostagemHoje(perfis) {
    data.ttpost.falhas_postagem = {
      data: hojeLocalStr(),
      perfis: Array.isArray(perfis) ? [...new Set(perfis.map(String))] : [],
    };
    persist();
    return data.ttpost.falhas_postagem.perfis.slice();
  }

  // Perfis que o usuário optou por ocultar do ranking de seguidores.
  // A marcação é permanente (diferente das falhas, que zeram no dia seguinte).
  function getRankingOcultosTtpost() {
    return Array.isArray(data.ttpost.ranking_ocultos)
      ? data.ttpost.ranking_ocultos.slice() : [];
  }

  function definirRankingOcultosTtpost(perfis) {
    data.ttpost.ranking_ocultos = Array.isArray(perfis)
      ? [...new Set(perfis.map(String).filter(Boolean))] : [];
    data.ttpost.atualizado_em = now();
    persist();
    return data.ttpost.ranking_ocultos.slice();
  }

  function listarEstoquesTtpost() {
    return [...data.ttpost.estoques].sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  }

  function salvarEstoqueTtpost(campos) {
    const nome = String(campos.nome || '').trim();
    if (!nome) throw new Error('Dê um nome ao estoque.');
    const disponiveis = Number(campos.disponiveis);
    const minimo = Number(campos.minimo || 0);
    if (!Number.isFinite(disponiveis) || disponiveis < 0 || !Number.isFinite(minimo) || minimo < 0)
      throw new Error('Informe quantidades válidas.');
    let item = campos.id ? data.ttpost.estoques.find(e => e.id === campos.id) : null;
    if (campos.id && !item) throw new Error('Estoque não encontrado.');
    if (!item) {
      item = { id: uuid(), criado_em: now() };
      data.ttpost.estoques.push(item);
    }
    Object.assign(item, {
      nome, pasta: String(campos.pasta || '').trim(), disponiveis, minimo,
      atualizado_em: now(),
    });
    data.ttpost.atualizado_em = now();
    persist();
    return item;
  }

  function excluirEstoqueTtpost(id) {
    data.ttpost.estoques = data.ttpost.estoques.filter(e => e.id !== id);
    data.ttpost.atualizado_em = now();
    persist();
  }

  function resumoTtpost() {
    const contas = data.ttpost.contas;
    const estoques = data.ttpost.estoques;
    return {
      contas: contas.length,
      ativas: contas.filter(c => c.active !== false).length,
      postsHoje: contas.reduce((s, c) => s + Number(c.posts_today || 0), 0),
      falhasHoje: contas.reduce((s, c) => s + Number(c.failures_today || 0), 0),
      aquecimentosHoje: contas.reduce((s, c) => s + Number(c.warmups_today || 0), 0),
      seguidores: contas.reduce((s, c) => s + Number(c.followers || 0), 0),
      videos: estoques.reduce((s, e) => s + Number(e.disponiveis || 0), 0),
      estoquesBaixos: estoques.filter(e => Number(e.disponiveis || 0) <= Number(e.minimo || 0)).length,
      custoOperacional: data.farm.reduce((s, f) => s + custoOperacionalTtpostFarm(f.id), 0),
      comandosPendentes: data.ttpost.comandos.filter(c => c.status === 'pendente').length,
      atualizado_em: data.ttpost.atualizado_em,
    };
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

  function criarFarm({ username, plataforma, email, senha, senha_tiktok, custo_proprio, custo, status, observacoes, data_inicio, recursos, email_reserva_id, lote_id }) {
    username = String(username || '').trim();
    plataforma = String(plataforma || '').trim();
    if (!username) throw new Error('Username é obrigatório.');
    // custo_proprio (aquisição da conta); aceita 'custo' como alias legado
    const proprio = custo_proprio != null ? custo_proprio : custo;
    if (proprio !== '' && proprio != null && isNaN(Number(proprio)))
      throw new Error('Custo inválido.');
    if (farmUsernameExiste(username)) throw new Error('Já existe uma conta em farm com esse username.');

    let emailReserva = null;
    if (email_reserva_id) {
      emailReserva = data.emails.find(e => e.id === email_reserva_id);
      if (!emailReserva) throw new Error('O email selecionado não existe mais na reserva.');
      if (emailReserva.status !== 'Disponível') throw new Error('O email selecionado já foi usado. Escolha outro.');
      email = emailReserva.email;
      senha = emailReserva.senha;
    }

    // Vínculo opcional a um lote existente
    let loteVinculado = null;
    if (lote_id) {
      loteVinculado = data.farm_lotes.find(l => l.id === lote_id);
      if (!loteVinculado) throw new Error('O lote selecionado não existe mais.');
    }

    const f = {
      id: uuid(),
      username,
      plataforma,
      email: String(email || '').trim(),
      senha: String(senha || ''),
      senha_tiktok: String(senha_tiktok || ''),
      lote_id: loteVinculado ? loteVinculado.id : null,
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
    if (emailReserva) {
      emailReserva.status = 'Usado';
      emailReserva.usado_em = now();
    }
    recalcularCustosFarm(); // define f.custo e redivide recursos entre as contas
    addFarmHistorico(f.id, 'Conta criada', `Conta @${f.username} adicionada ao farm.`);
    if (loteVinculado) {
      addFarmHistorico(f.id, 'Vinculada a lote', `Conta adicionada ao ${loteVinculado.nome}.`);
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
    ['plataforma', 'email', 'senha', 'senha_tiktok', 'observacoes'].forEach(k => {
      if (campos[k] != null) {
        const v = String(campos[k]).trim();
        if (v !== (f[k] || '')) { f[k] = v; mudou = true; }
      }
    });
    // Vínculo a lote (aceita '' / null para desvincular)
    if (campos.lote_id !== undefined) {
      const novoLote = campos.lote_id || null;
      if (novoLote && !data.farm_lotes.find(l => l.id === novoLote))
        throw new Error('O lote selecionado não existe mais.');
      if (novoLote !== (f.lote_id || null)) {
        f.lote_id = novoLote;
        mudou = true;
        const l = novoLote ? data.farm_lotes.find(x => x.id === novoLote) : null;
        addFarmHistorico(id, 'Lote alterado', l ? `Vinculada ao ${l.nome}.` : 'Desvinculada do lote.');
      }
    }
    // Custo próprio (aquisição). Aceita 'custo' como alias legado. Vazio = 0.
    if (campos.custo_proprio != null || campos.custo != null) {
      const raw = campos.custo_proprio != null ? campos.custo_proprio : campos.custo;
      const val = (raw === '' || raw == null) ? 0 : Number(raw);
      if (!isNaN(val) && val >= 0 && val !== Number(f.custo_proprio || 0)) {
        f.custo_proprio = val; mudou = true;
      }
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

  // Marca a conta como vendida. O dinheiro (faturamento/lucro) vive nos lotes,
  // então aqui só registramos status Vendida + data. preco_venda continua
  // aceito como opcional para retrocompatibilidade (backups e testes antigos).
  function registrarVendaFarm(id, { preco_venda, data_venda, observacoes } = {}) {
    const f = getFarm(id);
    if (!f) throw new Error('Conta não encontrada.');
    if (f.status === 'Vendida') throw new Error('Esta conta já foi vendida.');
    if (preco_venda != null && preco_venda !== '' && !isNaN(Number(preco_venda))) {
      f.preco_venda = Number(preco_venda);
    }
    f.data_venda = data_venda || now();
    f.atualizado_em = now();
    const anterior = f.status;
    f.status = 'Vendida';
    if (anterior !== 'Vendida') {
      addFarmHistorico(id, 'Estágio alterado para Vendida', `De ${anterior} para Vendida.`);
    }
    // A venda encerra os custos recorrentes e cria o comando que a ponte do
    // TTpost consumirá para retirar a conta de presets/aquecimentos futuros.
    desativarContaTtpostPorFarm(id, 'Conta vendida no Farm', f.data_venda);
    recalcularCustosFarm();
    let desc = f.preco_venda != null
      ? `Venda de ${fmtBRL(f.preco_venda)}.`
      : `Conta marcada como vendida em ${fmtData(f.data_venda)}.`;
    if (observacoes && observacoes.trim()) desc += ` Obs.: ${observacoes.trim()}`;
    addFarmHistorico(id, 'Venda registrada', desc);
    persist();
    return f;
  }

  // Desfaz a venda de uma conta em farm: zera financeiro e volta o estágio ao padrão
  function cancelarVendaFarm(id) {
    const f = getFarm(id);
    if (!f) throw new Error('Conta não encontrada.');
    if (f.status !== 'Vendida') throw new Error('Esta conta não está vendida.');
    const statusAnterior = f.status;
    f.preco_venda = null;
    f.data_venda = null;
    f.lucro = 0;
    f.status = 'Crescendo';
    f.atualizado_em = now();
    addFarmHistorico(id, 'Venda cancelada', 'A conta voltou para Crescendo.');
    if (statusAnterior !== 'Crescendo') {
      addFarmHistorico(id, 'Estágio alterado para Crescendo', `De ${statusAnterior} para Crescendo.`);
    }
    // Não reativa o TTpost automaticamente: a conta pode já ter sido entregue.
    recalcularCustosFarm();
    persist();
    return f;
  }

  function excluirFarm(id) {
    const contaTtpost = ttpostContaDoFarm(id);
    if (contaTtpost && contaTtpost.active !== false) {
      enfileirarComandoTtpost('desativar_conta', contaTtpost, 'Conta excluída do Farm');
    }
    data.ttpost.contas = data.ttpost.contas.filter(c => c.farm_id !== id);
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

  // Total mensal dos custos fixos da operação (recorrentes, valem todo mês).
  function totalFarmCustosFixosMensal() {
    return data.farm_custos_fixos.reduce((s, c) => s + Number(c.valor || 0), 0);
  }

  // Custos fixos aplicáveis a UM mês: cada custo vale do mês em que foi criado
  // até o mês corrente (não retroage antes da criação nem cobra o futuro).
  function custosFixosDoMes(ano, mes) {
    const agora = new Date();
    const alvo = new Date(ano, mes, 1).getTime();
    const inicioMesAtual = new Date(agora.getFullYear(), agora.getMonth(), 1).getTime();
    if (alvo > inicioMesAtual) return 0;
    return data.farm_custos_fixos.reduce((s, c) => {
      const cri = new Date(c.criado_em || 0);
      const inicioCri = new Date(cri.getFullYear(), cri.getMonth(), 1).getTime();
      return s + (alvo >= inicioCri ? Number(c.valor || 0) : 0);
    }, 0);
  }

  // Soma dos custos fixos aplicáveis a todos os meses cobertos por um período.
  // 'hoje' não cobra overhead mensal (é uma janela de um dia); 'tudo' começa no
  // mês do custo fixo mais antigo. Usado para o dashboard geral bater com a
  // tela do Farm.
  function custosFixosNoPeriodo(periodo) {
    if (periodo === 'hoje' || !data.farm_custos_fixos.length) return 0;
    const agora = new Date();
    const fimAno = agora.getFullYear(), fimMes = agora.getMonth();
    const desde = inicioPeriodo(periodo);
    let ano, mes;
    if (desde) { ano = desde.getFullYear(); mes = desde.getMonth(); }
    else {
      const maisAntigo = data.farm_custos_fixos.reduce((min, c) => {
        const t = new Date(c.criado_em || 0).getTime();
        return t < min ? t : min;
      }, Infinity);
      const d = new Date(Number.isFinite(maisAntigo) ? maisAntigo : agora.getTime());
      ano = d.getFullYear(); mes = d.getMonth();
    }
    let total = 0;
    while (ano < fimAno || (ano === fimAno && mes <= fimMes)) {
      total += custosFixosDoMes(ano, mes);
      mes++; if (mes > 11) { mes = 0; ano++; }
    }
    return total;
  }

  // Financeiro do Farm calculado POR MÊS (mês corrente por padrão) — zera
  // sozinho ao virar o mês, porque tudo é filtrado por new Date().
  //   receita  = faturamentos dos lotes lançados no mês
  //   custo    = custo dos lotes CRIADOS no mês + custos fixos mensais
  //   lucro    = receita − custo
  // Contadores operacionais (em farm agora, por estágio) são do estado atual;
  // "vendidas" é quantas foram marcadas como vendidas dentro do mês.
  function indicadoresFarm(ano, mes) {
    const agora = new Date();
    if (!Number.isInteger(ano)) ano = agora.getFullYear();
    if (!Number.isInteger(mes)) mes = agora.getMonth();
    const inicioMes = new Date(ano, mes, 1).getTime();
    const fimMes = new Date(ano, mes + 1, 1).getTime();
    const noMes = iso => {
      if (!iso) return false;
      const t = new Date(iso).getTime();
      return t >= inicioMes && t < fimMes;
    };

    const receita = data.farm_lotes.reduce((s, l) =>
      s + l.receitas.filter(r => noMes(r.data)).reduce((t, r) => t + Number(r.valor || 0), 0), 0);
    const custoLotes = data.farm_lotes
      .filter(l => noMes(l.criado_em))
      .reduce((s, l) => s + Number(l.custo_total || 0), 0);
    const custosFixos = custosFixosDoMes(ano, mes);
    const investido = custoLotes + custosFixos;
    const lucro = receita - investido;

    const farm = data.farm;
    const ativas = farm.filter(f => f.status !== 'Vendida');
    const vendidasMes = farm.filter(f => f.status === 'Vendida' && noMes(f.data_venda));

    const porEstagio = {};
    FARM_STATUS.forEach(s => { porEstagio[s] = 0; });
    farm.forEach(f => { if (porEstagio[f.status] != null) porEstagio[f.status]++; });

    return {
      ano, mes,
      total: farm.length,
      ativas: ativas.length,
      vendidas: vendidasMes.length,
      vendidasTotal: farm.filter(f => f.status === 'Vendida').length,
      lotes: data.farm_lotes.length,
      receita,
      custoLotes,
      custosFixos,
      investido,
      lucro,
      porEstagio,
    };
  }

  // ============================================================
  //   LOTES DO FARM — custo total e faturamento por lote
  //   lote = { id, nome, custo_total, receitas:[{id,valor,data,descricao}] }
  //   lucro do lote = soma dos faturamentos − custo total.
  // ============================================================
  function listarFarmLotes() {
    return [...data.farm_lotes].sort((a, b) =>
      String(b.criado_em || '').localeCompare(String(a.criado_em || '')));
  }

  function getFarmLote(id) {
    return data.farm_lotes.find(l => l.id === id) || null;
  }

  function contasDoLote(loteId) {
    return data.farm
      .filter(f => f.lote_id === loteId)
      .sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
  }

  // Números do lote: custo, faturamento e lucro/prejuízo.
  function resumoLote(lote) {
    const l = typeof lote === 'string' ? getFarmLote(lote) : lote;
    if (!l) return { custo: 0, receita: 0, lucro: 0, contas: 0 };
    const receita = l.receitas.reduce((s, r) => s + Number(r.valor || 0), 0);
    const custo = Number(l.custo_total || 0);
    return { custo, receita, lucro: receita - custo, contas: contasDoLote(l.id).length };
  }

  function criarFarmLote({ nome } = {}) {
    const lote = {
      id: uuid(),
      nome: String(nome || '').trim() || `Lote ${data.farm_lotes.length + 1}`,
      custo_total: 0,
      receitas: [],
      criado_em: now(),
    };
    data.farm_lotes.push(lote);
    persist();
    return lote;
  }

  function renomearFarmLote(id, nome) {
    const l = getFarmLote(id);
    if (!l) throw new Error('Lote não encontrado.');
    const n = String(nome || '').trim();
    if (!n) throw new Error('Dê um nome ao lote.');
    l.nome = n;
    persist();
    return l;
  }

  function definirCustoLote(id, custo) {
    const l = getFarmLote(id);
    if (!l) throw new Error('Lote não encontrado.');
    const v = (custo === '' || custo == null) ? 0 : Number(custo);
    if (isNaN(v) || v < 0) throw new Error('Informe um custo válido.');
    l.custo_total = v;
    persist();
    return l;
  }

  function adicionarReceitaLote(id, { valor, data: dataReceita, descricao } = {}) {
    const l = getFarmLote(id);
    if (!l) throw new Error('Lote não encontrado.');
    if (valor == null || valor === '' || isNaN(Number(valor)) || Number(valor) < 0)
      throw new Error('Informe um valor de faturamento válido.');
    const r = {
      id: uuid(),
      valor: Number(valor),
      data: dataReceita || now(),
      descricao: String(descricao || '').trim(),
    };
    l.receitas.push(r);
    persist();
    return r;
  }

  function excluirReceitaLote(loteId, receitaId) {
    const l = getFarmLote(loteId);
    if (!l) throw new Error('Lote não encontrado.');
    l.receitas = l.receitas.filter(r => r.id !== receitaId);
    persist();
  }

  // Ao excluir o lote, as contas apenas ficam sem lote (não são apagadas).
  function excluirFarmLote(id) {
    data.farm.forEach(f => { if (f.lote_id === id) f.lote_id = null; });
    data.farm_lotes = data.farm_lotes.filter(l => l.id !== id);
    persist();
  }

  // ---- Custos fixos da operação (recorrentes, entram todo mês) ----
  function listarFarmCustosFixos() {
    return [...data.farm_custos_fixos].sort((a, b) =>
      String(a.criado_em || '').localeCompare(String(b.criado_em || '')));
  }

  function adicionarFarmCustoFixo({ nome, valor } = {}) {
    if (valor == null || valor === '' || isNaN(Number(valor)) || Number(valor) < 0)
      throw new Error('Informe um valor de custo válido.');
    const item = { id: uuid(), nome: String(nome || '').trim(), valor: Number(valor), criado_em: now() };
    data.farm_custos_fixos.push(item);
    persist();
    return item;
  }

  function atualizarFarmCustoFixo(id, { nome, valor } = {}) {
    const c = data.farm_custos_fixos.find(x => x.id === id);
    if (!c) throw new Error('Custo fixo não encontrado.');
    if (nome != null) c.nome = String(nome).trim();
    if (valor != null && valor !== '') {
      if (isNaN(Number(valor)) || Number(valor) < 0) throw new Error('Informe um valor válido.');
      c.valor = Number(valor);
    }
    persist();
    return c;
  }

  function excluirFarmCustoFixo(id) {
    data.farm_custos_fixos = data.farm_custos_fixos.filter(c => c.id !== id);
    persist();
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
      o = { id: uuid(), grupo_id: grupoId, ano, mes, investimento: 0, investimento_em: null, receitas: [], criado_em: now(), atualizado_em: now() };
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
    o.investimento_em = now();
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
  //   Cada resumo aceita um período: 'hoje' | 'mes' | '6meses' | 'tudo'.
  //   Toda nova operação só precisa expor um resumo neste formato.
  // ============================================================
  function roiDe(receita, investimento) {
    return investimento > 0 ? ((receita - investimento) / investimento) * 100 : 0;
  }

  // Data inicial do período (null = tudo). Filtra pela data de realização.
  function inicioPeriodo(periodo) {
    const agora = new Date();
    if (periodo === 'hoje') return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    if (periodo === 'mes') return new Date(agora.getFullYear(), agora.getMonth(), 1);
    if (periodo === '6meses') return new Date(agora.getFullYear(), agora.getMonth() - 5, 1);
    if (periodo === 'ano') return new Date(agora.getFullYear(), 0, 1);
    return null; // 'tudo'
  }

  // ---- Meta anual (barra de progresso) ----
  function getMetaAnual() {
    return Number(data.meta_anual || 0);
  }

  function setMetaAnual(valor) {
    const v = valor == null || valor === '' ? 0 : Number(valor);
    if (isNaN(v) || v < 0) throw new Error('Informe uma meta válida.');
    data.meta_anual = v;
    persist();
    return v;
  }

  // ============================================================
  //   EMAILS — reserva de emails comprados (email:senha)
  // ============================================================
  // Cola em massa; cada item vira { email, senha, status: Disponível/Usado }.
  // Divisor entre email e senha é o primeiro ":". Ignora duplicados (por email).
  function adicionarEmails(texto) {
    const tokens = String(texto || '').split(/\s+/).map(t => t.trim()).filter(Boolean);
    let adicionados = 0, duplicados = 0, invalidos = 0;
    tokens.forEach(t => {
      const idx = t.indexOf(':');
      if (idx < 1) { invalidos++; return; }
      const email = t.slice(0, idx).trim();
      const senha = t.slice(idx + 1).trim();
      if (!email || !email.includes('@')) { invalidos++; return; }
      if (data.emails.some(e => e.email.toLowerCase() === email.toLowerCase())) { duplicados++; return; }
      data.emails.push({ id: uuid(), email, senha, status: 'Disponível', criado_em: now(), usado_em: null });
      adicionados++;
    });
    persist();
    return { adicionados, duplicados, invalidos };
  }

  function listarEmails(status) {
    let lista = [...data.emails];
    if (status === 'Disponível' || status === 'Usado') {
      lista = lista.filter(e => e.status === status);
    }
    // Disponíveis primeiro; dentro de cada grupo, mais recentes primeiro
    lista.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'Disponível' ? -1 : 1;
      return b.criado_em.localeCompare(a.criado_em);
    });
    return lista;
  }

  function alternarEmail(id) {
    const e = data.emails.find(x => x.id === id);
    if (!e) return null;
    if (e.status === 'Usado') { e.status = 'Disponível'; e.usado_em = null; }
    else { e.status = 'Usado'; e.usado_em = now(); }
    persist();
    return e;
  }

  function excluirEmail(id) {
    data.emails = data.emails.filter(e => e.id !== id);
    persist();
  }

  function contarEmails() {
    const usados = data.emails.filter(e => e.status === 'Usado').length;
    return { total: data.emails.length, usados, disponiveis: data.emails.length - usados };
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

  // Financeiro por lote: custo do lote entra no período pela sua data de
  // criação; cada faturamento entra pela sua própria data.
  function resumoFarm(periodo) {
    const desde = inicioPeriodo(periodo);
    const noRange = iso => !desde || (iso && new Date(iso) >= desde);
    let receita = 0, investimento = 0;
    data.farm_lotes.forEach(l => {
      if (noRange(l.criado_em)) investimento += Number(l.custo_total || 0);
      l.receitas.forEach(r => { if (noRange(r.data)) receita += Number(r.valor || 0); });
    });
    // Custos fixos recorrentes entram por mês coberto no período (igual à tela
    // do Farm), para o dashboard geral refletir o prejuízo real.
    investimento += custosFixosNoPeriodo(periodo);
    const emFarmLista = data.farm.filter(f => f.status !== 'Vendida');
    const vendidas = data.farm.filter(f => f.status === 'Vendida' && noRange(f.data_venda));
    return {
      id: 'farm', nome: 'Farm', rota: '#/farm',
      receita, investimento, lucro: receita - investimento, roi: roiDe(receita, investimento),
      ativas: emFarmLista.length, concluidas: vendidas.length,
      extra: { emFarm: emFarmLista.length, lotes: data.farm_lotes.length, vendidas: vendidas.length },
    };
  }

  // Resumo COMBINADO de todos os nichos (usado no card do dashboard)
  function resumoOfertas(periodo) {
    const desde = inicioPeriodo(periodo);
    const hoje = periodo === 'hoje';
    const noRange = iso => !desde || (iso && new Date(iso) >= desde);
    const mesNoRange = (ano, mes) => !desde || new Date(ano, mes, 1) >= desde;
    const meses = data.ofertas.filter(o => hoje || mesNoRange(o.ano, o.mes));
    const investimento = meses.reduce((s, o) => s + (hoje
      ? (noRange(o.investimento_em) ? Number(o.investimento || 0) : 0)
      : Number(o.investimento || 0)), 0);
    const receita = meses.reduce((s, o) => s + (hoje
      ? o.receitas.filter(r => noRange(r.data)).reduce((t, r) => t + Number(r.valor || 0), 0)
      : totalReceitasMes(o)), 0);
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
    const hoje = periodo === 'hoje';
    const noRange = iso => !desde || (iso && new Date(iso) >= desde);
    const mesNoRange = (ano, mes) => !desde || new Date(ano, mes, 1) >= desde;
    const meses = data.ofertas.filter(o => o.grupo_id === grupoId && (hoje || mesNoRange(o.ano, o.mes)));
    const investimento = meses.reduce((s, o) => s + (hoje
      ? (noRange(o.investimento_em) ? Number(o.investimento || 0) : 0)
      : Number(o.investimento || 0)), 0);
    const receita = meses.reduce((s, o) => s + (hoje
      ? o.receitas.filter(r => noRange(r.data)).reduce((t, r) => t + Number(r.valor || 0), 0)
      : totalReceitasMes(o)), 0);
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
  // periodo: 'hoje' | 'mes' | '6meses' | 'tudo'
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
    // Farm por lotes: custo lançado no mês de criação do lote; faturamentos no
    // mês de cada lançamento.
    data.farm_lotes.forEach(l => {
      const dc = new Date(l.criado_em);
      const bc = bucket(dc.getFullYear(), dc.getMonth());
      if (bc) bc.farm -= Number(l.custo_total || 0);
      l.receitas.forEach(r => {
        const d = new Date(r.data);
        const b = bucket(d.getFullYear(), d.getMonth());
        if (b) b.farm += Number(r.valor || 0);
      });
    });
    // Custos fixos recorrentes descontam de cada mês do gráfico.
    meses.forEach(m => { m.farm -= custosFixosDoMes(m.ano, m.mes); });
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
      versao: 12,
      exportado_em: now(),
      meta_anual: data.meta_anual,
      emails: data.emails,
      contas: data.contas,
      historico: data.historico,
      farm: data.farm,
      farm_historico: data.farm_historico,
      farm_recursos: data.farm_recursos,
      farm_custos_mensais: data.farm_custos_mensais,
      farm_lotes: data.farm_lotes,
      farm_custos_fixos: data.farm_custos_fixos,
      ofertas: data.ofertas,
      ofertas_historico: data.ofertas_historico,
      ofertas_grupos: data.ofertas_grupos,
      ttpost: data.ttpost,
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
    const farmCustosMensais = Array.isArray(obj.farm_custos_mensais) ? obj.farm_custos_mensais : [];
    const farmLotes = Array.isArray(obj.farm_lotes) ? obj.farm_lotes : [];
    farmLotes.forEach(l => {
      l.custo_total = Number(l.custo_total || 0);
      l.receitas = Array.isArray(l.receitas) ? l.receitas : [];
    });
    const farmCustosFixos = Array.isArray(obj.farm_custos_fixos) ? obj.farm_custos_fixos : [];
    if (farm.some(f => !f.id || !f.username))
      throw new Error('Backup corrompido: farm sem id/username.');
    const ofertas = Array.isArray(obj.ofertas) ? obj.ofertas : [];
    ofertas.forEach(o => {
      if (o.investimento_em == null) o.investimento_em = o.criado_em || null;
    });
    const ofertasHist = Array.isArray(obj.ofertas_historico) ? obj.ofertas_historico : [];
    const ofertasGrupos = Array.isArray(obj.ofertas_grupos) ? obj.ofertas_grupos : [];
    const ttpost = normalizarTtpost(obj.ttpost);
    if (ofertas.some(o => !o.id || !Array.isArray(o.receitas)))
      throw new Error('Backup corrompido: ofertas em formato inválido.');
    // Migração dos itens de farm (custo_proprio/recursos)
    farm.forEach(f => {
      if (f.custo_proprio == null) f.custo_proprio = Number(f.custo || 0);
      if (!Array.isArray(f.recursos)) f.recursos = [];
      if (f.lote_id === undefined) f.lote_id = null;
      if (f.senha_tiktok == null) f.senha_tiktok = '';
    });
    migrarCustoRecursosLegado(farm, farmRecursos);
    data = {
      contas: obj.contas, historico: obj.historico,
      farm, farm_historico: farmHist, farm_recursos: farmRecursos, farm_custos_mensais: farmCustosMensais,
      farm_lotes: farmLotes, farm_custos_fixos: farmCustosFixos,
      ofertas, ofertas_historico: ofertasHist, ofertas_grupos: ofertasGrupos,
      emails: Array.isArray(obj.emails) ? obj.emails : [],
      ttpost,
      meta_anual: obj.meta_anual != null ? obj.meta_anual : 10000,
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
      ttpostContas: data.ttpost.contas.length,
      ttpostCustos: data.ttpost.custos.length,
    };
  }

  // Atualiza custos dependentes do tempo ao abrir o app, sem exigir uma edição.
  recalcularCustosFarm();

  return {
    STATUS, FARM_STATUS, OFERTAS_CATEGORIAS, TTPOST_CUSTO_BASES, TTPOST_ESCOPOS,
    criarConta, atualizarConta, alterarStatus, registrarVenda, cancelarVenda, excluirConta,
    getConta, listarContas, historicoDaConta,
    indicadores, lucroMensal,
    criarFarm, atualizarFarm, alterarStatusFarm, registrarVendaFarm, cancelarVendaFarm, excluirFarm,
    getFarm, listarFarm, historicoDoFarm, indicadoresFarm,
    diasCrescendoNoMes, getFarmCustosMes, adicionarFarmCustoMes, excluirFarmCustoMes,
    previewFechamentoFarmCustosMes, fecharFarmCustosMes, reabrirFarmCustosMes,
    custosMensaisAplicadosFarm, zerarCustosFarmCrescendo,
    listarFarmLotes, getFarmLote, contasDoLote, resumoLote, criarFarmLote,
    renomearFarmLote, definirCustoLote, adicionarReceitaLote, excluirReceitaLote, excluirFarmLote,
    listarFarmCustosFixos, adicionarFarmCustoFixo, atualizarFarmCustoFixo, excluirFarmCustoFixo, totalFarmCustosFixosMensal,
    listarGruposOferta, criarGrupoOferta, renomearGrupoOferta, excluirGrupoOferta,
    getOfertaMes, getOfertaMesId, definirInvestimentoMes, adicionarReceitaOferta,
    excluirReceitaOferta, historicoDasOfertas, totalReceitasMes,
    resumoCompraVenda, resumoFarm, resumoOfertas, resumoOfertasGrupo, resumosOperacoes, resumoGeral, resumoGeralPeriodo,
    evolucaoMensal, atividadeRecente,
    getMetaAnual, setMetaAnual,
    adicionarEmails, listarEmails, alternarEmail, excluirEmail, contarEmails,
    listarCustosTtpost, salvarCustoTtpost, excluirCustoTtpost,
    listarContasTtpost, salvarContaTtpost, excluirContaTtpost, rankingTtpost,
    getMetaSeguidoresTtpost, setMetaSeguidoresTtpost,
    metaTtpostJaNotificada, marcarMetaTtpostNotificada,
    getFalhasPostagemHoje, definirFalhasPostagemHoje,
    getRankingOcultosTtpost, definirRankingOcultosTtpost,
    listarEstoquesTtpost, salvarEstoqueTtpost, excluirEstoqueTtpost,
    resumoTtpost, detalharCustoTtpostFarm, custoOperacionalTtpostFarm,
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
