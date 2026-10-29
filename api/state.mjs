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
    if (collections.has(record.collection)) collections.get(record.collection).push(record.value);
  }
  return [...collections].map(([key, value]) => ({ key, value }));
}

async function replaceCollection(url, key, collection, records) {
  const response = await fetch(url + "/rest/v1/rpc/" + REPLACE_RPC, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ p_collection: collection, p_records: records }),
  });
  if (!response.ok) throw new Error("Supabase returned HTTP " + response.status + " while saving records.");
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

    for (const record of records) await replaceCollection(url, key, record.key, record.value);
    return sendJson(response, 200, { ok: true });
  } catch (error) {
    console.error("Portal records request failed:", error.name || "NetworkError");
    return sendJson(response, 502, { error: "Could not access Supabase records." });
  }
}
