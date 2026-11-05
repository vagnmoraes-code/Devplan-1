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

function sendJson(response, status, body) {
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.status(status).json(body);
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase configuration is missing.");
  return { url, key };
}

function safeDiagnostic(error) {
  const message = error instanceof Error ? error.message : "";
  if (message === "Supabase configuration is missing.") return "Configuração do Supabase ausente.";
  const responseError = message.match(/^Supabase returned HTTP (\d+) while (saving ([\w:-]+) \(RPC ([\w_]+)\))(?: \[([A-Z0-9]+)\])?(?:: (.+))?\.$/);
  if (responseError) {
    const [, status, operation, collection, rpc, code, reason] = responseError;
    if (status === "400" && code === "21000") {
      return collection === DEMANDS_COLLECTION
        ? "Há IDs de demanda repetidos. Cada demanda precisa ter um ID único; corrija os registros e tente novamente."
        : "Há identificadores repetidos na coleção. Corrija os registros e tente novamente.";
    }
    return `Supabase respondeu HTTP ${status} ao gravar ${collection} via ${rpc}${code ? ` (código ${code})` : ""}.${reason ? ` ${reason}` : ""}`;
  }
  const readError = message.match(/^Supabase returned HTTP (\d+) while (loading records|loading demands)\.$/);
  if (readError) return `Supabase respondeu HTTP ${readError[1]} durante ${readError[2]}.`;
  if (error instanceof TypeError) return "Falha de rede ao acessar o Supabase.";
  return "Falha interna ao acessar o Supabase. Consulte os logs da função na Vercel.";
}

function duplicateDemandIds(records) {
  const demandRecord = records.find(record => record.key === DEMANDS_COLLECTION);
  if (!demandRecord) return [];

  const seen = new Set();
  const duplicates = new Set();
  for (const demand of demandRecord.value) {
    // Match PostgreSQL text primary key semantics: whitespace is significant.
    const id = typeof demand.id === "string" ? demand.id : "";
    if (id && seen.has(id)) duplicates.add(id);
    if (id) seen.add(id);
  }
  return [...duplicates];
}

function isCardinalityViolation(error) {
  if (!(error instanceof Error)) return false;
  const responseError = error.message.match(/^Supabase returned HTTP 400 while saving [\w:-]+ \(RPC [\w_]+\) \[([A-Z0-9]+)\](?:: (.+))?\.$/);
  return responseError?.[1] === "21000" ||
    (responseError?.[1] === "22023" && responseError[2] === "Demand IDs must be unique.");
}

function safeDatabaseMessage(message) {
  const knownMessages = new Set([
    "Invalid portal collection.",
    "Portal records must be a JSON array.",
    "Each portal record must be a JSON object with an identifier.",
    "Demands must be a JSON array.",
    "Each demand must have an id and name.",
    "Demand IDs must be unique.",
    "A demand references a product that does not exist in public.products.",
  ]);
  return knownMessages.has(message) ? message : "";
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
  const rpc = isDemands ? DEMANDS_REPLACE_RPC : REPLACE_RPC;
  const response = await fetch(url + "/rest/v1/rpc/" + rpc, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify(isDemands
      ? { p_records: records }
      : { p_collection: collection, p_records: records }),
  });
  if (!response.ok) {
    let code = "";
    let reason = "";
    try {
      const body = await response.json();
      if (typeof body.code === "string" && /^[A-Z0-9]{4,10}$/.test(body.code)) code = body.code;
      if (typeof body.message === "string") reason = safeDatabaseMessage(body.message);
    } catch {
      // Keep the HTTP status and RPC name when Supabase returns no JSON error body.
    }
    throw new Error(
      `Supabase returned HTTP ${response.status} while saving ${collection} (RPC ${rpc})` +
      `${code ? ` [${code}]` : ""}${reason ? `: ${reason}` : ""}.`,
    );
  }
}

export default async function handler(request, response) {
  if (request.method !== "GET" && request.method !== "POST") {
    response.setHeader("allow", "GET, POST");
    return sendJson(response, 405, { error: "Method not allowed." });
  }

  try {
    const { url, key } = getSupabaseConfig();
    if (request.method === "GET") {
      return sendJson(response, 200, { rows: await loadCollections(url, key) });
    }

    const records = Array.isArray(request.body) ? request.body : [request.body];
    if (!isCollectionPayload(records)) return sendJson(response, 400, { error: "Invalid collection data." });
    const duplicateIds = duplicateDemandIds(records);
    if (duplicateIds.length) {
      return sendJson(response, 400, {
        error: "Invalid demand data.",
        detail: `Há IDs de demanda repetidos (${duplicateIds.join(", ")}). Cada demanda precisa ter um ID único.`,
      });
    }

    for (const record of records) await replaceCollection(url, key, record.key, record.value);
    return sendJson(response, 200, { ok: true });
  } catch (error) {
    console.error("Portal records request failed:", error.message || error.name || "NetworkError");
    const cardinalityViolation = isCardinalityViolation(error);
    return sendJson(response, cardinalityViolation ? 400 : 502, {
      error: cardinalityViolation ? "Invalid record data." : "Could not access Supabase records.",
      detail: safeDiagnostic(error),
    });
  }
}
