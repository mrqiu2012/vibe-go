import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";

export type Limits = {
  timeoutSec: number;
  maxOutputBytes: number;
};

export type CommandWhitelist = Record<string, { title?: string }>;

export type TermSend = (msg: any) => void;

export type Session = {
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

function isDisallowedMetachar(s: string) {
  // Keep it intentionally strict: disallow typical shell metacharacters.
  // Users can still run normal commands like `git status` or `node -v`.
  return /[|&;<>()$`\\\n\r]/.test(s) || /[<>]/.test(s);
}

function parseArgs(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (cur.length) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (quote) throw new Error("Unclosed quote");
  if (cur.length) out.push(cur);
  return out;
}

async function cmdLs(targetPath: string) {
  const st = await fs.stat(targetPath);
  if (st.isDirectory()) {
    const names = await fs.readdir(targetPath);
    names.sort((a, b) => a.localeCompare(b));
    return names.join("\r\n") + (names.length ? "\r\n" : "");
  }
  return path.basename(targetPath) + "\r\n";
}

export class TermManager {
  private sessions = new Map<string, Session>();

  constructor(
    private opts: {
      maxSessions: number;
      whitelist: CommandWhitelist;
      denylist: string[];
      limits: Limits;
      validateCwd: (cwd: string) => Promise<string>;
      send: TermSend;
    },
  ) {}

  open(cwd: string, cols = 120, rows = 30) {
    if (this.sessions.size >= this.opts.maxSessions) throw new Error("Too many sessions");
    const id = `s_${randomId()}`;
    const s: Session = { id, cwd, cols, rows, lineBuf: "", queue: [], running: false };
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
    // Normalize CRLF, but preserve user-intended newlines as command submit.
    const normalized = data.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (const ch of normalized) {
      if (ch === "\n") {
        const line = s.lineBuf;
        s.lineBuf = "";
        s.queue.push(line);
      } else if (ch === "\b" || ch === "\x7f") {
        // Backspace / DEL
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

  private async pump(s: Session) {
    if (s.running) return;
    const next = s.queue.shift();
    if (next === undefined) return;
    s.running = true;
    try {
      await this.runLine(s, next);
    } finally {
      s.running = false;
      // Continue pumping if more queued.
      if (s.queue.length) await this.pump(s);
    }
  }

  private async runLine(s: Session, rawLine: string) {
    const line = rawLine.trim();
    if (!line) {
      this.opts.send({ t: "term.data", sessionId: s.id, data: "\r\n" });
      return;
    }

    // Reject common shell injection metacharacters early.
    if (isDisallowedMetachar(line)) {
      this.opts.send({
        t: "term.data",
        sessionId: s.id,
        data: `\r\n[blocked] Unsupported shell operator/metacharacters.\r\n`,
      });
      this.opts.send({ t: "term.exit", sessionId: s.id, code: 2 });
      return;
    }

    let argv: string[];
    try {
      argv = parseArgs(line);
    } catch (e: any) {
      this.opts.send({ t: "term.data", sessionId: s.id, data: `\r\n[error] ${e?.message ?? String(e)}\r\n` });
      this.opts.send({ t: "term.exit", sessionId: s.id, code: 2 });
      return;
    }
    const cmd = argv[0]!;
    const args = argv.slice(1);

    if (cmd === "pwd") {
      this.opts.send({ t: "term.data", sessionId: s.id, data: s.cwd + "\r\n" });
      this.opts.send({ t: "term.exit", sessionId: s.id, code: 0 });
      return;
    }

    if (cmd === "cd") {
      const target = args[0] ?? "";
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

    if (cmd === "ls") {
      const target = args[0] ?? ".";
      const next = path.resolve(s.cwd, target);
      try {
        const real = await this.opts.validateCwd(next);
        const out = await cmdLs(real);
        this.opts.send({ t: "term.data", sessionId: s.id, data: out });
        this.opts.send({ t: "term.exit", sessionId: s.id, code: 0 });
      } catch (e: any) {
        this.opts.send({
          t: "term.data",
          sessionId: s.id,
          data: `\r\n[error] ls: ${e?.message ?? String(e)}\r\n`,
        });
        this.opts.send({ t: "term.exit", sessionId: s.id, code: 1 });
      }
      return;
    }

    // If whitelist is provided (legacy behavior), enforce it.
    const whitelistKeys = Object.keys(this.opts.whitelist ?? {});
    if (whitelistKeys.length > 0 && !this.opts.whitelist[cmd]) {
      this.opts.send({ t: "term.data", sessionId: s.id, data: `\r\n[blocked] Command not allowed: ${cmd}\r\n` });
      this.opts.send({ t: "term.exit", sessionId: s.id, code: 127 });
      return;
    }

    // Default behavior: blacklist only dangerous commands.
    const deny = (this.opts.denylist ?? []).includes(cmd);
    if (deny) {
      this.opts.send({ t: "term.data", sessionId: s.id, data: `\r\n[blocked] Dangerous command: ${cmd}\r\n` });
      this.opts.send({ t: "term.exit", sessionId: s.id, code: 127 });
      return;
    }

    const timeoutMs = Math.max(1, this.opts.limits.timeoutSec) * 1000;
    let bytesLeft = this.opts.limits.maxOutputBytes;
    try {
      const child = execa(cmd, args, {
        cwd: s.cwd,
        timeout: timeoutMs,
        all: true,
        reject: false,
        env: {
          ...process.env,
          // reduce noisy coloring issues in terminals
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
          this.opts.send({
            t: "term.data",
            sessionId: s.id,
            data: `\r\n[truncated] output exceeded limit\r\n`,
          });
          try {
            child.kill("SIGKILL");
          } catch {}
        }
      });

      const res = await child;
      const code = typeof res.exitCode === "number" ? res.exitCode : 0;
      this.opts.send({ t: "term.exit", sessionId: s.id, code });
    } catch (e: any) {
      this.opts.send({
        t: "term.data",
        sessionId: s.id,
        data: `\r\n[error] ${e?.message ?? String(e)}\r\n`,
      });
      this.opts.send({ t: "term.exit", sessionId: s.id, code: 1 });
    }
  }
}

