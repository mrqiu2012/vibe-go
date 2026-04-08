import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import { fileURLToPath } from "node:url";
import { appendRecording, initSessionRecording } from "./recording.js";
import { snapshotManager } from "./snapshotManager.js";

export type TermSend = (msg: any) => void;

type Pty = {
  spawn: (file: string, args: string[], opts: any) => {
    onData: (cb: (d: string) => void) => void;
    onExit: (cb: (e: { exitCode?: number; signal?: number }) => void) => void;
    write: (d: string) => void;
    resize: (cols: number, rows: number) => void;
    kill: () => void;
  };
};

type KimiPtySession = {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  pty: ReturnType<Pty["spawn"]>;
  stdoutPath: string;
};

function randomId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function fileExists(p: string) {
  try {
    if (process.platform === "win32") {
      return fs.existsSync(p);
    }
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function which(binName: string): Promise<string | null> {
  try {
    const cmd = process.platform === "win32" ? "where.exe" : "which";
    const r = await execa(cmd, [binName]);
    const p = r.stdout.trim().split("\n")[0];
    if (p && fileExists(p)) return p;
  } catch {}
  return null;
}

async function resolveKimiBin(): Promise<string> {
  const override = process.env.KIMI_BIN;
  if (override && fileExists(override)) return override;

  // Try to find kimi in PATH
  const kimi = await which("kimi");
  if (kimi) return kimi;

  // Try common installation locations
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const commonPaths = [
    path.join(homeDir, ".local", "bin", "kimi"),
    path.join(homeDir, ".local", "share", "uv", "tools", "kimi-cli", "bin", "kimi"),
    path.join(homeDir, ".cargo", "bin", "kimi"),
    "/usr/local/bin/kimi",
    "/opt/homebrew/bin/kimi",
    "/usr/bin/kimi",
  ];

  for (const p of commonPaths) {
    if (fileExists(p)) return p;
  }

  throw new Error('Cannot find "kimi". Install Kimi Code CLI (https://www.moonshot.cn/kimi-code) or set KIMI_BIN=/absolute/path/to/kimi.');
}

async function loadPty(): Promise<Pty> {
  try {
    const m = (await import("@homebridge/node-pty-prebuilt-multiarch")) as any;
    if (m?.spawn) return m as Pty;
  } catch {}

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const remotecodingDir = path.resolve(__dirname, "..", "..", "..", "..", "..");
  const fallback = path.join(
    remotecodingDir,
    "my-remote",
    "node_modules",
    "@homebridge",
    "node-pty-prebuilt-multiarch",
    "lib",
    "index.js",
  );
  const m2 = (await import(fallback)) as any;
  if (m2?.spawn) return m2 as Pty;
  throw new Error("Failed to load node-pty module");
}

export class KimiCliManager {
  private sessions = new Map<string, KimiPtySession>();

  constructor(
    private opts: {
      maxSessions: number;
      validateCwd: (cwd: string) => Promise<string>;
      send: TermSend;
    },
  ) {}

  has(sessionId: string) {
    return this.sessions.has(sessionId);
  }

  async open(cwd: string, cols = 120, rows = 30) {
    if (this.sessions.size >= this.opts.maxSessions) throw new Error("Too many sessions");
    const realCwd = await this.opts.validateCwd(cwd);
    const sessionId = `kimi_${randomId()}`;

    const pty = await loadPty();
    const kimiBin = await resolveKimiBin();

    const kimiReal = (() => {
      try {
        return fs.realpathSync(kimiBin);
      } catch {
        return kimiBin;
      }
    })();

    const cmd = kimiReal.endsWith(".js") || kimiReal.endsWith(".cjs") || kimiReal.endsWith(".mjs") ? process.execPath : kimiBin;
    const args = cmd === process.execPath ? [kimiReal] : [];

    const spawnPath = [path.dirname(kimiBin), path.dirname(process.execPath), process.env.PATH ?? ""].filter(Boolean).join(path.delimiter);

    const term = pty.spawn(cmd, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: realCwd,
      env: {
        ...process.env,
        PATH: spawnPath,
        TERM: "xterm-256color",
        COLORTERM: process.env.COLORTERM ?? "truecolor",
      },
    });

    const stdoutPath = initSessionRecording(sessionId);
    await snapshotManager.create(sessionId, cols, rows);
    const s: KimiPtySession = { id: sessionId, cwd: realCwd, cols, rows, pty: term, stdoutPath };
    this.sessions.set(sessionId, s);

    this.opts.send({
      t: "term.data",
      sessionId,
      data: `[kimi] PTY 已启动，等待 kimi 输出…\r\n`,
    });

    term.onData((chunk: string) => {
      appendRecording(stdoutPath, chunk);
      snapshotManager.write(sessionId, chunk);
      this.opts.send({ t: "term.data", sessionId, data: chunk });
    });
    term.onExit((e: any) => {
      this.sessions.delete(sessionId);
      snapshotManager.dispose(sessionId);
      this.opts.send({ t: "term.exit", sessionId, code: e?.exitCode ?? 0, signal: e?.signal });
    });

    return s;
  }

  close(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.sessions.delete(sessionId);
    snapshotManager.dispose(sessionId);
    try {
      s.pty.kill();
    } catch {}
  }

  resize(sessionId: string, cols: number, rows: number) {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error("Unknown session");
    try {
      s.pty.resize(cols, rows);
    } catch {}
    snapshotManager.resize(sessionId, cols, rows);
  }

  stdin(sessionId: string, data: string) {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error("Unknown session");
    s.pty.write(data);
  }
}
