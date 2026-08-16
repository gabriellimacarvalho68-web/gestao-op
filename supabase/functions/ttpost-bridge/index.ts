import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://gabriellimacarvalho68-web.github.io",
  "http://127.0.0.1:8123",
  "http://localhost:8123",
]);

const ALLOWED_COMMANDS = new Set([
  "deactivate_account",
  "toggle_preset",
  "run_preset",
  "start_warmup",
  "stop_warmup",
  "start_mobile_warmup",
  "stop_mobile_warmup",
]);

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://gabriellimacarvalho68-web.github.io";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, content-type, x-ttpost-installation",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8" },
  });
}

function bearer(request: Request) {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function secureEqual(received: string, expected: string) {
  if (!received || !expected || received.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < received.length; index += 1) {
    difference |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function secretKey() {
  try {
    const current = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    if (current.default) return current.default as string;
    const first = Object.values(current)[0];
    if (typeof first === "string") return first;
  } catch (_error) {
    // Projetos ainda com chaves legadas usam o fallback abaixo.
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  secretKey(),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function finishCommandResults(results: unknown) {
  if (!Array.isArray(results)) return;
  for (const item of results.slice(0, 100)) {
    if (!item || typeof item !== "object") continue;
    const command = item as Record<string, unknown>;
    const id = String(command.id || "").trim();
    if (!id) continue;
    await supabase
      .from("ttpost_commands")
      .update({
        status: command.ok === true ? "success" : "failed",
        completed_at: new Date().toISOString(),
        result: command,
      })
      .eq("id", id);
  }
}

async function syncDesktop(request: Request, body: Record<string, unknown>) {
  const configuredToken = Deno.env.get("TTPOST_DESKTOP_TOKEN") || "";
  if (!secureEqual(bearer(request), configuredToken)) {
    return json(request, { error: "Token do TTpost inválido." }, 401);
  }

  const installationId = String(
    body.installation_id || request.headers.get("x-ttpost-installation") || "",
  ).trim();
  const snapshot = body.snapshot;
  if (!installationId || !snapshot || typeof snapshot !== "object") {
    return json(request, { error: "Snapshot ou instalação inválidos." }, 400);
  }
  if (JSON.stringify(snapshot).length > 1_000_000) {
    return json(request, { error: "Snapshot excede o limite permitido." }, 413);
  }

  const syncedAt = new Date().toISOString();
  const { error: upsertError } = await supabase
    .from("ttpost_installations")
    .upsert({ installation_id: installationId, snapshot, synced_at: syncedAt }, {
      onConflict: "installation_id",
    });
  if (upsertError) {
    console.error("snapshot_upsert", upsertError.message);
    return json(request, { error: "Não foi possível salvar o snapshot." }, 500);
  }

  const snapshotObject = snapshot as Record<string, unknown>;
  await finishCommandResults(snapshotObject.command_results);

  const { data: rows, error: commandError } = await supabase
    .from("ttpost_commands")
    .select("id,payload")
    .eq("installation_id", installationId)
    .in("status", ["queued", "delivered"])
    .order("created_at", { ascending: true })
    .limit(25);
  if (commandError) {
    console.error("command_select", commandError.message);
    return json(request, { error: "Não foi possível consultar comandos." }, 500);
  }

  const ids = (rows || []).map((row) => row.id);
  if (ids.length) {
    await supabase
      .from("ttpost_commands")
      .update({ status: "delivered", delivered_at: syncedAt })
      .in("id", ids);
  }

  const commands = (rows || []).map((row) => ({
    ...(row.payload as Record<string, unknown>),
    id: row.id,
  }));
  return json(request, { ok: true, synced_at: syncedAt, commands });
}

async function dashboard(request: Request) {
  const configuredToken = Deno.env.get("TTPOST_DASHBOARD_TOKEN") || "";
  if (!secureEqual(bearer(request), configuredToken)) {
    return json(request, { error: "Token do Gestão OP inválido." }, 401);
  }
  const { data, error } = await supabase
    .from("ttpost_installations")
    .select("installation_id,snapshot,synced_at")
    .order("synced_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("dashboard_select", error.message);
    return json(request, { error: "Não foi possível carregar os dados." }, 500);
  }
  return json(request, { ok: true, installations: data || [] });
}

async function enqueueCommand(request: Request, body: Record<string, unknown>) {
  const configuredToken = Deno.env.get("TTPOST_DASHBOARD_TOKEN") || "";
  if (!secureEqual(bearer(request), configuredToken)) {
    return json(request, { error: "Token do Gestão OP inválido." }, 401);
  }
  const installationId = String(body.installation_id || "").trim();
  const command = body.command;
  if (!installationId || !command || typeof command !== "object") {
    return json(request, { error: "Comando ou instalação inválidos." }, 400);
  }
  const commandType = String((command as Record<string, unknown>).type || "");
  if (!ALLOWED_COMMANDS.has(commandType)) {
    return json(request, { error: "Tipo de comando não permitido." }, 400);
  }
  const { data, error } = await supabase
    .from("ttpost_commands")
    .insert({ installation_id: installationId, payload: command })
    .select("id,status,created_at")
    .single();
  if (error) {
    console.error("command_insert", error.message);
    return json(request, { error: "Não foi possível enfileirar o comando." }, 500);
  }
  return json(request, { ok: true, command: data }, 201);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(request) });
  }
  if (request.method !== "POST") {
    return json(request, { error: "Método não permitido." }, 405);
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");
    if (action === "sync") return await syncDesktop(request, body);
    if (action === "dashboard") return await dashboard(request);
    if (action === "command") return await enqueueCommand(request, body);
    return json(request, { error: "Ação desconhecida." }, 400);
  } catch (error) {
    console.error("unhandled", error instanceof Error ? error.message : String(error));
    return json(request, { error: "Requisição inválida." }, 400);
  }
});
