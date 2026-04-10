import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendRecording, initSessionRecording } from "./recording.js";
import { snapshotManager } from "./snapshotManager.js";
import type { Session } from "./session.js";

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

export interface CustomCliSession extends Session {
  id: string;
  pty: ReturnType<Pty["spawn"]>;
  cwd: string;
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

export class CustomCliManager {
  sessions = new Map<string, CustomCliSession>();
  private seq = 0;
  private maxSessions: number;
  private validateCwd: (cwd: string) => Promise<string>;
  private send: (msg: any) => void;

  constructor(opts: {
    maxSessions: number;
    validateCwd: (cwd: string) => Promise<string>;
    send: (msg: any) => void;
  }) {
    this.maxSessions = opts.maxSessions;
    this.validateCwd = opts.validateCwd;
    this.send = opts.send;
  }

  private buildShellInvocation(command: string, argsText?: string): { shell: string; input: string } {
    const trimmedArgs = argsText?.trim();
    if (process.platform === "win32") {
      const escapedCommand = command.replace(/'/g, "''");
      const input = trimmedArgs ? `& '${escapedCommand}' ${trimmedArgs}\r` : `& '${escapedCommand}'\r`;
      return { shell: "powershell.exe", input };
    }

    const escapedCommand = command.replace(/'/g, `'\\''`);
    const input = trimmedArgs ? `'${escapedCommand}' ${trimmedArgs}\r` : `'${escapedCommand}'\r`;
    return { shell: "bash", input };
  }

  async open(
    cwd: string,
    cols: number,
    rows: number,
    command: string,
    argsText?: string,
  ): Promise<CustomCliSession> {
    if (this.sessions.size >= this.maxSessions) {
      throw new Error("Too many sessions");
    }

    const realCwd = await this.validateCwd(cwd);
    const id = `custom-${Date.now()}-${++this.seq}`;

    const pty = await loadPty();
    const { shell, input } = this.buildShellInvocation(command, argsText);
    
    const proc = pty.spawn(shell, [], {
      name: "xterm-color",
      cols,
      rows,
      cwd: realCwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      },
    });

    const stdoutPath = initSessionRecording(id);
    await snapshotManager.create(id, cols, rows);

    const session: CustomCliSession = {
      id,
      pty: proc,
      cwd: realCwd,
    };

    this.send({
      t: "term.data",
      sessionId: id,
      data: `[${command}] PTY 已启动…\r\n`,
    });

    // Start the custom CLI immediately
    proc.write(input);

    proc.onData((data: string) => {
      appendRecording(stdoutPath, data);
      snapshotManager.write(id, data);
      this.send({ t: "term.data", sessionId: id, data });
    });

    proc.onExit(({ exitCode }: { exitCode?: number }) => {
      this.send({ t: "term.exit", sessionId: id, code: exitCode ?? 0 });
      this.sessions.delete(id);
      snapshotManager.dispose(id);
    });

    this.sessions.set(id, session);
    return session;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  close(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    try {
      s.pty.kill();
    } catch {}
    this.sessions.delete(sessionId);
    snapshotManager.dispose(sessionId);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    try {
      s.pty.resize(cols, rows);
    } catch {}
    snapshotManager.resize(sessionId, cols, rows);
  }

  stdin(sessionId: string, data: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    try {
      s.pty.write(data);
    } catch {}
  }
}
