import fs from "node:fs";
import path from "node:path";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import readline from "node:readline";
import { execa } from "execa";

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

async function which(binName: string): Promise<string | null> {
  try {
    // On Windows, use where.exe instead of which
    const cmd = process.platform === "win32" ? "where.exe" : "which";
    const r = await execa(cmd, [binName]);
    const p = r.stdout.trim().split("\n")[0]; // Take first result on Windows
    if (p && fileExists(p)) return p;
  } catch {}
  return null;
}

async function resolveAgentBin(): Promise<string> {
  const override = process.env.AGENT_BIN;
  if (override && fileExists(override)) return override;
  
  // Try to find agent in PATH
  const agent = await which("agent");
  if (agent) return agent;

  // Try Windows-specific location
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || process.env.USERPROFILE || "";
    const winAgent = path.join(localAppData, "cursor-agent", "agent.cmd");
    if (fileExists(winAgent)) return winAgent;
    
    // Also try agent.ps1
    const winAgentPs1 = path.join(localAppData, "cursor-agent", "agent.ps1");
    if (fileExists(winAgentPs1)) return winAgentPs1;
  }

  // Try Unix-style location
  const homeAgent = path.join(process.env.HOME ?? "", ".local", "bin", "agent");
  if (fileExists(homeAgent)) return homeAgent;

  const installCmd = process.platform === "win32" 
    ? "irm 'https://cursor.com/install?win32=true' | iex"
    : "curl https://cursor.com/install -fsS | bash";
  throw new Error(`Cannot find "agent". Install Cursor CLI: ${installCmd}`);
}

function makeCleanEnv() {
  // Agent behaves differently when launched inside Cursor (CURSOR_*/VSCODE_* env vars).
  // Strip those so the CLI runs like in a normal terminal.
  const baseEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null) continue;
    if (k.startsWith("CURSOR_")) continue;
    if (k.startsWith("VSCODE_")) continue;
    baseEnv[k] = String(v);
  }
  return baseEnv;
}

/** Windows 上 ripgrep (rg) 常见安装目录，agent 子进程需在 PATH 中才能找到 rg */
function getRgCandidatePathsWin(): string[] {
  const dirs: string[] = [];
  const pf = process.env["ProgramFiles"] || "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const local = process.env.LOCALAPPDATA || "";
  const user = process.env.USERPROFILE || process.env.HOME || "";
  dirs.push(path.join(pf, "ripgrep"));
  dirs.push(path.join(pf86, "ripgrep"));
  if (local) dirs.push(path.join(local, "Programs", "ripgrep"));
  if (user) {
    dirs.push(path.join(user, "scoop", "apps", "ripgrep", "current"));
    dirs.push(path.join(user, ".cargo", "bin"));
  }
  return dirs.filter((d) => d.length > 0);
}

/**
 * Windows: 从注册表读取与 CMD 一致的 PATH（用户 + 系统），
 * 这样 spawn 出的 agent 能找到 rg/agent，与在 CMD 里直接运行效果一致。
 */
function getWindowsPathFromRegistry(): string {
  const pathSep = path.delimiter;
  const parts: string[] = [];
  try {
    const userPath = execSync('reg query "HKCU\\Environment" /v Path 2>nul', { encoding: "utf8", windowsHide: true });
    const sysPath = execSync('reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" /v Path 2>nul', {
      encoding: "utf8",
      windowsHide: true,
    });
    const parseRegPath = (out: string): string[] => {
      const line = out.split(/\r?\n/).find((l) => l.includes("Path") && l.includes("REG_"));
      if (!line) return [];
      const regIdx = line.indexOf("REG_");
      const value = regIdx >= 0 ? line.slice(regIdx).replace(/^REG_\w+\s+/, "").trim() : "";
      return value ? value.split(pathSep).map((p) => p.trim()).filter(Boolean) : [];
    };
    parts.push(...parseRegPath(userPath), ...parseRegPath(sysPath));
  } catch {
    // 读注册表失败时退回当前进程 PATH
    const current = process.env.PATH || "";
    if (current) parts.push(...current.split(pathSep).filter(Boolean));
  }
  const extra = getRgCandidatePathsWin();
  const seen = new Set<string>(extra.map((p) => path.resolve(p).toLowerCase()));
  for (const p of parts) {
    const r = path.resolve(p).toLowerCase();
    if (!seen.has(r)) {
      seen.add(r);
      extra.push(p);
    }
  }
  return extra.join(pathSep);
}

