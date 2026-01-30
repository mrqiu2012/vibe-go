import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import { fileURLToPath } from "node:url";

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

type AskSession = {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  pty: ReturnType<Pty["spawn"]>;
  threadId?: string;
};

function randomId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function fileExists(p: string) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function which(binName: string): Promise<string | null> {
  try {
    const r = await execa("which", [binName]);
    const p = r.stdout.trim();
    if (p && fileExists(p)) return p;
  } catch {}
  return null;
}

async function resolveAgentBin(): Promise<string> {
  const override = process.env.AGENT_BIN;
  if (override && fileExists(override)) return override;
  const agent = await which("agent");
  if (agent) return agent;
  
  const homeAgent = path.join(process.env.HOME ?? "", ".local", "bin", "agent");
  if (fileExists(homeAgent)) return homeAgent;
  
  throw new Error('Cannot find "agent". Install Cursor CLI: curl https://cursor.com/install -fsS | bash');
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

export class AskManager {
  private sessions = new Map<string, AskSession>();

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

  async open(
    cwd: string,
    cols = 120,
    rows = 30,
    options?: {
      prompt?: string;
      resume?: string;
    },
  ) {
    if (this.sessions.size >= this.opts.maxSessions) throw new Error("Too many sessions");
    const realCwd = await this.opts.validateCwd(cwd);
    const sessionId = `ask_${randomId()}`;

    const pty = await loadPty();
    const agentBin = await resolveAgentBin();

    // Build command arguments for Ask mode
    const args: string[] = ["--mode=ask"];
    
    if (options?.resume) {
      args.push("--resume", options.resume);
    }
    
    if (options?.prompt) {
      args.push(options.prompt);
    }

    const spawnPath = [
      path.join(process.env.HOME ?? "", ".local", "bin"),
      path.dirname(agentBin),
      path.dirname(process.execPath),
      process.env.PATH ?? "",
    ]
      .filter(Boolean)
      .join(path.delimiter);

    const term = pty.spawn(agentBin, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: realCwd,
      env: {
        ...process.env,
        PATH: spawnPath,
        TERM: "xterm-256color",
        COLORTERM: process.env.COLORTERM ?? "truecolor",
        FORCE_COLOR: "1",
      },
    });

    const s: AskSession = { 
      id: sessionId, 
      cwd: realCwd, 
      cols, 
      rows, 
      pty: term,
      threadId: options?.resume || randomId() 
    };
    this.sessions.set(sessionId, s);

    term.onData((chunk: string) => this.opts.send({ t: "term.data", sessionId, data: chunk }));
    term.onExit((e: any) => {
      this.sessions.delete(sessionId);
      this.opts.send({ t: "term.exit", sessionId, code: e?.exitCode ?? 0, signal: e?.signal });
    });

    return s;
  }

  close(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.sessions.delete(sessionId);
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
  }

  stdin(sessionId: string, data: string) {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error("Unknown session");
    s.pty.write(data);
  }
}
