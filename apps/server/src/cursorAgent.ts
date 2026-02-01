import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import readline from "node:readline";
import { execa } from "execa";

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

export async function executeCursorAgent(prompt: string, mode: "agent" | "plan" | "ask", cwd: string) {
  const agentBin = await resolveAgentBin();
  const args = ["-p", prompt, "--output-format", "json"];

  if (mode === "plan") args.push("--mode=plan");
  if (mode === "ask") args.push("--mode=ask");

  const baseEnv = makeCleanEnv();
  const spawnPath = [path.join(process.env.HOME ?? "", ".local", "bin"), process.env.PATH ?? ""]
    .filter(Boolean)
    .join(path.delimiter);

  try {
    const result = await execa(agentBin, args, {
      cwd,
      timeout: 300000, // 5 minutes - cursor agent tools can take a while
      env: {
        ...baseEnv,
        PATH: spawnPath,
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
    console.error(`[CursorAgent] Error:`, error.message);
    
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
  const args = ["-p", opts.prompt, "--output-format", "stream-json", "--stream-partial-output"];
  if (opts.resume && opts.resume.trim()) args.push(`--resume=${opts.resume.trim()}`);
  if (opts.force) args.push("--force");
  if (opts.mode === "plan") args.push("--mode=plan");
  if (opts.mode === "ask") args.push("--mode=ask");

  const baseEnv = makeCleanEnv();
  const spawnPath = [path.join(process.env.HOME ?? "", ".local", "bin"), process.env.PATH ?? ""]
    .filter(Boolean)
    .join(path.delimiter);

  const child = spawn(agentBin, args, {
    cwd: opts.cwd,
    env: {
      ...baseEnv,
      PATH: spawnPath,
      HOME: process.env.HOME,
      USER: process.env.USER,
      SHELL: process.env.SHELL,
      LANG: process.env.LANG ?? "en_US.UTF-8",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
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