function getSpawnPath(): string {
  if (process.platform === "win32") {
    return getWindowsPathFromRegistry();
  }
  const pathSep = ":";
  const extra = [path.join(process.env.HOME ?? "", ".local", "bin")];
  const base = process.env.PATH || "";
  return [...extra.filter(Boolean), base].join(pathSep);
}

export type CursorModelOption = { id: string; label: string };

export async function listCursorModels(): Promise<CursorModelOption[]> {
  const agentBin = await resolveAgentBin();
  const baseEnv = makeCleanEnv();
  try {
    const result = await execa(agentBin, ["--list-models"], {
      env: {
        ...baseEnv,
        PATH: getSpawnPath(),
        HOME: process.env.HOME,
        USER: process.env.USER,
        SHELL: process.env.SHELL,
        LANG: process.env.LANG ?? "en_US.UTF-8",
      },
      timeout: 10000,
    });
    const lines = (result.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean);
    const list: CursorModelOption[] = [];
    for (const line of lines) {
      if (line === "Available models" || line.startsWith("Tip:")) continue;
      const dash = line.indexOf(" - ");
      if (dash > 0) {
        const id = line.slice(0, dash).trim();
        let label = line.slice(dash + 3).trim();
        label = label.replace(/\s*\(current\)\s*$/i, "").replace(/\s*\(default\)\s*$/i, "");
        if (id) list.push({ id, label: label || id });
      }
    }
    return list.length ? list : [{ id: "auto", label: "Auto" }];
  } catch {
    return [{ id: "auto", label: "Auto" }];
  }
}

