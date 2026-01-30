import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import type { Limits } from "./session.js";

export type TermSend = (msg: any) => void;

type NativeSession = {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  lineBuf: string;
  queue: string[];
  running: boolean;
};

function randomId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function clampChunk(text: string, maxBytesLeft: number) {
  const buf = Buffer.from(text, "utf8");
  if (buf.byteLength <= maxBytesLeft) return { text, bytes: buf.byteLength, truncated: false };
  return { text: buf.subarray(0, maxBytesLeft).toString("utf8"), bytes: maxBytesLeft, truncated: true };
}

function shellForLine(): { bin: string; argsPrefix: string[] } {
  // Use user's shell when possible so syntax feels "native".
  // We run as a login-like non-interactive shell per command via -lc.
  const shell = process.env.SHELL;
  if (shell && shell.length) return { bin: shell, argsPrefix: ["-lc"] };
  return process.platform === "win32" ? { bin: "cmd.exe", argsPrefix: ["/c"] } : { bin: "/bin/bash", argsPrefix: ["-lc"] };
}

export class NativeShellManager {
  private sessions = new Map<string, NativeSession>();

  constructor(
    private opts: {
      maxSessions: number;
      limits: Limits;
      validateCwd: (cwd: string) => Promise<string>;
      send: TermSend;
    },
  ) {}

  has(sessionId: string) {
    return this.sessions.has(sessionId);
  }

  open(cwd: string, cols = 120, rows = 30) {
    if (this.sessions.size >= this.opts.maxSessions) throw new Error("Too many sessions");
    const id = `n_${randomId()}`;
    const s: NativeSession = { id, cwd, cols, rows, lineBuf: "", queue: [], running: false };
    this.sessions.set(id, s);
    return s;
  }

  close(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  resize(sessionId: string, cols: number, rows: number) {
    const s = this.mustGet(sessionId);
    s.cols = cols;
    s.rows = rows;
  }

  async stdin(sessionId: string, data: string) {
    const s = this.mustGet(sessionId);
    const normalized = data.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (const ch of normalized) {
      if (ch === "\n") {
        const line = s.lineBuf;
        s.lineBuf = "";
        s.queue.push(line);
      } else if (ch === "\b" || ch === "\x7f") {
        s.lineBuf = s.lineBuf.slice(0, -1);
      } else {
        s.lineBuf += ch;
      }
    }
    await this.pump(s);
  }

  private mustGet(id: string) {
    const s = this.sessions.get(id);
    if (!s) throw new Error("Unknown session");
    return s;
  }

  private async pump(s: NativeSession) {
    if (s.running) return;
    const next = s.queue.shift();
    if (next === undefined) return;
    s.running = true;
    try {
      await this.runLine(s, next);
    } finally {
      s.running = false;
      if (s.queue.length) await this.pump(s);
    }
  }

  private async runLine(s: NativeSession, rawLine: string) {
    const line = rawLine.trim();
    if (!line) {
      this.opts.send({ t: "term.data", sessionId: s.id, data: "\r\n" });
      this.opts.send({ t: "term.exit", sessionId: s.id, code: 0 });
      return;
    }

    // Persisting "cd" (since `shell -lc` won't persist state across commands)
    if (line === "pwd") {
      this.opts.send({ t: "term.data", sessionId: s.id, data: s.cwd + "\r\n" });
      this.opts.send({ t: "term.exit", sessionId: s.id, code: 0 });
      return;
    }
    if (line === "cd" || line.startsWith("cd ")) {
      const target = line === "cd" ? "" : line.slice(3).trim();
      const next = target ? path.resolve(s.cwd, target) : s.cwd;
      try {
        const real = await this.opts.validateCwd(next);
        const st = await fs.stat(real);
        if (!st.isDirectory()) throw new Error("Not a directory");
        s.cwd = real;
        this.opts.send({ t: "term.data", sessionId: s.id, data: `\r\n$ cd ${real}\r\n` });
        this.opts.send({ t: "term.exit", sessionId: s.id, code: 0 });
      } catch (e: any) {
        this.opts.send({
          t: "term.data",
          sessionId: s.id,
          data: `\r\n[error] cd: ${e?.message ?? String(e)}\r\n`,
        });
        this.opts.send({ t: "term.exit", sessionId: s.id, code: 1 });
      }
      return;
    }

    const timeoutMs = Math.max(1, this.opts.limits.timeoutSec) * 1000;
    let bytesLeft = this.opts.limits.maxOutputBytes;
    const { bin, argsPrefix } = shellForLine();

    const child = execa(bin, [...argsPrefix, line], {
      cwd: s.cwd,
      timeout: timeoutMs,
      all: true,
      reject: false,
      env: {
        ...process.env,
        FORCE_COLOR: "0",
      },
    });

    child.all?.on("data", (buf: Buffer) => {
      if (bytesLeft <= 0) return;
      const chunk = buf.toString("utf8");
      const clamped = clampChunk(chunk, bytesLeft);
      bytesLeft -= clamped.bytes;
      if (clamped.text) this.opts.send({ t: "term.data", sessionId: s.id, data: clamped.text });
      if (clamped.truncated) {
        this.opts.send({ t: "term.data", sessionId: s.id, data: `\r\n[truncated] output exceeded limit\r\n` });
        try {
          child.kill("SIGKILL");
        } catch {}
      }
    });

    const res = await child;
    const code = typeof res.exitCode === "number" ? res.exitCode : 0;
    this.opts.send({ t: "term.exit", sessionId: s.id, code });
  }
}

