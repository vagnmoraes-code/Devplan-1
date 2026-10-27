const portalStateKeys = [
  "dev-plan:products",
  "dev-plan:demands",
  "dev-plan:roadmap",
  "dev-plan:history",
  "dev-plan:roadmap-versions",
  "dev-plan:team",
  "dev-plan:initiatives",
  "roadmap.accounts.v1",
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
    if (!response.ok) throw new Error("A API não confirmou a gravação.");
  } catch {
    reportDatabaseError();
  }
}

export async function initializePortalDatabase() {
  const response = await fetch("/api/state");
  if (!response.ok) throw new Error("Banco indisponível ou tabela ainda não criada.");

  const { rows } = await response.json() as { rows: Array<{ key: string; value: unknown }> };
  if (rows.length) {
    for (const row of rows) {
      if (portalStateKeys.includes(row.key as PortalStateKey)) localStorage.setItem(row.key, JSON.stringify(row.value));
    }
    return;
  }

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
