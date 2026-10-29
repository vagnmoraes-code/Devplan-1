import { initializePortalDatabase } from "./database";

function showDatabaseError() {
  const root = document.getElementById("root");
  if (!root || document.getElementById("database-warning")) return;
  const warning = document.createElement("div");
  warning.id = "database-warning";
  warning.setAttribute("role", "alert");
  warning.textContent = "Banco do Supabase indisponivel. O portal so abre quando a conexao com o banco for restabelecida.";
  Object.assign(warning.style, {
    position: "fixed", left: "16px", right: "16px", bottom: "16px", zIndex: "99999",
    padding: "12px 16px", borderRadius: "10px", background: "#7f1d1d", color: "#fff",
    font: "14px/1.45 system-ui, sans-serif", boxShadow: "0 6px 24px #0003",
  });
  const retry = document.createElement("button");
  retry.textContent = "Tentar novamente";
  retry.style.cssText = "margin-left:12px;padding:6px 10px;border:0;border-radius:6px;cursor:pointer";
  retry.onclick = () => window.location.reload();
  warning.append(retry);
  document.body.append(warning);
}

window.addEventListener("portal-database-error", showDatabaseError);
try {
  await initializePortalDatabase();
} catch (error) {
  console.error("Não foi possível inicializar o banco de dados do portal.", error);
  showDatabaseError();
}

if (!document.getElementById("database-warning")) await import("./main");
