const STATE_KEYS = new Set([
  "dev-plan:products",
  "dev-plan:demands",
  "dev-plan:roadmap",
  "dev-plan:history",
  "dev-plan:roadmap-versions",
  "dev-plan:team",
  "dev-plan:initiatives",
]);

const TABLE = "portal_state";

function sendJson(response, status, body) {
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.status(status).json(body);
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Configuração do Supabase ausente.");
  return { url, key };
}

export default async function handler(request, response) {
  if (request.method !== "GET" && request.method !== "POST") {
    response.setHeader("allow", "GET, POST");
    return sendJson(response, 405, { error: "Método não permitido." });
  }

  try {
    const { url, key } = getSupabaseConfig();
    if (request.method === "GET") {
      const result = await fetch(`${url}/rest/v1/${TABLE}?select=key,value`, {
        headers: { apikey: key },
      });
      if (!result.ok) {
        console.error(`Supabase respondeu HTTP ${result.status} ao carregar os dados.`);
        return sendJson(response, 502, { error: "Não foi possível carregar os dados do Supabase." });
      }
      return sendJson(response, 200, { rows: await result.json() });
    }

    const records = Array.isArray(request.body) ? request.body : [request.body];
    if (!records.length || records.some(item => !item || !STATE_KEYS.has(item.key) || !Object.hasOwn(item, "value"))) {
      return sendJson(response, 400, { error: "Chave de dados inválida." });
    }

    const result = await fetch(`${url}/rest/v1/${TABLE}?on_conflict=key`, {
      method: "POST",
      headers: {
        apikey: key,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(records),
    });
    if (!result.ok) {
      console.error(`Supabase respondeu HTTP ${result.status} ao salvar os dados.`);
      return sendJson(response, 502, { error: "Não foi possível salvar os dados do Supabase." });
    }
    return sendJson(response, 200, { ok: true });
  } catch (error) {
    console.error("Falha ao acessar o Supabase:", error.name || "Erro de rede");
    return sendJson(response, 502, { error: "Falha de comunicação com o Supabase." });
  }
}
