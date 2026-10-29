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
const TABLE = "portal_records";
const REPLACE_RPC = "replace_portal_records";
const DEMANDS_COLLECTION = "dev-plan:demands";
const DEMANDS_REPLACE_RPC = "replace_portal_demands";
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

function isCollectionPayload(records) {
  return records.length > 0 && records.every(item =>
    item && STATE_KEYS.has(item.key) && Array.isArray(item.value) &&
    item.value.every(value => value && typeof value === "object" && !Array.isArray(value))
  );
}

async function loadCollections(url, key) {
  const query = "select=collection,record_id,position,value&order=collection.asc,position.asc,record_id.asc";
  const records = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const response = await fetch(url + "/rest/v1/" + TABLE + "?" + query, {
      headers: { apikey: key, "Range-Unit": "items", Range: offset + "-" + (offset + pageSize - 1) },
    });
    if (!response.ok) throw new Error("Supabase returned HTTP " + response.status + " while loading records.");
    const page = await response.json();
    records.push(...page);
    if (page.length < pageSize) break;
  }
  const collections = new Map([...STATE_KEYS].map(collection => [collection, []]));
  for (const record of records) {
    if (record.collection !== DEMANDS_COLLECTION && collections.has(record.collection)) {
      collections.get(record.collection).push(record.value);
    }
  }
  collections.set(DEMANDS_COLLECTION, await loadDemands(url, key));
  return [...collections].map(([key, value]) => ({ key, value }));
}

async function loadDemands(url, key) {
  const [demands, products, staffLinks] = await Promise.all([
    fetchAllRows(url, key, "demands?select=*&order=sort_order.asc,id.asc"),
    fetchAllRows(url, key, "products?select=id,name"),
    fetchAllRows(url, key, "demand_staff?select=demand_id,staff_id"),
  ]);
  const productNames = new Map(products.map(product => [String(product.id), product.name]));
  const resourcesByDemand = new Map();
  for (const link of staffLinks) {
    const ids = resourcesByDemand.get(link.demand_id) || [];
    ids.push(Number(link.staff_id));
    resourcesByDemand.set(link.demand_id, ids);
  }
  return demands.map(row => ({
    id: row.id,
    name: row.name,
    product: productNames.get(String(row.product_id)) || "",
    owner: row.owner || "",
    status: row.status || "",
    priority: row.priority || "",
    effort: Number(row.effort ?? 0),
    ...(row.actual_effort == null ? {} : { actualEffort: Number(row.actual_effort) }),
    ...(row.billable == null ? {} : { billable: row.billable }),
    ...(row.billed_amount == null ? {} : { billedAmount: Number(row.billed_amount) }),
    progress: Number(row.progress ?? 0),
    due: row.due || "",
    risk: row.risk || "",
    ...(row.type == null ? {} : { type: row.type }),
    ...(row.origin == null ? {} : { origin: row.origin }),
    ...(row.requester == null ? {} : { requester: row.requester }),
    ...(row.version == null ? {} : { version: row.version }),
    ...(row.artifact_number == null ? {} : { artifactNumber: row.artifact_number }),
    ...(row.notes == null ? {} : { notes: row.notes }),
    ...(row.start_date == null ? {} : { startDate: row.start_date }),
    ...(row.due_date == null ? {} : { dueDate: row.due_date }),
    resourceIds: resourcesByDemand.get(row.id) || [],
  }));
}

async function fetchAllRows(url, key, query) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const response = await fetch(url + "/rest/v1/" + query, {
      headers: { apikey: key, "Range-Unit": "items", Range: offset + "-" + (offset + pageSize - 1) },
    });
    if (!response.ok) throw new Error("Supabase returned HTTP " + response.status + " while loading demands.");
    const page = await response.json();
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function replaceCollection(url, key, collection, records) {
  const isDemands = collection === DEMANDS_COLLECTION;
  const response = await fetch(url + "/rest/v1/rpc/" + (isDemands ? DEMANDS_REPLACE_RPC : REPLACE_RPC), {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify(isDemands
      ? { p_records: records }
      : { p_collection: collection, p_records: records }),
  });
  if (!response.ok) throw new Error("Supabase returned HTTP " + response.status + " while saving records.");
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
        sendJson(response, 200, { rows: await loadCollections(url, key) });
        return;
      }

      if (request.method === "POST") {
        const payload = await readJson(request);
        const records = Array.isArray(payload) ? payload : [payload];
        if (!isCollectionPayload(records)) {
          sendJson(response, 400, { error: "Invalid collection data." });
          return;
        }
        for (const record of records) await replaceCollection(url, key, record.key, record.value);
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
      console.error("Falha ao acessar o Supabase:", error.message || error.name || "Erro de rede");
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
