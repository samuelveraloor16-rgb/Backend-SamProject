// ensure-pg.cjs — Arranca PostgreSQL local solo si no esta escuchando.
// Se usa en `predev` / `pretest` del backend: nadie tiene que iniciar la BD a mano.
// Para CI se recomienda un servicio postgres (GitHub Actions services) y desactivar este hook.

const { spawn } = require("child_process");
const net = require("net");
const path = require("path");

const PG_HOME = process.env.PG_HOME || "C:\\PostgreSQL";
const PG_CTL = process.env.PG_CTL || path.join(PG_HOME, "bin", "pg_ctl.exe");
const PG_DATA = process.env.PG_DATA || path.join(PG_HOME, "data");
const PG_LOG = process.env.PG_LOG || path.join(PG_HOME, "logfile.txt");
const HOST = process.env.PGHOST || "localhost";
const PORT = Number(process.env.PGPORT || 5432);

function isListening(host, port) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(1500);
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("timeout", () => { sock.destroy(); resolve(false); });
    sock.once("error", () => resolve(false));
    sock.connect(port, host);
  });
}

(async () => {
  if (await isListening(HOST, PORT)) {
    console.log(`ensure-pg: PostgreSQL ya escucha en ${HOST}:${PORT}`);
    return;
  }
  console.log("ensure-pg: iniciando PostgreSQL...");
  const child = spawn(PG_CTL, ["-D", PG_DATA, "-l", PG_LOG, "-w", "start"], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  });
  child.unref();
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await isListening(HOST, PORT)) {
      console.log(`ensure-pg: PostgreSQL listo en ${HOST}:${PORT}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error("ensure-pg: PostgreSQL no respondio en 30s; revisa: " + PG_LOG);
  process.exit(1);
})().catch((e) => {
  console.error("ensure-pg:", e.message);
  process.exit(1);
});
