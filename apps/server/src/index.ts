import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import type { Response } from "express";
import cors from "cors";
import { execa } from "execa";

import { loadConfig } from "./config.js";
import { normalizeRoots, validatePathInRoots } from "./pathGuard.js";
import { listDir, readTextFile, writeTextFile } from "./fsApi.js";
import { attachTermWs } from "./term/wsTerm.js";
import { executeCursorAgent, spawnCursorAgentStream } from "./cursorAgent.js";
import {
  getAllSessions,
  getSession,
  createSession,
  updateSession,
  deleteSession,
  addMessage,
  updateMessage,
  getAllWorkspaces,
  getActiveWorkspace,
  createWorkspace,
  setActiveWorkspace,
  deleteWorkspace,
  getWorkspaceByCwd,
  getLastOpenedFile,
  setLastOpenedFile,
  type ChatSession,
  type Message,
  type Workspace,
} from "./db.js";

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
    return true;
  } catch {
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
  const bufferDir = cfg.bufferDir ?? path.join(repoRoot, "data", "agent-buffers");
  try {
    fs.mkdirSync(bufferDir, { recursive: true });
  } catch {}

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

  // 方案 A：runId + 缓冲 + 重连。Map<runId, AgentRun>
  type AgentRun = {
    buffer: string[];
    listeners: Set<Response>;
    ended: boolean;
    endFrame: string | null;
    stop: () => void;
  };
  const agentRuns = new Map<string, AgentRun>();

  // 向单个 res 写一行 NDJSON（带换行）
  const writeNdjsonLine = (res: Response, line: string) => {
    try {
      res.write(line.endsWith("\n") ? line : line + "\n");
    } catch {}
  };

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
    let runIdToClean: string | undefined;
    let runToClean: AgentRun | undefined;
    try {
      const prompt = String(req.body?.prompt ?? "");
      const mode = String(req.body?.mode ?? "agent") as "agent" | "plan" | "ask";
      const cwd = String(req.body?.cwd ?? roots[0] ?? "");
      const force = typeof req.body?.force === "boolean" ? Boolean(req.body.force) : true;
      const resume = typeof req.body?.resume === "string" ? String(req.body.resume) : "";

      if (!prompt.trim()) {
        return res.status(400).json({ ok: false, error: "Missing prompt" });
      }

      const realCwd = await validatePathInRoots(cwd, roots);

      const runId = crypto.randomUUID();
      const run: AgentRun = {
        buffer: [],
        listeners: new Set(),
        ended: false,
        endFrame: null,
        stop: () => {},
      };
      runIdToClean = runId;
      runToClean = run;
      agentRuns.set(runId, run);
      run.listeners.add(res);

      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Run-Id", runId);
      res.setHeader("X-Accel-Buffering", "no");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (res as any).flushHeaders?.();

      const broadcast = (line: string) => {
        run.buffer.push(line);
        for (const r of run.listeners) {
          writeNdjsonLine(r, line);
        }
      };

      const { stop } = await spawnCursorAgentStream({
        prompt,
        mode,
        cwd: realCwd,
        force,
        resume: resume.trim() ? resume.trim() : undefined,
        timeoutMs: timeoutSec * 1000,
        onStdoutLine: (line) => broadcast(line),
        onStderrLine: (line) => broadcast(JSON.stringify({ type: "stderr", message: line })),
        onExit: ({ code, signal, timedOut }) => {
          const endLine = JSON.stringify({ type: "result", exitCode: code, signal, timedOut });
          run.buffer.push(endLine);
          run.ended = true;
          run.endFrame = endLine;
          for (const r of run.listeners) {
            try {
              writeNdjsonLine(r, endLine);
              r.end();
            } catch {}
          }
          run.listeners.clear();
          // 保留已结束的 run 一段时间，供重连拉取全量 buffer
          setTimeout(() => agentRuns.delete(runId), 60_000);
        },
      });
      run.stop = stop;

      // 方案 A：客户端断开时只移除该连接的 listener，不杀进程
      req.on("close", () => {
        run.listeners.delete(res);
        try {
          res.end();
        } catch {}
      });
    } catch (e: any) {
      if (runIdToClean != null && runToClean != null && agentRuns.has(runIdToClean)) {
        runToClean.listeners.delete(res);
        agentRuns.delete(runIdToClean);
      }
      try {
        if (!res.headersSent) {
          return res.status(500).json({ ok: false, error: e?.message ?? String(e) });
        }
        res.write(JSON.stringify({ type: "error", message: e?.message ?? String(e) }) + "\n");
        res.end();
      } catch {
        // ignore
      }
    }
  });

  // 方案 A：按 runId 重连，先返回已缓冲输出，再接入后续实时输出
  app.get("/api/cursor-agent/stream/:runId", async (req, res) => {
    const runId = req.params.runId;
    const run = agentRuns.get(runId);
    if (!run) {
      return res.status(404).json({ ok: false, error: "Run not found or already finished" });
    }

    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Run-Id", runId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (res as any).flushHeaders?.();

    if (run.ended) {
      for (const line of run.buffer) {
        writeNdjsonLine(res, line);
      }
      try {
        res.end();
      } catch {}
      return;
    }

    for (const line of run.buffer) {
      writeNdjsonLine(res, line);
    }
    run.listeners.add(res);
    req.on("close", () => {
      run.listeners.delete(res);
      try {
        res.end();
      } catch {}
    });
  });

  // ==================== 文件缓冲方案：任务独立运行，输出写文件，前端轮询读取 ====================

  type TaskRunEntry = { stop: () => void; ended: boolean };
  const taskRunStore = new Map<string, TaskRunEntry>();

  const UUID_REG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function isSafeRunId(runId: string): boolean {
    return UUID_REG.test(runId) && !runId.includes("..");
  }

  app.post("/api/cursor-agent/start", async (req, res) => {
    try {
      const prompt = String(req.body?.prompt ?? "");
      const mode = String(req.body?.mode ?? "agent") as "agent" | "plan" | "ask";
      const cwd = String(req.body?.cwd ?? roots[0] ?? "");
      const force = typeof req.body?.force === "boolean" ? Boolean(req.body.force) : true;
      const resume = typeof req.body?.resume === "string" ? String(req.body.resume).trim() : "";

      if (!prompt.trim()) {
        return res.status(400).json({ ok: false, error: "Missing prompt" });
      }

      const realCwd = await validatePathInRoots(cwd, roots);

      const runId = crypto.randomUUID();
      const filePath = path.join(bufferDir, `${runId}.ndjson`);
      const writeStream = fs.createWriteStream(filePath, { flags: "a" });

      const runEntry: TaskRunEntry = { stop: () => {}, ended: false };
      taskRunStore.set(runId, runEntry);

      const writeLine = (line: string) => {
        try {
          writeStream.write(line.endsWith("\n") ? line : line + "\n");
        } catch {}
      };

      const spawnPromise = spawnCursorAgentStream({
        prompt,
        mode,
        cwd: realCwd,
        force,
        resume: resume || undefined,
        timeoutMs: timeoutSec * 1000,
        onStdoutLine: (line) => writeLine(line),
        onStderrLine: (line) => writeLine(JSON.stringify({ type: "stderr", message: line })),
        onExit: ({ code, signal, timedOut }) => {
          try {
            writeLine(JSON.stringify({ type: "result", exitCode: code, signal, timedOut }));
          } catch {}
          try {
            writeStream.end();
          } catch {}
          runEntry.ended = true;
        },
      });

      await spawnPromise.then(
        ({ stop }) => {
          runEntry.stop = stop;
        },
        (err: Error) => {
          try {
            writeLine(JSON.stringify({ type: "error", message: err?.message ?? String(err) }));
          } catch {}
          try {
            writeStream.end();
          } catch {}
          runEntry.ended = true;
          throw err;
        },
      );
      res.status(200).json({ ok: true, runId });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.get("/api/cursor-agent/task/:runId/output", async (req, res) => {
    const runId = req.params.runId;
    if (!isSafeRunId(runId)) {
      return res.status(400).json({ ok: false, error: "Invalid runId" });
    }

    const filePath = path.join(bufferDir, `${runId}.ndjson`);
    const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);

    try {
      const stat = fs.statSync(filePath);
      const size = stat.size;
      const runEntry = taskRunStore.get(runId);
      let ended = runEntry?.ended ?? false;
      if (!ended && size > 0) {
        const tailBytes = Math.min(2048, size);
        const fd = fs.openSync(filePath, "r");
        const tailBuf = Buffer.alloc(tailBytes);
        fs.readSync(fd, tailBuf, 0, tailBytes, size - tailBytes);
        fs.closeSync(fd);
        const str = tailBuf.toString("utf8");
        const lines = str.split("\n").map((s) => s.trim()).filter(Boolean);
        const lastLine = lines[lines.length - 1];
        if (lastLine) {
          try {
            const o = JSON.parse(lastLine) as { type?: string };
            if (o?.type === "result") ended = true;
          } catch {
            /* ignore */
          }
        }
        if (!ended && !runEntry && offset >= size) {
          ended = true;
        }
      }

      if (offset >= size) {
        return res.json({ ok: true, output: "", nextOffset: size, ended });
      }

      const buf: Buffer[] = [];
      const readStream = fs.createReadStream(filePath, { start: offset });
      for await (const chunk of readStream) {
        buf.push(chunk as Buffer);
      }
      const output = Buffer.concat(buf).toString("utf8");
      const nextOffset = offset + Buffer.byteLength(output, "utf8");

      res.json({ ok: true, output, nextOffset, ended });
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        return res.status(404).json({ ok: false, error: "Run not found or no output yet" });
      }
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  app.post("/api/cursor-agent/task/:runId/stop", (req, res) => {
    const runId = req.params.runId;
    if (!isSafeRunId(runId)) {
      return res.status(400).json({ ok: false, error: "Invalid runId" });
    }

    const runEntry = taskRunStore.get(runId);
    if (!runEntry) {
      return res.status(404).json({ ok: false, error: "Run not found or already finished" });
    }

    try {
      runEntry.stop();
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  // ==================== Chat Session APIs ====================

  // Get all sessions for a given cwd
  app.get("/api/chat/sessions", (req, res) => {
    try {
      const cwd = String(req.query.cwd ?? "");
      if (!cwd) {
        return res.status(400).json({ ok: false, error: "Missing cwd parameter" });
      }
      const sessions = getAllSessions(cwd);
      res.json({ ok: true, sessions });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  // Get a single session by ID
  app.get("/api/chat/sessions/:id", (req, res) => {
    try {
      const session = getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ ok: false, error: "Session not found" });
      }
      res.json({ ok: true, session });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  // Create a new session
  app.post("/api/chat/sessions", (req, res) => {
    try {
      const { id, cwd, title, messages, createdAt, updatedAt } = req.body;
      if (!id || !cwd) {
        return res.status(400).json({ ok: false, error: "Missing required fields" });
      }
      const session: ChatSession = {
        id,
        cwd,
        title: title || "New Chat",
        messages: messages || [],
        createdAt: createdAt || Date.now(),
        updatedAt: updatedAt || Date.now(),
      };
      const created = createSession(session);
      res.json({ ok: true, session: created });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  // Update a session
  app.put("/api/chat/sessions/:id", (req, res) => {
    try {
      const existing = getSession(req.params.id);
      if (!existing) {
        return res.status(404).json({ ok: false, error: "Session not found" });
      }
      const { title, messages, updatedAt } = req.body;
      const updated = updateSession({
        ...existing,
        title: title ?? existing.title,
        messages: messages ?? existing.messages,
        updatedAt: updatedAt ?? Date.now(),
      });
      res.json({ ok: true, session: updated });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  // Delete a session
  app.delete("/api/chat/sessions/:id", (req, res) => {
    try {
      const deleted = deleteSession(req.params.id);
      if (!deleted) {
        return res.status(404).json({ ok: false, error: "Session not found" });
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  // Add a message to a session
  app.post("/api/chat/sessions/:id/messages", (req, res) => {
    try {
      const session = getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ ok: false, error: "Session not found" });
      }
      const { id, role, content, timestamp } = req.body;
      if (!id || !role || content === undefined) {
        return res.status(400).json({ ok: false, error: "Missing required message fields" });
      }
      const message: Message = {
        id,
        role,
        content,
        timestamp: timestamp || Date.now(),
      };
      addMessage(req.params.id, message);
      res.json({ ok: true, message });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  // Update a message content
  app.patch("/api/chat/messages/:id", (req, res) => {
    try {
      const { content } = req.body;
      if (content === undefined) {
        return res.status(400).json({ ok: false, error: "Missing content" });
      }
      updateMessage(req.params.id, content);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  // ==================== End Chat Session APIs ====================

  // ==================== Workspace APIs ====================

  // Get all workspaces
  app.get("/api/workspaces", (_req, res) => {
    try {
      const workspaces = getAllWorkspaces();
      const active = getActiveWorkspace();
      res.json({ ok: true, workspaces, activeId: active?.id ?? null });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  // Create a new workspace
  app.post("/api/workspaces", (req, res) => {
    try {
      const { id, cwd, name, isActive } = req.body;
      if (!id || !cwd || !name) {
        return res.status(400).json({ ok: false, error: "Missing required fields" });
      }
      
      // Check if workspace with same cwd already exists
      const existing = getWorkspaceByCwd(cwd);
      if (existing) {
        // If already exists, just set it as active if requested
        if (isActive) {
          setActiveWorkspace(existing.id);
        }
        return res.json({ ok: true, workspace: { ...existing, isActive: isActive ?? existing.isActive } });
      }
      
      const workspace = createWorkspace({
        id,
        cwd,
        name,
        isActive: isActive ?? false,
        createdAt: Date.now(),
      });
      
      if (isActive) {
        setActiveWorkspace(workspace.id);
      }
      
      res.json({ ok: true, workspace });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  // Set active workspace
  app.put("/api/workspaces/:id/active", (req, res) => {
    try {
      setActiveWorkspace(req.params.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  // Delete a workspace
  app.delete("/api/workspaces/:id", (req, res) => {
    try {
      const deleted = deleteWorkspace(req.params.id);
      if (!deleted) {
        return res.status(404).json({ ok: false, error: "Workspace not found" });
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  // ==================== End Workspace APIs ====================

  // ==================== Editor state APIs (last opened file per root) ====================

  app.get("/api/editor/last", (req, res) => {
    try {
      const root = String(req.query.root ?? "");
      if (!root) {
        return res.status(400).json({ ok: false, error: "Missing root parameter" });
      }
      const filePath = getLastOpenedFile(root);
      res.json({ ok: true, filePath });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.post("/api/editor/last", (req, res) => {
    try {
      const { root, filePath } = req.body;
      if (!root || !filePath) {
        return res.status(400).json({ ok: false, error: "Missing root or filePath" });
      }
      validatePathInRoots(filePath, roots);
      setLastOpenedFile(root, filePath);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  // ==================== End Editor state APIs ====================

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

  server.listen(port, "0.0.0.0", () => {});
}

main().catch(() => {
  process.exit(1);
});

