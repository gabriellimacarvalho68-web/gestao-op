import { createClient } from "npm:@supabase/supabase-js@2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    // A autenticação é a chave privada de 256 bits enviada no corpo; não há
    // cookies nem credenciais do navegador. Assim o app instalado (Electron)
    // e a PWA podem usar a mesma função sem depender de uma origem específica.
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

function secretKey() {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    if (typeof keys.default === "string") return keys.default;
    const first = Object.values(keys)[0];
    if (typeof first === "string") return first;
  } catch (_error) { /* fallback para projetos com chave legada */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

const supabase = createClient(Deno.env.get("SUPABASE_URL") || "", secretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

function secureEqual(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function validAccessKey(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

async function loadSpace(body: Record<string, unknown>) {
  const syncId = String(body.sync_id || "").trim();
  const accessKey = String(body.access_key || "").trim();
  if (!/^[a-f0-9-]{36}$/i.test(syncId) || !validAccessKey(accessKey)) return { error: json({ error: "Credenciais de sincronização inválidas." }, 401) };
  const { data, error } = await supabase
    .from("gestao_op_sync_spaces")
    .select("id,access_key_hash,snapshot,modified_at,updated_at,last_source_id")
    .eq("id", syncId).maybeSingle();
  if (error) return { error: json({ error: "Não foi possível consultar a sincronização." }, 500) };
  if (!data || !secureEqual(await sha256(accessKey), data.access_key_hash)) return { error: json({ error: "Código de pareamento inválido." }, 401) };
  return { space: data };
}

async function salvarSeAtual(space: { id: string; modified_at: string | null }, alteracoes: Record<string, unknown>) {
  let consulta = supabase.from("gestao_op_sync_spaces")
    .update(alteracoes).eq("id", space.id);
  consulta = space.modified_at
    ? consulta.eq("modified_at", space.modified_at)
    : consulta.is("modified_at", null);
  const { data, error } = await consulta.select("id").maybeSingle();
  return { salvo: Boolean(data), erro: Boolean(error) };
}

async function conflitoAtual(id: string) {
  const { data } = await supabase.from("gestao_op_sync_spaces")
    .select("snapshot,modified_at,updated_at").eq("id", id).maybeSingle();
  return json({
    error: "Há uma versão mais nova em outro aparelho.",
    snapshot: data?.snapshot || null,
    modified_at: data?.modified_at || null,
    updated_at: data?.updated_at || null,
  }, 409);
}

function normalizar(valor: unknown) {
  return String(valor || "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function urlOneDrivePublica(valor: unknown) {
  try {
    const url = new URL(String(valor || ""));
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "1drv.ms" || host === "onedrive.live.com" || host.endsWith(".sharepoint.com"));
  } catch (_erro) { return false; }
}

function valorDaLinha(linha: Record<string, string>, nomes: string[]) {
  for (const nome of nomes) {
    const valor = linha[normalizar(nome)];
    if (valor) return valor;
  }
  return "";
}

function chaveUsername(valor: unknown) {
  return String(valor || "").trim().replace(/^@/, "").toLowerCase();
}

function importarRegistrosFarm(registros: Array<{ linha: number; valores: Record<string, string> }>, snapshot: Record<string, unknown>) {
  const dados = snapshot as Record<string, any>;
  dados.farm = Array.isArray(dados.farm) ? dados.farm : [];
  dados.farm_historico = Array.isArray(dados.farm_historico) ? dados.farm_historico : [];
  dados.farm_lotes = Array.isArray(dados.farm_lotes) ? dados.farm_lotes : [];
  const existentes = new Set(dados.farm.map((conta: Record<string, unknown>) => chaveUsername(conta.username)));
  const estagios = ["Crescendo", "Shop aceito", "Monetizada", "Sem nada", "Vendida"];
  let adicionadas = 0, ignoradas = 0;
  const erros: string[] = [];

  registros.forEach(registro => {
    const username = valorDaLinha(registro.valores, ["usuario", "username"]);
    if (!username) { ignoradas += 1; return; }
    const chave = chaveUsername(username);
    if (existentes.has(chave)) { ignoradas += 1; return; }
    const textoEstagio = valorDaLinha(registro.valores, ["estagio", "status"]);
    const status = textoEstagio ? estagios.find(estagio => normalizar(estagio) === normalizar(textoEstagio)) : "Crescendo";
    if (!status) { erros.push(`Linha ${registro.linha}: estágio não reconhecido.`); return; }
    const textoLote = valorDaLinha(registro.valores, ["lote"]);
    const opcoesLote = textoLote && /^\d+$/.test(normalizar(textoLote)) ? [normalizar(textoLote), `lote ${normalizar(textoLote)}`] : [normalizar(textoLote)];
    const lote = textoLote ? dados.farm_lotes.find((item: Record<string, unknown>) => opcoesLote.includes(normalizar(item.nome))) : null;
    if (textoLote && !lote) { erros.push(`Linha ${registro.linha}: lote não encontrado no app.`); return; }
    const senha = valorDaLinha(registro.valores, ["senha", "senha do email"]);
    const agora = new Date().toISOString();
    const id = crypto.randomUUID();
    dados.farm.push({
      id, username, plataforma: "", email: valorDaLinha(registro.valores, ["email", "e mail"]), senha,
      senha_tiktok: valorDaLinha(registro.valores, ["senha tiktok", "senha do tiktok"]) || senha,
      lote_id: lote?.id || null, custo_proprio: 0, custo_recursos_legado: 0, recursos: [], custo: 0,
      preco_venda: null, lucro: 0, status, observacoes: valorDaLinha(registro.valores, ["observacoes", "observacao", "obs"]),
      data_inicio: agora, data_venda: null, criado_em: agora, atualizado_em: agora,
    });
    dados.farm_historico.push({ id: crypto.randomUUID(), farm_id: id, evento: "Conta criada", descricao: `Conta @${username} importada do Excel.`, criado_em: agora });
    existentes.add(chave);
    adicionadas += 1;
  });
  return { snapshot: dados, adicionadas, ignoradas, erros: erros.slice(0, 5) };
}

function registrosRecebidosDoExcel(valor: unknown) {
  if (!Array.isArray(valor) || !valor.length) throw new Error("O Excel não enviou linhas para importar.");
  if (valor.length > 1_000) throw new Error("O Excel pode enviar no máximo 1.000 linhas por vez.");
  return valor.map((linha, indice) => {
    if (!linha || typeof linha !== "object" || Array.isArray(linha)) throw new Error(`Linha ${indice + 1}: formato inválido.`);
    const valores: Record<string, string> = {};
    Object.entries(linha as Record<string, unknown>).forEach(([cabecalho, celula]) => {
      const nome = normalizar(cabecalho);
      if (nome) valores[nome] = String(celula ?? "").trim();
    });
    return { linha: indice + 1, valores };
  }).filter(registro => Object.values(registro.valores).some(Boolean));
}

async function importarPlanilhaPublica(link: string, snapshot: Record<string, unknown>) {
  // download=1 evita a página de prévia do Excel. A URL de origem continua
  // restrita ao OneDrive; não aceitamos URLs arbitrárias nesta função privada.
  const urlDownload = link + (link.includes("?") ? "&" : "?") + "download=1";
  const resposta = await fetch(urlDownload, { redirect: "follow" });
  if (!resposta.ok) throw new Error("O OneDrive não permitiu baixar a planilha de exibição.");
  const bytes = new Uint8Array(await resposta.arrayBuffer());
  if (!bytes.length || bytes.length > 10_000_000) throw new Error("A planilha está vazia ou excede o limite de 10 MB.");

  const XLSX = await import("npm:xlsx@0.18.5");
  const livro = XLSX.read(bytes, { type: "array", cellDates: false });
  let registros: Array<{ linha: number; valores: Record<string, string> }> = [];
  for (const nomeAba of livro.SheetNames) {
    const linhas = XLSX.utils.sheet_to_json(livro.Sheets[nomeAba], { header: 1, defval: "", raw: false }) as unknown[][];
    const indiceCabecalho = linhas.findIndex(linha => (linha as unknown[]).map(normalizar).includes("usuario") || (linha as unknown[]).map(normalizar).includes("username"));
    if (indiceCabecalho < 0) continue;
    const cabecalhos = (linhas[indiceCabecalho] as unknown[]).map(normalizar);
    registros = linhas.slice(indiceCabecalho + 1).map((celulas, indice) => {
      const valores: Record<string, string> = {};
      cabecalhos.forEach((cabecalho, coluna) => {
        if (cabecalho) valores[cabecalho] = String((celulas as unknown[])[coluna] ?? "").trim();
      });
      return { linha: indiceCabecalho + indice + 2, valores };
    }).filter(registro => Object.values(registro.valores).some(Boolean));
    break;
  }
  if (!registros.length) throw new Error("Não encontrei contas com a coluna usuario na planilha.");

  return importarRegistrosFarm(registros, snapshot);
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return json({ ok: true });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");

    if (action === "create") {
      if (!validAccessKey(body.access_key)) return json({ error: "Chave de pareamento inválida." }, 400);
      const { data, error } = await supabase.from("gestao_op_sync_spaces")
        .insert({ access_key_hash: await sha256(String(body.access_key)), last_source_id: String(body.source_id || "").slice(0, 120) })
        .select("id").single();
      if (error || !data) return json({ error: "Não foi possível criar a sincronização." }, 500);
      return json({ ok: true, sync_id: data.id }, 201);
    }

    const loaded = await loadSpace(body);
    if (loaded.error) return loaded.error;
    const space = loaded.space!;
    if (action === "pull") {
      return json({ ok: true, snapshot: space.snapshot, modified_at: space.modified_at, updated_at: space.updated_at });
    }

    if (action === "push") {
      const snapshot = body.snapshot;
      const modifiedAt = String(body.modified_at || "");
      const sourceId = String(body.source_id || "").slice(0, 120);
      if (!snapshot || typeof snapshot !== "object" || !Number.isFinite(Date.parse(modifiedAt))) {
        return json({ error: "Dados de sincronização inválidos." }, 400);
      }
      if (JSON.stringify(snapshot).length > 5_000_000) return json({ error: "O backup excede 5 MB." }, 413);
      // Não deixa um aparelho que ficou muito tempo offline apagar uma versão
      // mais nova. Ele recebe a cópia do servidor e volta a ficar alinhado.
      if (space.modified_at && new Date(space.modified_at).getTime() > new Date(modifiedAt).getTime()) {
        return json({ error: "Há uma versão mais nova em outro aparelho.", snapshot: space.snapshot, modified_at: space.modified_at, updated_at: space.updated_at }, 409);
      }
      const updatedAt = new Date().toISOString();
      const gravacao = await salvarSeAtual(space, {
        snapshot, modified_at: modifiedAt, updated_at: updatedAt, last_source_id: sourceId,
      });
      if (gravacao.erro) return json({ error: "Não foi possível salvar a sincronização." }, 500);
      if (!gravacao.salvo) return await conflitoAtual(space.id);
      return json({ ok: true, modified_at: modifiedAt, updated_at: updatedAt });
    }
    if (action === "import_public_excel") {
      const link = String(body.public_url || "").trim();
      if (!urlOneDrivePublica(link)) return json({ error: "Link público do OneDrive inválido." }, 400);
      if (!space.snapshot || typeof space.snapshot !== "object") {
        return json({ error: "Ative a sincronização primeiro para criar os dados do app na nuvem." }, 400);
      }
      const importacao = await importarPlanilhaPublica(link, structuredClone(space.snapshot) as Record<string, unknown>);
      if (importacao.adicionadas === 0) {
        return json({ ok: true, ...importacao, modified_at: space.modified_at, updated_at: space.updated_at });
      }
      const modifiedAt = new Date().toISOString();
      const gravacao = await salvarSeAtual(space, {
        snapshot: importacao.snapshot, modified_at: modifiedAt, updated_at: modifiedAt, last_source_id: "onedrive-public-excel",
      });
      if (gravacao.erro) return json({ error: "Não foi possível salvar as contas importadas." }, 500);
      if (!gravacao.salvo) return await conflitoAtual(space.id);
      return json({ ok: true, ...importacao, modified_at: modifiedAt, updated_at: modifiedAt });
    }
    if (action === "import_excel_rows") {
      if (!space.snapshot || typeof space.snapshot !== "object") {
        return json({ error: "Ative a sincronização primeiro para criar os dados do app na nuvem." }, 400);
      }
      const registros = registrosRecebidosDoExcel(body.rows);
      const importacao = importarRegistrosFarm(registros, structuredClone(space.snapshot) as Record<string, unknown>);
      if (importacao.adicionadas === 0) {
        return json({ ok: true, ...importacao, modified_at: space.modified_at, updated_at: space.updated_at });
      }
      const modifiedAt = new Date().toISOString();
      const gravacao = await salvarSeAtual(space, {
        snapshot: importacao.snapshot, modified_at: modifiedAt, updated_at: modifiedAt, last_source_id: "excel-vba",
      });
      if (gravacao.erro) return json({ error: "Não foi possível salvar as contas importadas." }, 500);
      if (!gravacao.salvo) return await conflitoAtual(space.id);
      return json({ ok: true, ...importacao, modified_at: modifiedAt, updated_at: modifiedAt });
    }
    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    console.error("gestao_op_sync", error instanceof Error ? error.message : String(error));
    return json({ error: "Requisição inválida." }, 400);
  }
});
