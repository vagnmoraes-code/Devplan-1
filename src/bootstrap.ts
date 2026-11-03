import { initializePortalDatabase } from "./database";

const retryDelayMs = 10_000;
let retryTimer: number | undefined;
let initialization: Promise<void> | undefined;
let portalStarted = false;

function showDatabaseError(error?: unknown) {
  const root = document.getElementById("root");
  if (!root) return;

  let warning = document.getElementById("database-warning");
  if (!warning) {
    warning = document.createElement("div");
    warning.id = "database-warning";
    warning.setAttribute("role", "alert");
    Object.assign(warning.style, {
      position: "fixed", left: "16px", right: "16px", bottom: "16px", zIndex: "99999",
      padding: "12px 16px", borderRadius: "10px", background: "#7f1d1d", color: "#fff",
      font: "14px/1.45 system-ui, sans-serif", boxShadow: "0 6px 24px #0003",
    });
    const message = document.createElement("span");
    message.dataset.role = "database-message";
    const retry = document.createElement("button");
    retry.textContent = "Tentar novamente";
    retry.style.cssText = "margin-left:12px;padding:6px 10px;border:0;border-radius:6px;cursor:pointer";
    retry.onclick = () => {
      if (portalStarted) {
        window.location.reload();
        return;
      }
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      retryTimer = undefined;
      void initializeAndOpenPortal();
    };
    warning.append(message, retry);
    document.body.append(warning);
  }

  const detail = error instanceof Error ? ` Detalhe: ${error.message}` : "";
  const message = warning.querySelector<HTMLElement>('[data-role="database-message"]');
  if (message) message.textContent = portalStarted
    ? `Falha ao sincronizar com o banco. Recarregue para tentar novamente.${detail} `
    : `Banco do Supabase indisponível. Nova tentativa automática em ${retryDelayMs / 1000} segundos.${detail} `;
}

window.addEventListener("portal-database-error", event => {
  const detail = (event as CustomEvent<unknown>).detail;
  showDatabaseError(typeof detail === "string" ? new Error(detail) : undefined);
});

async function initializeAndOpenPortal(): Promise<void> {
  if (initialization) return initialization;
  initialization = (async () => {
    try {
      await initializePortalDatabase();
      if (!portalStarted) {
        await import("./main");
        portalStarted = true;
      }
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      retryTimer = undefined;
      document.getElementById("database-warning")?.remove();
    } catch (error) {
      console.error("Não foi possível inicializar o banco de dados do portal.", error);
      showDatabaseError(error);
      if (!portalStarted && retryTimer === undefined) {
        retryTimer = window.setTimeout(() => {
          retryTimer = undefined;
          void initializeAndOpenPortal();
        }, retryDelayMs);
      }
    } finally {
      initialization = undefined;
    }
  })();
  return initialization;
}

await initializeAndOpenPortal();
