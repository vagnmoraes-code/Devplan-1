import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isValidAccountList, loadAccountRows, replaceAccountRows } from "./supabase-accounts.mjs";

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
const MAX_BODY_BYTES = 5 * 1024 * 1024;

function readEnvFile() {
  let content;
  try {
    content = readFileSync(resolve(process.cwd(), ".env.txt"), "utf8");
  } catch {
    throw new Error("Arquivo .env.txt não encontrado na raiz do projeto.");
  }

  const values = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }

  const url = values.SUPABASE_URL;
  const key = values.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error(".env.txt precisa definir SUPABASE_URL e SUPABASE_SECRET_KEY.");
  return { url: url.replace(/\/$/, ""), key };
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Payload excede o limite permitido.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function startApiServer() {
  const { url, key } = readEnvFile();
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    if (pathname === "/api/health" && request.method === "GET") {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (pathname === "/api/accounts") {
      try {
        if (request.method === "GET") {
          const result = await loadAccountRows(url, key);
          if (!result.ok) {
            console.error(`Supabase respondeu HTTP ${result.status} ao carregar usuários.`);
            sendJson(response, 502, { error: "Não foi possível carregar os usuários do Supabase." });
            return;
          }
          sendJson(response, 200, { rows: await result.json() });
          return;
        }
        if (request.method === "POST") {
          const accounts = await readJson(request);
          if (!isValidAccountList(accounts)) {
            sendJson(response, 400, { error: "Lista de usuários inválida." });
            return;
          }
          const result = await replaceAccountRows(url, key, accounts);
          if (!result.ok) {
            console.error(`Supabase respondeu HTTP ${result.status} ao salvar usuários.`);
            sendJson(response, 502, { error: "Não foi possível salvar os usuários no Supabase." });
            return;
          }
          sendJson(response, 200, { ok: true });
          return;
        }
        response.setHeader("allow", "GET, POST");
        sendJson(response, 405, { error: "Método não permitido." });
      } catch (error) {
        if (error instanceof SyntaxError || error.message === "Payload excede o limite permitido.") {
          sendJson(response, 400, { error: error.message });
          return;
        }
        console.error("Falha ao acessar usuários no Supabase:", error.name || "Erro de rede");
        sendJson(response, 502, { error: "Falha de comunicação com o Supabase." });
      }
      return;
    }
    if (pathname !== "/api/state") {
      sendJson(response, 404, { error: "Rota não encontrada." });
      return;
    }

    try {
      if (request.method === "GET") {
        const result = await fetch(`${url}/rest/v1/${TABLE}?select=key,value`, { headers: { apikey: key } });
        if (!result.ok) {
          console.error(`Supabase respondeu HTTP ${result.status} ao carregar os dados.`);
          sendJson(response, 502, { error: "Não foi possível carregar os dados do Supabase." });
          return;
        }
        sendJson(response, 200, { rows: await result.json() });
        return;
      }

      if (request.method === "POST") {
        const payload = await readJson(request);
        const records = Array.isArray(payload) ? payload : [payload];
        if (!records.length || records.some(item => !item || !STATE_KEYS.has(item.key) || !Object.hasOwn(item, "value"))) {
          sendJson(response, 400, { error: "Chave de dados inválida." });
          return;
        }
        const result = await fetch(`${url}/rest/v1/${TABLE}?on_conflict=key`, {
          method: "POST",
          headers: { apikey: key, "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(records),
        });
        if (!result.ok) {
          console.error(`Supabase respondeu HTTP ${result.status} ao salvar os dados.`);
          sendJson(response, 502, { error: "Não foi possível salvar os dados no Supabase." });
          return;
        }
        sendJson(response, 200, { ok: true });
        return;
      }

      response.setHeader("allow", "GET, POST");
      sendJson(response, 405, { error: "Método não permitido." });
    } catch (error) {
      if (error instanceof SyntaxError || error.message === "Payload excede o limite permitido.") {
        sendJson(response, 400, { error: error.message });
        return;
      }
      console.error("Falha ao acessar o Supabase:", error.name || "Erro de rede");
      sendJson(response, 502, { error: "Falha de comunicação com o Supabase." });
    }
  });

  const port = Number(process.env.PORTAL_API_PORT || 4174);
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", resolveListen);
  });
  console.log(`API local ativa em http://127.0.0.1:${port}`);
  return server;
}