export async function executeCursorAgent(
  prompt: string,
  mode: "agent" | "plan" | "ask",
  cwd: string,
  model?: string,
) {
  const agentBin = await resolveAgentBin();
  const modelArg = (model && model.trim()) || "auto";
  const args = ["-p", prompt, "--output-format", "json", `--model=${modelArg}`];

  if (mode === "plan") args.push("--mode=plan");
  if (mode === "ask") args.push("--mode=ask");

  const baseEnv = makeCleanEnv();

  try {
    const result = await execa(agentBin, args, {
      cwd,
      timeout: 300000, // 5 minutes - cursor agent tools can take a while
      env: {
        ...baseEnv,
        PATH: getSpawnPath(),
        HOME: process.env.HOME,
        USER: process.env.USER,
        SHELL: process.env.SHELL,
        LANG: process.env.LANG ?? "en_US.UTF-8",
      },
      // Kill entire process group on timeout
      killSignal: "SIGKILL",
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  } catch (error: any) {
    // Handle timeout
    if (error.timedOut) {
      throw new Error(
        "Cursor Agent timed out after 5 minutes. This could mean the task is too complex, " +
        "or authentication is required. Please run 'agent login' in your terminal first."
      );
    }

    // Handle other errors
    if (error.stderr && error.stderr.includes("login")) {
      throw new Error(
        "Cursor Agent requires authentication. Please run 'agent login' in your terminal."
      );
    }

    throw new Error(`Agent failed: ${error.message}${error.stderr ? `\n${error.stderr}` : ""}`);
  }
}

function killProcessTree(child: ChildProcess) {
  // Best-effort: kill process group (detached) first; fall back to direct kill.
  const pid = child.pid;
  if (!pid) return;
  try {
    process.kill(-pid, "SIGKILL");
    return;
  } catch {}
  try {
    child.kill("SIGKILL");
  } catch {}
}

export type SpawnCursorAgentStreamOpts = {
  prompt: string;
  mode: "agent" | "plan" | "ask";
  cwd: string;
  force: boolean;
  model?: string;
  resume?: string;
  timeoutMs?: number;
  onStdoutLine: (line: string) => void;
  onStderrLine?: (line: string) => void;
  onExit?: (info: { code: number | null; signal: NodeJS.Signals | null; timedOut: boolean }) => void;
};

/**
 * Headless Cursor CLI streaming mode:
 * - Uses `-p` (print) with `--output-format stream-json` and `--stream-partial-output`.
 * - Default `force=true` is controlled by caller.
 *
 * The CLI prints one JSON object per line; we forward lines as-is (NDJSON).
 */
export async function spawnCursorAgentStream(opts: SpawnCursorAgentStreamOpts): Promise<{
  child: ChildProcess;
  stop: () => void;
}> {
  const agentBin = await resolveAgentBin();
  const modelArg = (opts.model && opts.model.trim()) || "auto";
  const args = ["-p", opts.prompt, "--output-format", "stream-json", "--stream-partial-output", `--model=${modelArg}`];
  if (opts.resume && opts.resume.trim()) args.push(`--resume=${opts.resume.trim()}`);
  if (opts.force) args.push("--force");
  if (opts.mode === "plan") args.push("--mode=plan");
  if (opts.mode === "ask") args.push("--mode=ask");

  const baseEnv = makeCleanEnv();

  // Normalize cwd to absolute path; Node spawn on Windows can throw EINVAL for invalid cwd
  const cwd = path.resolve(opts.cwd || ".");
  if (!fs.existsSync(cwd)) {
    throw new Error(`Working directory does not exist: ${cwd}`);
  }
  const cwdStat = fs.statSync(cwd);
  if (!cwdStat.isDirectory()) {
    throw new Error(`Not a directory: ${cwd}`);
  }

  // Windows: Node 20+ disallows direct spawn of .cmd/.bat without shell (EINVAL)
  const needsShell =
    process.platform === "win32" &&
    /\.(cmd|bat|ps1)$/i.test(agentBin);

  const child = spawn(agentBin, args, {
    cwd,
    env: {
      ...baseEnv,
      PATH: getSpawnPath(),
      HOME: process.env.HOME,
      USER: process.env.USER,
      SHELL: process.env.SHELL,
      LANG: process.env.LANG ?? "en_US.UTF-8",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32" && !needsShell,
    windowsHide: true,
    shell: needsShell,
  });

  const stop = () => killProcessTree(child);

  let timedOut = false;
  // Inactivity timeout: kill only if no output for this duration.
  // Default 5 minutes of inactivity (not total runtime).
  const inactivityTimeoutMs = Math.max(1, opts.timeoutMs ?? 300000);
  let timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, inactivityTimeoutMs);

  // Reset inactivity timer whenever we receive output
  const resetTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, inactivityTimeoutMs);
  };

  const rlOut = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  rlOut.on("line", (line) => {
    resetTimer(); // Activity detected, reset timeout
    try {
      opts.onStdoutLine(line);
    } catch {}
  });

  const rlErr = readline.createInterface({ input: child.stderr, crlfDelay: Infinity });
  rlErr.on("line", (line) => {
    resetTimer(); // Activity detected, reset timeout
    try {
      opts.onStderrLine?.(line);
    } catch {}
  });

  child.on("close", (code, signal) => {
    clearTimeout(timer);
    try {
      rlOut.close();
    } catch {}
    try {
      rlErr.close();
    } catch {}
    try {
      opts.onExit?.({ code, signal, timedOut });
    } catch {}
  });

  child.on("error", (err) => {
    clearTimeout(timer);
    try {
      opts.onStderrLine?.(String(err));
    } catch {}
    stop();
  });

  return { child, stop };
}
