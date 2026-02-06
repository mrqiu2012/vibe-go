type SnapshotSession = {
  term: any;
  cols: number;
  rows: number;
  pending: Promise<void>;
};

class SnapshotManager {
  private sessions = new Map<string, SnapshotSession>();
  private TerminalCtor: any | null = null;

  private async loadTerminalCtor(): Promise<any> {
    if (this.TerminalCtor) return this.TerminalCtor;
    const g = globalThis as any;
    if (!g.window) {
      g.window = {
        devicePixelRatio: 1,
        matchMedia: () => ({ matches: false, addListener() {}, removeListener() {} }),
        addEventListener() {},
        removeEventListener() {},
        navigator: { userAgent: "node" },
      };
    }
    if (!g.document) {
      g.document = {
        createElement: () => ({
          getContext: () => null,
          style: {},
          appendChild() {},
          setAttribute() {},
          getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
        }),
        body: { appendChild() {}, removeChild() {} },
        documentElement: {},
      };
    }
    const mod: any = await import("xterm-headless");
    this.TerminalCtor = mod.Terminal ?? mod.default?.Terminal ?? mod.default ?? mod;
    return this.TerminalCtor;
  }

  async create(sessionId: string, cols: number, rows: number) {
    this.dispose(sessionId);
    const Terminal = await this.loadTerminalCtor();
    const term = new Terminal({
      cols,
      rows,
      scrollback: 2000,
      allowProposedApi: true,
    });
    this.sessions.set(sessionId, { term, cols, rows, pending: Promise.resolve() });
  }

  dispose(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.sessions.delete(sessionId);
    try {
      s.term.dispose();
    } catch {}
  }

  resize(sessionId: string, cols: number, rows: number) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.cols = cols;
    s.rows = rows;
    try {
      s.term.resize(cols, rows);
    } catch {}
  }

  write(sessionId: string, data: string) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.pending = s.pending.then(
      () =>
        new Promise<void>((resolve) => {
          s.term.write(data, resolve);
        }),
    );
  }

  async snapshotText(sessionId: string): Promise<{ cols: number; rows: number; text: string } | null> {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    await s.pending;
    const lines: string[] = [];
    for (let i = 0; i < s.term.rows; i += 1) {
      const line = s.term.buffer.active.getLine(i);
      lines.push(line ? line.translateToString(true) : "");
    }
    return { cols: s.cols, rows: s.rows, text: lines.join("\n") };
  }
}

export const snapshotManager = new SnapshotManager();
