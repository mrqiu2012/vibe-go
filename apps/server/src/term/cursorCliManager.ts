import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { TermServerMsg } from "@vibego/protocol";
import { appendRecording, initSessionRecording } from "./recording.js";
import { snapshotManager } from "./snapshotManager.js";

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
  stdoutPath: string;
}

function fileExists(p: string) {
  try {
    // On Windows, check if file exists (no X_OK needed)
    if (process.platform === "win32") {
      return fs.existsSync(p);
    }
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
  // apps/server/src/term -> .../<repo>/apps/server/src/term
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
    if (this.sessions.size >= this.maxSessions) {
      throw new Error(`Max sessions (${this.maxSessions}) reached`);
    }

    const realCwd = await this.validateCwd(cwd);

    const pty = await loadPty();

    // Find agent binary
    const agentBin = this.resolveAgentBin();
    if (!agentBin) {
      throw new Error('Cannot find "agent" CLI. Install: curl https://cursor.com/install -fsS | bash');
    }

    // Build args
    const args: string[] = [];
    if (mode === "plan") args.push("--mode=plan");
    else if (mode === "ask") args.push("--mode=ask");

    const baseEnv = makeCleanEnv();
    // Build PATH: ensure we include all necessary paths for Windows
    // On Windows, we need to include WinGet Packages paths for tools like ripgrep
    const pathParts: string[] = [];
    
    if (process.platform === "win32") {
      // Add WinGet Packages base directory and scan for subdirectories
      const winGetPackages = process.env.LOCALAPPDATA 
        ? path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Packages") 
        : "";
      
      if (winGetPackages && fs.existsSync(winGetPackages)) {
        try {
          // Scan all package directories and their subdirectories
          const packages = fs.readdirSync(winGetPackages, { withFileTypes: true });
          for (const pkg of packages) {
            if (pkg.isDirectory()) {
              const pkgPath = path.join(winGetPackages, pkg.name);
              try {
                // Check subdirectories (versioned folders like ripgrep-15.1.0-x86_64-pc-windows-msvc)
                const subdirs = fs.readdirSync(pkgPath, { withFileTypes: true });
                for (const subdir of subdirs) {
                  if (subdir.isDirectory()) {
                    const subdirPath = path.join(pkgPath, subdir.name);
                    pathParts.push(subdirPath);
                    // Also check if this subdir contains rg.exe directly
                    const rgPath = path.join(subdirPath, "rg.exe");
                    if (fs.existsSync(rgPath)) {
                      // Ensure this path is at the front for priority
                      pathParts.unshift(subdirPath);
                    }
                  }
                }
              } catch {
                // If no subdirs, add the package directory itself
                pathParts.push(pkgPath);
              }
            }
          }
        } catch (err) {
          // If scanning fails, at least add the base directory
          if (winGetPackages) pathParts.push(winGetPackages);
        }
      }
      
      // Also try to find rg.exe directly using where.exe result (if available in current process)
      // This ensures we have the exact path that works
      try {
        const rgOutput = execSync("where.exe rg", { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).trim();
        if (rgOutput) {
          const rgPath = rgOutput.split("\n")[0].trim();
          const rgDir = path.dirname(rgPath);
          if (rgDir && fs.existsSync(rgDir) && !pathParts.includes(rgDir)) {
            // Add ripgrep directory at the front for highest priority
            pathParts.unshift(rgDir);
          }
        }
      } catch {
        // where.exe might not be available or rg not found, that's okay
      }
      
      // Add other common Windows locations
      const winPaths = [
        process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32") : "",
        process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0") : "",
        path.join(os.homedir(), ".local", "bin"),
      ].filter(Boolean);
      pathParts.push(...winPaths);
    } else {
      // Unix: add .local/bin
      pathParts.push(path.join(os.homedir(), ".local", "bin"));
    }
    
    // Add the current process PATH (should include system and user PATH)
    if (process.env.PATH) {
      pathParts.push(process.env.PATH);
    }
    
    const spawnPath = pathParts.join(path.delimiter);

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
    const stdoutPath = initSessionRecording(sessionId);
    await snapshotManager.create(sessionId, cols, rows);
    const session: Session = { id: sessionId, cwd: realCwd, mode, pty: term, stdoutPath };
    this.sessions.set(sessionId, session);

    term.onData((data: string) => {
      appendRecording(stdoutPath, data);
      snapshotManager.write(sessionId, data);
      this.send({ t: "term.data", sessionId, data });
    });

    term.onExit((e: { exitCode?: number; signal?: number }) => {
      this.send({ t: "term.exit", sessionId, code: e.exitCode });
      this.sessions.delete(sessionId);
      snapshotManager.dispose(sessionId);
    });

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
    snapshotManager.resize(sessionId, cols, rows);
  }

  close(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.sessions.delete(sessionId);
    snapshotManager.dispose(sessionId);
    try {
      s.pty.kill();
    } catch {}
  }

  private resolveAgentBin(): string | null {
    const override = process.env.AGENT_BIN;
    if (override && fileExists(override)) return override;

    // Try Windows-specific location first
    if (process.platform === "win32") {
      const localAppData = process.env.LOCALAPPDATA || process.env.USERPROFILE || "";
      if (localAppData) {
        const winAgent = path.join(localAppData, "cursor-agent", "agent.cmd");
        if (fileExists(winAgent)) return winAgent;
        
        // Also try agent.ps1
        const winAgentPs1 = path.join(localAppData, "cursor-agent", "agent.ps1");
        if (fileExists(winAgentPs1)) return winAgentPs1;
      }
    }

    // Try Unix-style location
    const homeAgent = path.join(process.env.HOME ?? "", ".local", "bin", "agent");
    if (fileExists(homeAgent)) return homeAgent;

    return null;
  }
}
