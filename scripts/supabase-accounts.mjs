const TABLE = "portal_accounts";

export const ACCOUNT_ROLES = new Set(["Administrador", "Gestor", "Visualização"]);

export function isValidAccountList(accounts) {
  return Array.isArray(accounts) && accounts.length > 0 && accounts.length <= 1000 && accounts.every(account =>
    account &&
    typeof account.id === "string" && /^[A-Za-z0-9-]+$/.test(account.id) &&
    typeof account.name === "string" &&
    typeof account.email === "string" &&
    ACCOUNT_ROLES.has(account.role) &&
    typeof account.salt === "string" &&
    typeof account.passwordHash === "string" &&
    (account.productIds === undefined || (Array.isArray(account.productIds) && account.productIds.every(Number.isInteger)))
  );
}

function toRow(account) {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    role: account.role,
    active: account.active,
    last_access_at: account.lastAccessAt,
    must_change_password: account.mustChangePassword,
    product_ids: account.productIds,
    salt: account.salt,
    password_hash: account.passwordHash,
  };
}

export async function loadAccountRows(url, key) {
  return fetch(`${url}/rest/v1/${TABLE}?select=id,name,email,role,active,last_access_at,must_change_password,product_ids,salt,password_hash&order=id.asc`, {
    headers: { apikey: key },
  });
}

export async function replaceAccountRows(url, key, accounts) {
  const rows = accounts.map(toRow);

  if (rows.length) {
    const upsert = await fetch(`${url}/rest/v1/${TABLE}?on_conflict=id`, {
      method: "POST",
      headers: {
        apikey: key,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    });
    if (!upsert.ok) return upsert;
  }

  const idFilter = rows.length
    ? `not.in.(${rows.map(row => `"${row.id}"`).join(",")})`
    : "not.is.null";
  return fetch(`${url}/rest/v1/${TABLE}?id=${encodeURIComponent(idFilter)}`, {
    method: "DELETE",
    headers: { apikey: key, prefer: "return=minimal" },
  });
}
