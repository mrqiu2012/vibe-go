import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import os from "node:os";
import express from "express";
import type { Request } from "express";
import type { Response } from "express";
import cors from "cors";
import { execa } from "execa";

import { loadConfig } from "./config.js";
import { normalizeRoots, validatePathInRoots } from "./pathGuard.js";
import { listDir, readTextFile, writeTextFile, createDir } from "./fsApi.js";
import { attachTermWs } from "./term/wsTerm.js";
import { snapshotManager } from "./term/snapshotManager.js";
import { executeCursorAgent, spawnCursorAgentStream, listCursorModels } from "./cursorAgent.js";
import {
  getDb,
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
  getActiveRoot,
  setActiveRoot,
  type ChatSession,
  type Message,
  type Workspace,
} from "./db.js";

const SESSION_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function getRepoRoot() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // apps/server/src or apps/server/dist -> repo root
  return path.resolve(__dirname, "..", "..", "..");
}

function isLoopbackReq(req: Request) {
  const ra = req.socket.remoteAddress || "";
  return (
    ra === "127.0.0.1" ||
    ra === "::1" ||
    ra === "::ffff:127.0.0.1" ||
    ra.toLowerCase() === "::ffff:7f00:1"
  );
}

/** 是否为本机请求（含 loopback 或本机 LAN IP），用于选择根目录等需在本机弹窗的接口 */
function isLocalReq(req: Request): boolean {
  if (isLoopbackReq(req)) return true;
  const ra = (req.socket.remoteAddress || "").replace(/^::ffff:/i, "");
  if (!ra) return false;
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    const nets = ifaces[name];
    if (!nets) continue;
    for (const net of nets) {
      if (net.family === "IPv4" && net.address === ra) return true;
      if (net.family === "IPv6" && net.address === req.socket.remoteAddress) return true;
    }
  }
  return false;
}

