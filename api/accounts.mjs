import { isValidAccountList, loadAccountRows, replaceAccountRows } from "../scripts/supabase-accounts.mjs";

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
      const result = await loadAccountRows(url, key);
      if (!result.ok) {
        console.error(`Supabase respondeu HTTP ${result.status} ao carregar usuários.`);
        return sendJson(response, 502, { error: "Não foi possível carregar os usuários do Supabase." });
      }
      return sendJson(response, 200, { rows: await result.json() });
    }

    if (!isValidAccountList(request.body)) {
      return sendJson(response, 400, { error: "Lista de usuários inválida." });
    }

    const result = await replaceAccountRows(url, key, request.body);
    if (!result.ok) {
      console.error(`Supabase respondeu HTTP ${result.status} ao salvar usuários.`);
      return sendJson(response, 502, { error: "Não foi possível salvar os usuários no Supabase." });
    }
    return sendJson(response, 200, { ok: true });
  } catch (error) {
    console.error("Falha ao acessar usuários no Supabase:", error.name || "Erro de rede");
    return sendJson(response, 502, { error: "Falha de comunicação com o Supabase." });
  }
}
