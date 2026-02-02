export type TermServerMsg =
  | { t: "term.open.resp"; reqId: string; ok: true; sessionId: string; cwd: string; mode?: string; threadId?: string }
  | { t: "term.open.resp"; reqId: string; ok: false; error: string }
  | { t: "term.stdin.resp"; reqId: string; ok: true }
  | { t: "term.stdin.resp"; reqId: string; ok: false; error: string }
  | { t: "term.resize.resp"; reqId: string; ok: true }
  | { t: "term.resize.resp"; reqId: string; ok: false; error: string }
  | { t: "term.close.resp"; reqId: string; ok: true }
  | { t: "term.close.resp"; reqId: string; ok: false; error: string }
  | { t: "term.data"; sessionId: string; data: string }
  | { t: "term.exit"; sessionId: string; code?: number };

export class TermClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, (msg: any) => void>();
  private outbox: string[] = [];
  onMsg?: (msg: TermServerMsg) => void;
  debug = false;

  private log(..._args: any[]) {
    if (!this.debug) return;
  }

  connect(): Promise<void> {
    const loc = window.location;
    const isSameServer = loc.port === "3005";
    const wsProto = loc.protocol === "https:" ? "wss" : "ws";
    // In dev/preview, connect directly to backend WS (Vite preview doesn't proxy WS).
    const url = isSameServer
      ? `${loc.origin.replace(/^http/, "ws")}/ws/term`
      : `${wsProto}://${loc.hostname}:3005/ws/term`;
    this.log("connect()", { url });
    this.ws = new WebSocket(url);
    const ws = this.ws;
    const p = new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        this.log("ws.onopen");
        // Flush queued messages issued before open.
        const queued = this.outbox;
        this.outbox = [];
        for (const m of queued) ws.send(m);
        resolve();
      };
      ws.onerror = (ev) => {
        this.log("ws.onerror", ev);
        reject(new Error("ws error"));
      };
    });
    this.ws.onclose = (ev) => {
      this.log("ws.onclose", { code: ev.code, reason: ev.reason, wasClean: ev.wasClean });
    };
    this.ws.onmessage = (ev) => this.onMessage(String(ev.data));
    return p;
  }

  close() {
    this.log("close()");
    this.ws?.close();
    this.ws = null;
    this.pending.clear();
  }

  private request<T extends { t: string; reqId: string }>(msg: any): Promise<T> {
    const reqId = `r_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
    msg.reqId = reqId;
    const p = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(reqId);
        this.log("request timeout", { t: msg?.t, reqId });
        reject(new Error("request timeout"));
      }, 15000);
      this.pending.set(reqId, (m) => {
        clearTimeout(timeout);
        resolve(m as T);
      });
    });
    if (!this.ws) throw new Error("ws not connected");
    const payload = JSON.stringify(msg);
    this.log("send", { t: msg?.t, reqId, sessionId: msg?.sessionId, bytes: payload.length });
    if (this.ws.readyState !== WebSocket.OPEN) {
      this.outbox.push(payload);
    } else {
      this.ws.send(payload);
    }
    return p;
  }

  async open(
    cwd: string, 
    cols: number, 
    rows: number, 
    mode?: "restricted" | "native" | "codex" | "agent" | "plan" | "ask",
    options?: {
      prompt?: string;
      resume?: string;
    }
  ) {
    return await this.request<{ 
      t: "term.open.resp"; 
      reqId: string; 
      ok: boolean; 
      sessionId?: string; 
      cwd?: string; 
      mode?: string;
      threadId?: string;
      error?: string;
    }>({ t: "term.open", cwd, cols, rows, mode, options });
  }

  async stdin(sessionId: string, data: string) {
    return await this.request<{ t: "term.stdin.resp"; reqId: string; ok: boolean; error?: string }>({
      t: "term.stdin",
      sessionId,
      data,
    });
  }

  async resize(sessionId: string, cols: number, rows: number) {
    return await this.request<{ t: "term.resize.resp"; reqId: string; ok: boolean; error?: string }>({
      t: "term.resize",
      sessionId,
      cols,
      rows,
    });
  }

  async closeSession(sessionId: string) {
    return await this.request<{ t: "term.close.resp"; reqId: string; ok: boolean; error?: string }>({
      t: "term.close",
      sessionId,
    });
  }

  private onMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg?.t === "term.data") {
      this.log("recv term.data", { sessionId: msg.sessionId, bytes: (msg.data?.length ?? 0) });
    } else if (msg?.t === "term.exit") {
      this.log("recv term.exit", { sessionId: msg.sessionId, code: msg.code });
    } else if (typeof msg?.t === "string" && String(msg.t).endsWith(".resp")) {
      this.log("recv resp", { t: msg.t, reqId: msg.reqId, ok: msg.ok, error: msg.error });
    } else {
      this.log("recv", { t: msg?.t });
    }
    this.onMsg?.(msg as TermServerMsg);
    if (msg?.reqId && typeof msg.t === "string" && String(msg.t).endsWith(".resp")) {
      const cb = this.pending.get(msg.reqId);
      if (cb) {
        this.pending.delete(msg.reqId);
        cb(msg);
      }
    }
  }
}

