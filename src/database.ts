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

function reportDatabaseError() {
  window.dispatchEvent(new CustomEvent("portal-database-error"));
}

export async function savePortalState(key: string, value: unknown) {
  if (!portalStateKeys.includes(key as PortalStateKey)) return;
  try {
    const response = await fetch("/api/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (!response.ok) throw new Error(`/api/state respondeu HTTP ${response.status}.`);
  } catch (error) {
    console.error("Falha ao sincronizar o estado:", error);
    reportDatabaseError();
  }
}

export async function savePortalAccounts(accounts: unknown[]): Promise<boolean> {
  try {
    const response = await fetch("/api/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(accounts),
    });
    if (!response.ok) throw new Error(`/api/accounts respondeu HTTP ${response.status}.`);
    return true;
  } catch (error) {
    console.error("Falha ao sincronizar usuários:", error);
    reportDatabaseError();
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

function storedAccounts(): unknown[] {
  try {
    const accounts = JSON.parse(localStorage.getItem("roadmap.accounts.v1") || "[]");
    return Array.isArray(accounts) ? accounts : [];
  } catch {
    return [];
  }
}

async function initializePortalAccounts(legacyRows: Array<{ key: string; value: unknown }>) {
  const response = await fetch("/api/accounts");
  if (!response.ok) throw new Error(`/api/accounts respondeu HTTP ${response.status}.`);

  const { rows } = await response.json() as { rows: Array<Record<string, unknown>> };
  if (rows.length) {
    localStorage.setItem("roadmap.accounts.v1", JSON.stringify(rows.map(accountFromDatabaseRow)));
    return;
  }

  const legacyAccounts = legacyRows.find(row => row.key === "roadmap.accounts.v1")?.value;
  const legacy = Array.isArray(legacyAccounts) ? legacyAccounts : [];
  const local = storedAccounts();
  const mergedById = new Map<string, Record<string, unknown>>();
  for (const account of [...legacy, ...local]) {
    if (account && typeof account === "object" && typeof (account as Record<string, unknown>).id === "string") {
      mergedById.set((account as Record<string, unknown>).id as string, account as Record<string, unknown>);
    }
  }
  const accounts = [...mergedById.values()];
  if (accounts.length) {
    localStorage.setItem("roadmap.accounts.v1", JSON.stringify(accounts));
    await savePortalAccounts(accounts);
  }
}

export async function initializePortalDatabase() {
  const response = await fetch("/api/state");
  if (!response.ok) throw new Error(`/api/state respondeu HTTP ${response.status}.`);

  const { rows } = await response.json() as { rows: Array<{ key: string; value: unknown }> };
  const stateRows = rows.filter(row => portalStateKeys.includes(row.key as PortalStateKey));
  for (const row of stateRows) localStorage.setItem(row.key, JSON.stringify(row.value));

  if (!stateRows.length) {
    const localRows = portalStateKeys.flatMap(key => {
      const saved = localStorage.getItem(key);
      if (saved === null) return [];
      try {
        return [{ key, value: JSON.parse(saved) }];
      } catch {
        return [{ key, value: saved }];
      }
    });
    if (localRows.length) {
      const seedResponse = await fetch("/api/state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(localRows),
      });
      if (!seedResponse.ok) throw new Error("Não foi possível migrar os dados locais.");
    }
  }

  await initializePortalAccounts(rows);
}