function fileExists(p: string) {
  try {
    if (process.platform === "win32") return fs.existsSync(p);
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function whichBin(binName: string): Promise<string | null> {
  try {
    const cmd = process.platform === "win32" ? "where.exe" : "which";
    const r = await execa(cmd, [binName], { timeout: 3000 });
    const p = r.stdout.trim().split("\n")[0];
    if (p && fileExists(p)) return p;
  } catch {}
  return null;
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

async function checkCmdVersion(bin: string, args: string[] = ["--version"]) {
  const p = await whichBin(bin);
  if (!p) return { ok: false as const, path: null as string | null, version: null as string | null, error: "not found" };
  try {
    const r = await execa(p, args, {
      timeout: 5000,
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`,
      },
    });
    const v = (r.stdout || r.stderr || "").trim();
    return { ok: true as const, path: p, version: v || null, error: null as string | null };
  } catch (e: any) {
    return { ok: false as const, path: p, version: null as string | null, error: e?.shortMessage ?? e?.message ?? String(e) };
  }
}

type SetupInstallTool = "agent" | "rg" | "codex";

function getInstallHint(tool: SetupInstallTool) {
  // Keep these as display hints for the UI. Execution uses a separate mapping below.
  if (tool === "agent") {
    return process.platform === "win32"
      ? "irm 'https://cursor.com/install?win32=true' | iex"
      : "curl https://cursor.com/install -fsS | bash";
  }
  if (tool === "rg") {
    if (process.platform === "darwin") return "brew install ripgrep";
    if (process.platform === "win32") return "winget install --id BurntSushi.ripgrep.MSVC -e --accept-source-agreements --accept-package-agreements";
    // linux is distro-dependent; leave as a hint only
    return "Install ripgrep (rg) via your package manager, e.g. apt/dnf/pacman";
  }
  // codex
  return "npm i -g @openai/codex";
}

async function canAutoInstall(tool: SetupInstallTool): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (tool === "agent") {
    const hasCurl = process.platform === "win32" ? true : Boolean(await whichBin("curl"));
    const hasBash = process.platform === "win32" ? true : Boolean(await whichBin("bash"));
    if (process.platform !== "win32" && (!hasCurl || !hasBash)) {
      return { ok: false, reason: `Missing required tools for auto install: ${!hasCurl ? "curl " : ""}${!hasBash ? "bash" : ""}`.trim() };
    }
    if (process.platform === "win32") {
      const hasPs = Boolean(await whichBin("powershell"));
      if (!hasPs) return { ok: false, reason: "Missing PowerShell (powershell.exe) in PATH" };
    }
    return { ok: true };
  }

  if (tool === "rg") {
    if (process.platform === "darwin") {
      const hasBrew = Boolean(await whichBin("brew"));
      if (!hasBrew) return { ok: false, reason: "Homebrew not found (brew). Install it first or install rg manually." };
      return { ok: true };
    }
    if (process.platform === "win32") {
      const hasWinget = Boolean(await whichBin("winget"));
      if (!hasWinget) return { ok: false, reason: "winget not found. Install ripgrep manually or add winget." };
      return { ok: true };
    }
    return { ok: false, reason: "Auto install for rg is not supported on this platform in setup (distro-specific)." };
  }

  // codex
  const hasNpm = Boolean(await whichBin(process.platform === "win32" ? "npm.cmd" : "npm")) || Boolean(await whichBin("npm"));
  if (!hasNpm) return { ok: false, reason: "npm not found. Install Node.js (includes npm) first." };
  return { ok: true };
}

async function runAutoInstall(tool: SetupInstallTool) {
  const timeout = 10 * 60 * 1000;
  const env = {
    ...process.env,
    PATH: [path.join(process.env.HOME ?? "", ".local", "bin"), process.env.PATH ?? ""].filter(Boolean).join(path.delimiter),
  };

  if (tool === "agent") {
    if (process.platform === "win32") {
      // Use PowerShell installer recommended by Cursor.
      const cmd = "irm 'https://cursor.com/install?win32=true' | iex";
      return await execa("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd], {
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        env,
      });
    }
    const cmd = "curl https://cursor.com/install -fsS | bash";
    return await execa("bash", ["-lc", cmd], {
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      env,
    });
  }

  if (tool === "rg") {
    if (process.platform === "darwin") {
      return await execa("brew", ["install", "ripgrep"], { timeout, maxBuffer: 10 * 1024 * 1024, env });
    }
    if (process.platform === "win32") {
      return await execa(
        "winget",
        ["install", "--id", "BurntSushi.ripgrep.MSVC", "-e", "--accept-source-agreements", "--accept-package-agreements"],
        { timeout, maxBuffer: 10 * 1024 * 1024, env },
      );
    }
    throw new Error("Auto install for rg is not supported on this platform.");
  }

  // codex
  return await execa("npm", ["i", "-g", "@openai/codex"], { timeout, maxBuffer: 10 * 1024 * 1024, env });
}

async function chooseDirectoryNative(promptText: string) {
  if (process.platform === "darwin") {
    // Returns POSIX path with trailing slash. Exit code 1 on cancel.
    const script = `POSIX path of (choose folder with prompt "${promptText.replace(/"/g, '\\"')}")`;
    const r = await execa("osascript", ["-e", script], { timeout: 300000 });
    const out = String(r.stdout || "").trim();
    return out;
  }
  if (process.platform === "win32") {
    const ps = [
      "Add-Type -AssemblyName System.Windows.Forms;",
      "$d = New-Object System.Windows.Forms.FolderBrowserDialog;",
      `$d.Description = "${promptText.replace(/"/g, '""')}";`,
      "$r = $d.ShowDialog();",
      "if ($r -ne [System.Windows.Forms.DialogResult]::OK) { exit 1 }",
      "Write-Output $d.SelectedPath;",
    ].join(" ");
    // -Sta: Single Thread Apartment required for System.Windows.Forms dialog to show
    const r = await execa("powershell", ["-Sta", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
      timeout: 300000,
      windowsHide: false,
    });
    return String(r.stdout || "").trim();
  }
  // linux: best-effort (requires zenity)
  const r = await execa("zenity", ["--file-selection", "--directory", "--title", promptText], { timeout: 300000 });
  return String(r.stdout || "").trim();
}

async function main() {
  const repoRoot = getRepoRoot();
  const configPath = process.env.CONFIG_PATH ?? path.join(repoRoot, "config", "config.json");
  const setupDonePath = path.join(path.dirname(configPath), ".setup-done");
  const cfg = await loadConfig(configPath);
  let roots = await normalizeRoots(cfg.roots);

  // Check for Cursor Agent CLI availability
  await checkAgentCli();

  const port = Number(cfg.server?.port ?? process.env.PORT ?? 3990);
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
    // Allow localhost and 127.0.0.1
    if (origin === "http://localhost:3989") return true;
    if (origin === "http://127.0.0.1:3989") return true;
    if (origin === `http://localhost:${port}`) return true;
    if (origin === `http://127.0.0.1:${port}`) return true;
    // Allow LAN access (any IP address on ports 3989 or backend port)
    if (/^http:\/\/(\d{1,3}\.){3}\d{1,3}:(3989|3990)$/.test(origin)) return true;
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
    try {
      res.json({ ok: true, roots });
    } catch (e: any) {
      console.error("[api/roots]", e);
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.get("/api/setup/check", async (req, res) => {
    try {
      const tools = {
        codex: await checkCmdVersion("codex", ["--version"]),
        cursor: await checkCmdVersion("cursor", ["--version"]),
        agent: await checkCmdVersion("agent", ["--version"]),
        rg: await checkCmdVersion("rg", ["--version"]),
      };

      // Cursor desktop app best-effort checks (macOS)
      const cursorAppPaths =
        process.platform === "darwin"
          ? ["/Applications/Cursor.app", path.join(os.homedir(), "Applications", "Cursor.app")].filter((p) => fs.existsSync(p))
          : [];

      res.json({
        ok: true,
        platform: process.platform,
        configPath,
        roots,
        setupDone: fs.existsSync(setupDonePath),
        tools,
        cursorAppPaths,
        installHints: {
          agent: getInstallHint("agent"),
          rg: getInstallHint("rg"),
          codex: getInstallHint("codex"),
        },
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  // 确保数据库已创建并应用 schema（安装第三步）
  app.get("/api/setup/ensure-db", (_req, res) => {
    try {
      getDb();
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  // 完成安装：写入 .setup-done，之后可进入正式功能
  app.post("/api/setup/complete", (req, res) => {
    try {
      fs.writeFileSync(
        setupDonePath,
        JSON.stringify({ doneAt: Date.now() }) + "\n",
        "utf8",
      );
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.post("/api/setup/install", async (req, res) => {
    if (!isLocalReq(req)) return res.status(403).json({ ok: false, error: "仅允许本机访问" });
    try {
      const tool = String((req.body as any)?.tool ?? "") as SetupInstallTool;
      if (tool !== "agent" && tool !== "rg" && tool !== "codex") {
        return res.status(400).json({ ok: false, error: "Invalid tool" });
      }

      const support = await canAutoInstall(tool);
      if (!support.ok) {
        return res.status(400).json({ ok: false, error: support.reason, hint: getInstallHint(tool) });
      }

      const r = await runAutoInstall(tool);

      const after =
        tool === "agent"
          ? await checkCmdVersion("agent", ["--version"])
          : tool === "rg"
            ? await checkCmdVersion("rg", ["--version"])
            : await checkCmdVersion("codex", ["--version"]);

      res.json({
        ok: true,
        tool,
        hint: getInstallHint(tool),
        stdout: r.stdout ?? "",
        stderr: r.stderr ?? "",
        exitCode: typeof r.exitCode === "number" ? r.exitCode : 0,
        after,
      });
    } catch (e: any) {
      const msg = e?.shortMessage ?? e?.message ?? String(e);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // 可选文件夹列表（用户主目录及其直接子目录），供前端 HTML select 选择
  app.get("/api/setup/folder-options", async (_req, res) => {
    try {
      const home = os.homedir();
      const paths: string[] = [home];
      try {
        const names = await fs.promises.readdir(home, { withFileTypes: true });
        for (const e of names) {
          if (!e.isDirectory() || e.name.startsWith(".")) continue;
          const full = path.join(home, e.name);
          try {
            const st = await fs.promises.stat(full);
            if (st.isDirectory()) paths.push(full);
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* only home */
      }
      paths.sort((a, b) => a.localeCompare(b));
      res.json({ ok: true, paths });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.post("/api/setup/add-root", async (req, res) => {
    if (!isLocalReq(req)) return res.status(403).json({ ok: false, error: "仅允许本机访问" });
    try {
      const rootRaw = String((req.body as any)?.root ?? "");
      const setActive = Boolean((req.body as any)?.setActive ?? true);
      if (!rootRaw) return res.status(400).json({ ok: false, error: "Missing root" });

      // Validate it's a directory and normalize.
      const norm = (await normalizeRoots([rootRaw]))[0];

      const raw = await fs.promises.readFile(configPath, "utf8");
      const parsed = JSON.parse(raw) as any;
      const existing = Array.isArray(parsed?.roots) ? parsed.roots.map(String) : [];
      const merged = Array.from(new Set([...existing, norm]));
      parsed.roots = merged;

      await fs.promises.writeFile(configPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");

      // Mark setup as done (local flag file, git-ignored)
      try {
        await fs.promises.writeFile(
          setupDonePath,
          JSON.stringify({ doneAt: Date.now() }) + "\n",
          "utf8",
        );
      } catch {}

      // Refresh in-memory roots for this running server.
      roots = await normalizeRoots(parsed.roots);

      if (setActive) {
        try {
          setActiveRoot(norm);
        } catch {}
      }

      res.json({ ok: true, roots, activeRoot: setActive ? norm : getActiveRoot(), configPath });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.get("/api/app/active-root", (_req, res) => {
    try {
      const root = getActiveRoot();
      res.json({ ok: true, root });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.post("/api/app/active-root", (req, res) => {
    try {
      const root = String((req.body as any)?.root ?? "");
      if (!root) return res.status(400).json({ ok: false, error: "Missing root" });
      setActiveRoot(root);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.get("/api/term/replay/:sessionId", (req, res) => {
    const sessionId = String(req.params.sessionId || "");
    if (!SESSION_ID_REGEX.test(sessionId)) {
      res.status(400).json({ error: "invalid session id" });
      return;
    }
    const tailBytes = Math.max(1024, Math.min(Number(req.query.tailBytes ?? 20000), 200000));
    const baseDir = path.join(os.homedir(), ".vibego", "term", sessionId);
    const stdoutPath = path.join(baseDir, "stdout");
    try {
      if (!fs.existsSync(stdoutPath)) {
        res.status(404).json({ error: "not found" });
        return;
      }
      const stats = fs.statSync(stdoutPath);
      const size = stats.size;
      const start = Math.max(0, size - tailBytes);
      const fd = fs.openSync(stdoutPath, "r");
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.send(buf.toString("utf8"));
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? String(e) });
    }
  });

  app.get("/api/term/sessions", (_req, res) => {
    try {
      const limitRaw = Number(_req.query.limit ?? 50);
      const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 50, 200));
      const base = path.join(os.homedir(), ".vibego", "term");
      if (!fs.existsSync(base)) return res.json({ ok: true, sessions: [] });

      const rows: Array<{ sessionId: string; updatedAt: number; sizeBytes: number }> = [];
      const entries = fs.readdirSync(base, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const sessionId = ent.name;
        if (!SESSION_ID_REGEX.test(sessionId)) continue;
        const stdoutPath = path.join(base, sessionId, "stdout");
        if (!fs.existsSync(stdoutPath)) continue;
        try {
          const st = fs.statSync(stdoutPath);
          rows.push({ sessionId, updatedAt: st.mtimeMs, sizeBytes: st.size });
        } catch {}
      }
      rows.sort((a, b) => b.updatedAt - a.updatedAt);
      res.json({ ok: true, sessions: rows.slice(0, limit) });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.get("/api/term/snapshot/:sessionId", (req, res) => {
    const sessionId = String(req.params.sessionId || "");
    if (!SESSION_ID_REGEX.test(sessionId)) {
      res.status(400).json({ error: "invalid session id" });
      return;
    }
    const tailBytes = Math.max(1024, Math.min(Number(req.query.tailBytes ?? 20000), 200000));
    void (async () => {
      try {
        const snap = await snapshotManager.snapshotText(sessionId);
        if (snap) {
          res.json({ ok: true, cols: snap.cols, rows: snap.rows, data: snap.text });
          return;
        }
      } catch {}

      const baseDir = path.join(os.homedir(), ".vibego", "term", sessionId);
      const stdoutPath = path.join(baseDir, "stdout");
      try {
        if (!fs.existsSync(stdoutPath)) {
          res.status(404).json({ error: "not found" });
          return;
        }
        const stats = fs.statSync(stdoutPath);
        const size = stats.size;
        const start = Math.max(0, size - tailBytes);
        const fd = fs.openSync(stdoutPath, "r");
        const buf = Buffer.alloc(size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        fs.closeSync(fd);
        res.json({ ok: true, data: buf.toString("utf8") });
      } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message ?? String(e) });
      }
    })();
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

  app.post("/api/mkdir", async (req, res) => {
    try {
      const p = String(req.body?.path ?? "");
      const r = await createDir(roots, p);
      res.json({ ok: true, ...r });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.get("/api/cursor-agent/models", async (_req, res) => {
    try {
      const models = await listCursorModels();
      res.json({ ok: true, models });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.post("/api/cursor-agent", async (req, res) => {
    try {
      const prompt = String(req.body?.prompt ?? "");
      const mode = String(req.body?.mode ?? "agent") as "agent" | "plan" | "ask";
      const cwd = String(req.body?.cwd ?? roots[0] ?? "");
      const model = typeof req.body?.model === "string" ? String(req.body.model).trim() || undefined : undefined;

      if (!prompt.trim()) {
        return res.status(400).json({ ok: false, error: "Missing prompt" });
      }

      // Validate cwd is in roots
      const realCwd = await validatePathInRoots(cwd, roots);

      const result = await executeCursorAgent(prompt, mode, realCwd, model);
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
      const model = typeof req.body?.model === "string" ? String(req.body.model).trim() || undefined : undefined;

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
        model,
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

  // 方案 A：按 runId 停止（用户点击停止时调用）
  app.post("/api/cursor-agent/stream/:runId/stop", (req, res) => {
    const runId = req.params.runId;
    const run = agentRuns.get(runId);
    if (!run) {
      return res.status(404).json({ ok: false, error: "Run not found or already finished" });
    }
    try {
      run.stop();
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
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
      const model = typeof req.body?.model === "string" ? String(req.body.model).trim() || undefined : undefined;

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
        model,
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
      console.error("[api/workspaces]", e);
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

  // In production, you can optionally serve the built web app from apps/web/dist:
  // const webDist = path.join(repoRoot, "apps", "web", "dist");
  // app.use(express.static(webDist));
  // app.get("/", (_req, res) => res.sendFile(path.join(webDist, "index.html")));

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
    const networkInterfaces = os.networkInterfaces();
    const localIPs: string[] = [];
    
    for (const name of Object.keys(networkInterfaces)) {
      const nets = networkInterfaces[name];
      if (nets) {
        for (const net of nets) {
          // Skip internal (i.e. 127.0.0.1) and non-IPv4 addresses
          if (net.family === "IPv4" && !net.internal) {
            localIPs.push(net.address);
          }
        }
      }
    }
    
    console.log(`✅ Server running on 0.0.0.0:${port}`);
    console.log(`   Local:   http://localhost:${port}/`);
    if (localIPs.length > 0) {
      console.log(`   Network: http://${localIPs[0]}:${port}/`);
      if (localIPs.length > 1) {
        localIPs.slice(1).forEach(ip => {
          console.log(`            http://${ip}:${port}/`);
        });
      }
    }
    console.log(`   API:     http://localhost:${port}/api/*`);
    console.log(`   WebSocket: ws://localhost:${port}/ws/term`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down gracefully...`);
    server.close(() => {
      console.log("HTTP server closed");
      process.exit(0);
    });
    // Force close after 10 seconds
    setTimeout(() => {
      console.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Handle uncaught errors
  process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception:", err);
    // Don't exit immediately, let the server try to recover
  });

  process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
    // Don't exit immediately
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
