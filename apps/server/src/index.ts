import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { execa } from "execa";

import { loadConfig } from "./config.js";
import { normalizeRoots, validatePathInRoots } from "./pathGuard.js";
import { listDir, readTextFile, writeTextFile } from "./fsApi.js";
import { attachTermWs } from "./term/wsTerm.js";

function getRepoRoot() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // apps/server/src or apps/server/dist -> repo root
  return path.resolve(__dirname, "..", "..", "..");
}

async function checkAgentCli() {
  try {
    await execa("agent", ["--version"], {
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`,
      },
      timeout: 5000,
    });
    console.log("[server] ✓ Cursor Agent CLI detected");
    return true;
  } catch {
    console.warn("[server] ⚠️  Cursor Agent CLI not found");
    console.warn("[server]     Install: curl https://cursor.com/install -fsS | bash");
    console.warn("[server]     Agent/Plan/Ask modes will be unavailable");
    return false;
  }
}

async function main() {
  const repoRoot = getRepoRoot();
  const configPath = process.env.CONFIG_PATH ?? path.join(repoRoot, "config", "config.json");
  const cfg = await loadConfig(configPath);
  const roots = await normalizeRoots(cfg.roots);

  // Check for Cursor Agent CLI availability
  await checkAgentCli();

  const port = Number(cfg.server?.port ?? process.env.PORT ?? 3005);
  const timeoutSec = cfg.limits?.timeoutSec ?? 900;
  const maxOutputKB = cfg.limits?.maxOutputKB ?? 1024;
  const maxSessions = cfg.limits?.maxSessions ?? 4;

  const app = express();
  const allowedOrigin = (origin: string | undefined) => {
    // Allow same-machine tools with no Origin (curl, etc.)
    if (!origin) return true;
    if (origin === "http://localhost:5173") return true;
    if (origin === "http://127.0.0.1:5173") return true;
    if (origin === `http://localhost:${port}`) return true;
    if (origin === `http://127.0.0.1:${port}`) return true;
    // Allow LAN access to Vite dev server
    if (/^http:\/\/(\d{1,3}\.){3}\d{1,3}:5173$/.test(origin)) return true;
    return false;
  };
  app.use(
    cors({
      origin: (origin, cb) => cb(null, allowedOrigin(origin ?? undefined)),
      credentials: false,
    }),
  );
  app.use(express.json({ limit: "10mb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, roots, uptimeSec: Math.floor(process.uptime()) });
  });

  app.get("/api/roots", (_req, res) => {
    res.json({ ok: true, roots });
  });

  app.get("/api/list", async (req, res) => {
    try {
      const p = String(req.query.path ?? "");
      const r = await listDir(roots, p);
      res.json({ ok: true, ...r });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.get("/api/read", async (req, res) => {
    try {
      const p = String(req.query.path ?? "");
      const r = await readTextFile(roots, p, 2 * 1024 * 1024);
      res.json({ ok: true, ...r });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.post("/api/write", async (req, res) => {
    try {
      const p = String(req.body?.path ?? "");
      const text = typeof req.body?.text === "string" ? req.body.text : "";
      const r = await writeTextFile(roots, p, text);
      res.json({ ok: true, ...r });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  // Serve built web if exists (after `pnpm --filter @web-ide/web build`)
  const webDist = path.join(repoRoot, "apps", "web", "dist");
  app.use(express.static(webDist));
  app.get("/", (_req, res) => res.sendFile(path.join(webDist, "index.html")));

  const server = http.createServer(app);

  attachTermWs({
    server,
    path: "/ws/term",
    whitelist: cfg.commandWhitelist ?? {},
    denylist: cfg.dangerousCommandDenylist ?? [],
    maxSessions,
    limits: { timeoutSec, maxOutputBytes: maxOutputKB * 1024 },
    validateCwd: (cwd) => validatePathInRoots(cwd, roots),
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`[server] listening on http://0.0.0.0:${port}`);
    console.log(`[server] config: ${configPath}`);
    console.log(`[server] roots: ${roots.join(", ")}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

