export type AccessRole = "Administrador" | "Gestor" | "Visualização";
export type Account = { id: string; name: string; email: string; role: AccessRole; productIds?: number[]; active?: boolean; approved?: boolean; lastAccessAt?: string; mustChangePassword?: boolean; salt: string; passwordHash: string };

import { readPortalAccounts, savePortalAccounts } from "./database";

const SESSION_KEY = "roadmap.session.v1";
const REMEMBERED_SESSION_KEY = "roadmap.remembered-session.v1";

export function loadAccounts(): Account[] {
  const accounts = readPortalAccounts();
  return Array.isArray(accounts) ? accounts as Account[] : [];
}

export async function saveAccounts(accounts: Account[]): Promise<boolean> {
  return savePortalAccounts(accounts);
}

export function sessionId() {
  try { return sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(REMEMBERED_SESSION_KEY); }
  catch { return null; }
}
export function setSession(id: string | null, remember = false) {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(REMEMBERED_SESSION_KEY);
    if (id) {
      if (remember) localStorage.setItem(REMEMBERED_SESSION_KEY, id);
      else sessionStorage.setItem(SESSION_KEY, id);
    }
  } catch { /* O login ainda funciona até recarregar a página. */ }
}

function hex(bytes: Uint8Array) { return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""); }
export async function hashPassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: Uint8Array.from(salt.match(/../g)!.map(v => parseInt(v, 16))), iterations: 210000, hash: "SHA-256" }, key, 256);
  return hex(new Uint8Array(bits));
}

export async function makeAccount(name: string, email: string, password: string, role: AccessRole): Promise<Account> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { id: crypto.randomUUID(), name: name.trim(), email: email.trim().toLowerCase(), role, salt, passwordHash: await hashPassword(password, salt) };
}

export async function updateAccountPassword(account: Account, password: string, mustChangePassword = false): Promise<Account> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { ...account, salt, passwordHash: await hashPassword(password, salt), mustChangePassword };
}


