const portalStateKeys = [
  "dev-plan:products",
  "dev-plan:demands",
  "dev-plan:roadmap",
  "dev-plan:history",
  "dev-plan:roadmap-versions",
  "dev-plan:team",
  "dev-plan:initiatives",
] as const;

export type PortalStateKey = (typeof portalStateKeys)[number];
const pendingStateSaves = new Map<string, Promise<boolean>>();
const portalStateCache = new Map<string, unknown>();
let portalAccountsCache: unknown[] = [];

export function readPortalState<T>(key: string, fallback: T): T {
  return portalStateCache.has(key) ? portalStateCache.get(key) as T : fallback;
}

export function readPortalAccounts(): unknown[] {
  return portalAccountsCache;
}

function reportDatabaseError(error?: unknown) {
  const detail = error instanceof Error ? error.message : undefined;
  window.dispatchEvent(new CustomEvent("portal-database-error", { detail }));
}

async function throwApiError(response: Response, path: string): Promise<never> {
  let detail = "";
  try {
    const body = await response.json() as { detail?: unknown; error?: unknown };
    if (typeof body.detail === "string") detail = body.detail;
    else if (typeof body.error === "string") detail = body.error;
  } catch {
    // Keep the HTTP status when the API response has no JSON body.
  }
  throw new Error(`${path} respondeu HTTP ${response.status}.${detail ? ` ${detail}` : ""}`);
}

export function savePortalState(key: string, value: unknown): Promise<boolean> {
  if (!portalStateKeys.includes(key as PortalStateKey)) return Promise.resolve(false);

  const previous = pendingStateSaves.get(key) ?? Promise.resolve(true);
  const current = previous.then(async () => {
    try {
      const response = await fetch("/api/state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      if (!response.ok) await throwApiError(response, "/api/state");
      portalStateCache.set(key, value);
      return true;
    } catch (error) {
      console.error("Falha ao sincronizar o estado:", error);
      reportDatabaseError(error);
      return false;
    }
  });

  pendingStateSaves.set(key, current);
  void current.then(() => {
    if (pendingStateSaves.get(key) === current) pendingStateSaves.delete(key);
  });
  return current;
}

export async function savePortalAccounts(accounts: unknown[]): Promise<boolean> {
  try {
    const response = await fetch("/api/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(accounts),
    });
    if (!response.ok) await throwApiError(response, "/api/accounts");
    portalAccountsCache = accounts;
    return true;
  } catch (error) {
    console.error("Falha ao sincronizar usuários:", error);
    reportDatabaseError(error);
    return false;
  }
}

function accountFromDatabaseRow(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    email: String(row.email ?? ""),
    role: row.role === "Editor" ? "Gestor" : String(row.role ?? "Visualização"),
    salt: String(row.salt ?? ""),
    passwordHash: String(row.password_hash ?? ""),
    ...(typeof row.active === "boolean" ? { active: row.active } : {}),
    ...(typeof row.approved === "boolean" ? { approved: row.approved } : {}),
    ...(typeof row.last_access_at === "string" ? { lastAccessAt: row.last_access_at } : {}),
    ...(typeof row.must_change_password === "boolean" ? { mustChangePassword: row.must_change_password } : {}),
    ...(Array.isArray(row.product_ids) ? { productIds: row.product_ids.filter(Number.isInteger) as number[] } : {}),
  };
}

async function initializePortalAccounts() {
  const response = await fetch("/api/accounts");
  if (!response.ok) await throwApiError(response, "/api/accounts");
  const { rows } = await response.json() as { rows: Array<Record<string, unknown>> };
  portalAccountsCache = rows.map(accountFromDatabaseRow);
}

export async function initializePortalDatabase() {
  const response = await fetch("/api/state");
  if (!response.ok) await throwApiError(response, "/api/state");

  const { rows } = await response.json() as { rows: Array<{ key: string; value: unknown }> };
  const stateByKey = new Map(rows
    .filter(row => portalStateKeys.includes(row.key as PortalStateKey))
    .map(row => [row.key, row.value]));
  const missingRows = portalStateKeys
    .filter(key => !stateByKey.has(key))
    .map(key => ({ key, value: [] }));

  if (missingRows.length) {
    const seedResponse = await fetch("/api/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(missingRows),
    });
    if (!seedResponse.ok) await throwApiError(seedResponse, "/api/state (inicialização)");
  }

  for (const key of portalStateKeys) {
    portalStateCache.set(key, stateByKey.get(key) ?? []);
  }

  await initializePortalAccounts();
  try {
    for (const key of [...portalStateKeys, "roadmap.accounts.v1"]) localStorage.removeItem(key);
  } catch {
    // O cache legado nao participa da leitura nem da gravacao dos dados.
  }
}
