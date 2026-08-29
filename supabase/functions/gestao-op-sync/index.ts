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
      const { error } = await supabase.from("gestao_op_sync_spaces").update({
        snapshot, modified_at: modifiedAt, updated_at: updatedAt, last_source_id: sourceId,
      }).eq("id", space.id);
      if (error) return json({ error: "Não foi possível salvar a sincronização." }, 500);
      return json({ ok: true, modified_at: modifiedAt, updated_at: updatedAt });
    }
    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    console.error("gestao_op_sync", error instanceof Error ? error.message : String(error));
    return json({ error: "Requisição inválida." }, 400);
  }
});
