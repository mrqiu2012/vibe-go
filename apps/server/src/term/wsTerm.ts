import type http from "node:http";
import { WebSocketServer } from "ws";
import type WebSocket from "ws";
import type { TermClientMsg, TermServerMsg } from "@web-ide/protocol";
import type { CommandWhitelist, Limits } from "./session.js";
import { TermManager } from "./session.js";
import { NativeShellManager } from "./nativeShellManager.js";
import { CodexManager } from "./codexManager.js";
import { PtyCodexManager } from "./ptyCodexManager.js";
import { AgentManager } from "./agentManager.js";
import { PlanManager } from "./planManager.js";
import { AskManager } from "./askManager.js";

function safeJsonParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function attachTermWs(opts: {
  server: http.Server;
  path: string;
  whitelist: CommandWhitelist;
  denylist: string[];
  limits: Limits;
  maxSessions: number;
  validateCwd: (cwd: string) => Promise<string>;
}) {
  const wss = new WebSocketServer({ server: opts.server, path: opts.path });

  const send = (ws: WebSocket, msg: TermServerMsg) => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(msg));
  };

  wss.on("connection", (ws) => {
    // One TermManager per websocket connection.
    const term = new TermManager({
      maxSessions: opts.maxSessions,
      whitelist: opts.whitelist,
      denylist: opts.denylist,
      limits: opts.limits,
      validateCwd: opts.validateCwd,
      send: (m) => send(ws, m as TermServerMsg),
    });
    const nativeMgr = new NativeShellManager({
      maxSessions: opts.maxSessions,
      limits: opts.limits,
      validateCwd: opts.validateCwd,
      send: (m) => send(ws, m as TermServerMsg),
    });
    const codexMgr = new CodexManager({
      maxSessions: opts.maxSessions,
      limits: opts.limits,
      validateCwd: opts.validateCwd,
      send: (m) => send(ws, m as TermServerMsg),
    });
    const codexPtyMgr = new PtyCodexManager({
      maxSessions: opts.maxSessions,
      validateCwd: opts.validateCwd,
      send: (m) => send(ws, m as TermServerMsg),
    });
    const agentMgr = new AgentManager({
      maxSessions: opts.maxSessions,
      validateCwd: opts.validateCwd,
      send: (m) => send(ws, m as TermServerMsg),
    });
    const planMgr = new PlanManager({
      maxSessions: opts.maxSessions,
      validateCwd: opts.validateCwd,
      send: (m) => send(ws, m as TermServerMsg),
    });
    const askMgr = new AskManager({
      maxSessions: opts.maxSessions,
      validateCwd: opts.validateCwd,
      send: (m) => send(ws, m as TermServerMsg),
    });

    ws.on("message", async (data) => {
      const text =
        typeof data === "string"
          ? data
          : Buffer.isBuffer(data)
            ? data.toString("utf8")
            : Array.isArray(data)
              ? Buffer.concat(data).toString("utf8")
              : Buffer.from(data as ArrayBuffer).toString("utf8");

      const msg = safeJsonParse(text) as TermClientMsg | null;
      if (!msg || typeof (msg as any).t !== "string" || typeof (msg as any).reqId !== "string") {
        return;
      }

      const reqId = (msg as any).reqId as string;
      const t = (msg as any).t as string;
      const fail = (base: string, error: string) =>
        send(ws, { t: `${base}.resp` as any, reqId, ok: false, error } as any);

      try {
        if (t === "term.open") {
          const cwd = (msg as any).cwd;
          const cols = Number((msg as any).cols ?? 120);
          const rows = Number((msg as any).rows ?? 30);
          const mode = String((msg as any).mode ?? "restricted") as "restricted" | "native" | "codex" | "agent" | "plan" | "ask";
          const options = (msg as any).options;
          if (typeof cwd !== "string" || cwd.length === 0) return fail("term.open", "Missing cwd");
          if (!Number.isFinite(cols) || !Number.isFinite(rows)) return fail("term.open", "Invalid cols/rows");
          const realCwd = await opts.validateCwd(cwd);
          if (mode === "restricted") {
            const s = term.open(realCwd, cols, rows);
            send(ws, { t: "term.open.resp", reqId, ok: true, sessionId: s.id, cwd: s.cwd });
            // greet
            send(ws, { t: "term.data", sessionId: s.id, data: `$ cd ${s.cwd}\r\n` });
          } else if (mode === "native") {
            const s = nativeMgr.open(realCwd, cols, rows);
            send(ws, { t: "term.open.resp", reqId, ok: true, sessionId: s.id, cwd: s.cwd });
            send(ws, { t: "term.data", sessionId: s.id, data: `$ cd ${s.cwd}\r\n` });
          } else if (mode === "codex") {
            // Prefer true interactive TUI (PTY), fall back to exec-mode if PTY isn't available.
            try {
              const s = await codexPtyMgr.open(realCwd, cols, rows);
              send(ws, { t: "term.open.resp", reqId, ok: true, sessionId: s.id, cwd: s.cwd });
            } catch (e: any) {
              const s = await codexMgr.open(realCwd, cols, rows);
              send(ws, { t: "term.open.resp", reqId, ok: true, sessionId: s.id, cwd: s.cwd });
              send(ws, {
                t: "term.data",
                sessionId: s.id,
                data: `\r\n[codex] PTY unavailable, using exec mode: ${e?.message ?? String(e)}\r\n`,
              });
            }
          } else if (mode === "agent") {
            try {
              const s = await agentMgr.open(realCwd, cols, rows, options);
              send(ws, { 
                t: "term.open.resp", 
                reqId, 
                ok: true, 
                sessionId: s.id, 
                cwd: s.cwd,
                mode: "agent",
                threadId: s.threadId 
              });
            } catch (e: any) {
              return fail("term.open", `Agent failed: ${e?.message ?? String(e)}`);
            }
          } else if (mode === "plan") {
            try {
              const s = await planMgr.open(realCwd, cols, rows, options);
              send(ws, { 
                t: "term.open.resp", 
                reqId, 
                ok: true, 
                sessionId: s.id, 
                cwd: s.cwd,
                mode: "plan",
                threadId: s.threadId 
              });
            } catch (e: any) {
              return fail("term.open", `Plan mode failed: ${e?.message ?? String(e)}`);
            }
          } else if (mode === "ask") {
            try {
              const s = await askMgr.open(realCwd, cols, rows, options);
              send(ws, { 
                t: "term.open.resp", 
                reqId, 
                ok: true, 
                sessionId: s.id, 
                cwd: s.cwd,
                mode: "ask",
                threadId: s.threadId 
              });
            } catch (e: any) {
              return fail("term.open", `Ask mode failed: ${e?.message ?? String(e)}`);
            }
          } else {
            return fail("term.open", `Unknown mode: ${mode}`);
          }
          return;
        }

        if (t === "term.close") {
          const sessionId = (msg as any).sessionId;
          if (typeof sessionId !== "string" || !sessionId) return fail("term.close", "Missing sessionId");
          if (askMgr.has(sessionId)) askMgr.close(sessionId);
          else if (planMgr.has(sessionId)) planMgr.close(sessionId);
          else if (agentMgr.has(sessionId)) agentMgr.close(sessionId);
          else if (codexPtyMgr.has(sessionId)) codexPtyMgr.close(sessionId);
          else if (codexMgr.has(sessionId)) codexMgr.close(sessionId);
          else if (nativeMgr.has(sessionId)) nativeMgr.close(sessionId);
          else term.close(sessionId);
          send(ws, { t: "term.close.resp", reqId, ok: true });
          send(ws, { t: "term.exit", sessionId, code: 0 });
          return;
        }

        if (t === "term.resize") {
          const sessionId = (msg as any).sessionId;
          const cols = Number((msg as any).cols);
          const rows = Number((msg as any).rows);
          if (typeof sessionId !== "string" || !sessionId) return fail("term.resize", "Missing sessionId");
          if (!Number.isFinite(cols) || !Number.isFinite(rows)) return fail("term.resize", "Invalid cols/rows");
          if (askMgr.has(sessionId)) askMgr.resize(sessionId, cols, rows);
          else if (planMgr.has(sessionId)) planMgr.resize(sessionId, cols, rows);
          else if (agentMgr.has(sessionId)) agentMgr.resize(sessionId, cols, rows);
          else if (codexPtyMgr.has(sessionId)) codexPtyMgr.resize(sessionId, cols, rows);
          else if (codexMgr.has(sessionId)) codexMgr.resize(sessionId, cols, rows);
          else if (nativeMgr.has(sessionId)) nativeMgr.resize(sessionId, cols, rows);
          else term.resize(sessionId, cols, rows);
          send(ws, { t: "term.resize.resp", reqId, ok: true });
          return;
        }

        if (t === "term.stdin") {
          const sessionId = (msg as any).sessionId;
          const dataStr = (msg as any).data;
          if (typeof sessionId !== "string" || !sessionId) return fail("term.stdin", "Missing sessionId");
          if (typeof dataStr !== "string") return fail("term.stdin", "Missing data");
          if (askMgr.has(sessionId)) askMgr.stdin(sessionId, dataStr);
          else if (planMgr.has(sessionId)) planMgr.stdin(sessionId, dataStr);
          else if (agentMgr.has(sessionId)) agentMgr.stdin(sessionId, dataStr);
          else if (codexPtyMgr.has(sessionId)) codexPtyMgr.stdin(sessionId, dataStr);
          else if (codexMgr.has(sessionId)) await codexMgr.stdin(sessionId, dataStr);
          else if (nativeMgr.has(sessionId)) await nativeMgr.stdin(sessionId, dataStr);
          else await term.stdin(sessionId, dataStr);
          send(ws, { t: "term.stdin.resp", reqId, ok: true });
          return;
        }

        return;
      } catch (e: any) {
        fail(t, e?.message ?? String(e));
      }
    });

    ws.on("close", () => {
      // Best-effort: close all sessions when browser disconnects.
      const managers = [codexMgr, codexPtyMgr, agentMgr, planMgr, askMgr];
      for (const mgr of managers) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const anyMgr = mgr as any;
          const sessions: Map<string, any> | undefined = anyMgr?.sessions;
          if (sessions && typeof sessions.forEach === "function") {
            sessions.forEach((_v: any, k: string) => {
              if (mgr === codexMgr) codexMgr.close(k);
              else if (mgr === codexPtyMgr) codexPtyMgr.close(k);
              else if (mgr === agentMgr) agentMgr.close(k);
              else if (mgr === planMgr) planMgr.close(k);
              else if (mgr === askMgr) askMgr.close(k);
            });
          }
        } catch {}
      }
    });
  });

  return wss;
}

