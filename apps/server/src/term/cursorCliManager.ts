import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TermServerMsg } from "../../../protocol/src/messages.js";

type SendFn = (msg: TermServerMsg) => void;

type Pty = {
  spawn: (file: string, args: string[], opts: any) => {
    onData: (cb: (d: string) => void) => void;
    onExit: (cb: (e: { exitCode?: number; signal?: number }) => void) => void;
    write: (d: string) => void;
    resize: (cols: number, rows: number) => void;
    kill: () => void;
    pid?: number;
  };
};

interface Session {
  id: string;
  cwd: string;
  mode: "agent" | "plan" | "ask";
  pty: any;
}

function fileExists(p: string) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function makeCleanEnv() {
  const baseEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null) continue;
    if (k.startsWith("CURSOR_")) continue;
    if (k.startsWith("VSCODE_")) continue;
    baseEnv[k] = String(v);
  }
  return baseEnv;
}

async function loadPty(): Promise<Pty> {
  // Prefer local dependency (if it can load on this Node).
  try {
    const m = (await import("@homebridge/node-pty-prebuilt-multiarch")) as any;
    if (m?.spawn) return m as Pty;
  } catch {}

  // Fallback: reuse my-remote's built pty module (works in this environment).
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // apps/server/src/term -> .../web-ide-local/apps/server/src/term
  // go up to .../remotecoding, then sibling my-remote/
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
  throw new Error("Failed to load PTY module (node-pty)");
}

export class CursorCliManager {
  private sessions = new Map<string, Session>();
  private maxSessions: number;
  private validateCwd: (p: string) => Promise<string>;
  private send: SendFn;

  constructor(opts: { maxSessions: number; validateCwd: (p: string) => Promise<string>; send: SendFn }) {
    this.maxSessions = opts.maxSessions;
    this.validateCwd = opts.validateCwd;
    this.send = opts.send;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async open(cwd: string, cols: number, rows: number, mode: "agent" | "plan" | "ask" = "agent"): Promise<Session> {
    console.log(`[CursorCliManager] open() called`, { cwd, cols, rows, mode });
    
    if (this.sessions.size >= this.maxSessions) {
      throw new Error(`Max sessions (${this.maxSessions}) reached`);
    }

    const realCwd = await this.validateCwd(cwd);
    console.log(`[CursorCliManager] validated cwd:`, realCwd);

    console.log(`[CursorCliManager] loading PTY module...`);
    const pty = await loadPty();
    console.log(`[CursorCliManager] PTY loaded`);

    // Find agent binary
    const agentBin = this.resolveAgentBin();
    console.log(`[CursorCliManager] agent binary:`, agentBin);
    if (!agentBin) {
      throw new Error('Cannot find "agent" CLI. Install: curl https://cursor.com/install -fsS | bash');
    }

    // Build args
    const args: string[] = [];
    if (mode === "plan") args.push("--mode=plan");
    else if (mode === "ask") args.push("--mode=ask");

    const baseEnv = makeCleanEnv();
    const spawnPath = [path.join(process.env.HOME ?? "", ".local", "bin"), process.env.PATH ?? ""]
      .filter(Boolean)
      .join(path.delimiter);

    console.log(`[CursorCliManager] spawning agent`, { agentBin, args, cwd: realCwd, cols, rows });
    const term = pty.spawn(agentBin, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: realCwd,
      env: {
        ...baseEnv,
        PATH: spawnPath,
        HOME: process.env.HOME,
        USER: process.env.USER,
        SHELL: process.env.SHELL,
        TERM: "xterm-256color",
        COLORTERM: process.env.COLORTERM ?? "truecolor",
        FORCE_COLOR: "1",
        LANG: process.env.LANG ?? "en_US.UTF-8",
      },
    });

    const sessionId = `cursor-cli-${mode}_${Math.random().toString(16).slice(2)}`;
    const session: Session = { id: sessionId, cwd: realCwd, mode, pty: term };
    this.sessions.set(sessionId, session);
    console.log(`[CursorCliManager] session created:`, { sessionId, pid: (term as any).pid });

    term.onData((data: string) => {
      const preview = data.length > 100 ? data.slice(0, 100) + "..." : data;
      console.log(`[CursorCliManager] data from ${sessionId}:`, { bytes: data.length, preview });
      this.send({ t: "term.data", sessionId, data });
    });

    term.onExit((e: { exitCode: number; signal?: number }) => {
      console.log(`[CursorCliManager] exit ${sessionId}:`, e);
      this.send({ t: "term.exit", sessionId, code: e.exitCode });
      this.sessions.delete(sessionId);
    });

    console.log(`[CursorCliManager] open() complete, returning session`);
    return session;
  }

  stdin(sessionId: string, data: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.pty.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    try {
      s.pty.resize(cols, rows);
    } catch {}
  }

  close(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.sessions.delete(sessionId);
    try {
      s.pty.kill();
    } catch {}
  }

  private resolveAgentBin(): string | null {
    const override = process.env.AGENT_BIN;
    if (override && fileExists(override)) return override;

    const homeAgent = path.join(process.env.HOME ?? "", ".local", "bin", "agent");
    if (fileExists(homeAgent)) return homeAgent;

    return null;
  }
}
