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
import { executeCursorAgent, spawnCursorAgentStream } from "./cursorAgent.js";

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

  app.post("/api/cursor-agent", async (req, res) => {
    try {
      const prompt = String(req.body?.prompt ?? "");
      const mode = String(req.body?.mode ?? "agent") as "agent" | "plan" | "ask";
      const cwd = String(req.body?.cwd ?? roots[0] ?? "");
      
      if (!prompt.trim()) {
        return res.status(400).json({ ok: false, error: "Missing prompt" });
      }

      // Validate cwd is in roots
      const realCwd = await validatePathInRoots(cwd, roots);
      
      const result = await executeCursorAgent(prompt, mode, realCwd);
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.post("/api/cursor-agent/stream", async (req, res) => {
    try {
      const prompt = String(req.body?.prompt ?? "");
      const mode = String(req.body?.mode ?? "agent") as "agent" | "plan" | "ask";
      const cwd = String(req.body?.cwd ?? roots[0] ?? "");
      const force = typeof req.body?.force === "boolean" ? Boolean(req.body.force) : true;
      const resume = typeof req.body?.resume === "string" ? String(req.body.resume) : "";

      if (!prompt.trim()) {
        return res.status(400).json({ ok: false, error: "Missing prompt" });
      }

      // Validate cwd is in roots
      const realCwd = await validatePathInRoots(cwd, roots);

      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      // Disable proxy buffering (best-effort; harmless if ignored)
      res.setHeader("X-Accel-Buffering", "no");
      // Flush headers early so the client starts reading immediately.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (res as any).flushHeaders?.();

      let ended = false;
      const safeWrite = (line: string) => {
        if (ended) return;
        try {
          res.write(line.endsWith("\n") ? line : line + "\n");
        } catch {}
      };

      const { stop } = await spawnCursorAgentStream({
        prompt,
        mode,
        cwd: realCwd,
        force,
        resume: resume.trim() ? resume.trim() : undefined,
        timeoutMs: 60000,
        onStdoutLine: (line) => safeWrite(line),
        onStderrLine: (line) => safeWrite(JSON.stringify({ type: "stderr", message: line })),
        onExit: ({ code, signal, timedOut }) => {
          safeWrite(JSON.stringify({ type: "result", exitCode: code, signal, timedOut }));
          ended = true;
          try {
            res.end();
          } catch {}
        },
      });

      // If client disconnects, stop the child to avoid leaks.
      req.on("close", () => {
        if (ended) return;
        ended = true;
        try {
          stop();
        } catch {}
      });
    } catch (e: any) {
      // If we haven't started streaming, return JSON error.
      // If we already started, best-effort emit an NDJSON error and end.
      try {
        const headersSent = res.headersSent;
        if (!headersSent) {
          return res.status(500).json({ ok: false, error: e?.message ?? String(e) });
        }
        res.write(JSON.stringify({ type: "error", message: e?.message ?? String(e) }) + "\n");
        res.end();
      } catch {
        // ignore
      }
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

