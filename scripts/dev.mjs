import { createServer as createViteServer } from "vite";
import { startApiServer } from "./api-server.mjs";

let apiServer;
let viteServer;
let stopping = false;

async function stop() {
  if (stopping) return;
  stopping = true;
  await viteServer?.close();
  if (apiServer?.listening) await new Promise(resolve => apiServer.close(resolve));
}

try {
  apiServer = await startApiServer();
  viteServer = await createViteServer();
  await viteServer.listen();
  viteServer.printUrls();
} catch (error) {
  console.error(error.message || "Não foi possível iniciar os serviços do portal.");
  await stop();
  process.exitCode = 1;
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
