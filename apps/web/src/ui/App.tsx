import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import hljs from "highlight.js";
import { apiList, apiRead, apiRoots, apiWrite, type FsEntry } from "../api";
import { TermClient, type TermServerMsg } from "../wsTerm";
import { CursorChatPanel } from "./CursorChatPanel";

type TreeNode = {
  path: string;
  name: string;
  type: "dir" | "file" | "other";
  expanded?: boolean;
  loading?: boolean;
  loaded?: boolean;
  children?: TreeNode[];
};

function baseName(p: string) {
  const clean = p.replace(/\/+$/, "");
  const parts = clean.split("/");
  return parts[parts.length - 1] || clean;
}

function joinPath(parent: string, name: string) {
  if (parent.endsWith("/")) return parent + name;
  return parent + "/" + name;
}

function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function languageFromPath(p: string): string | null {
  const lower = p.toLowerCase();
  const parts = lower.split(".");
  if (parts.length < 2) return null;
  const ext = parts[parts.length - 1] ?? "";
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "json":
      return "json";
    case "css":
      return "css";
    case "html":
      return "xml";
    case "md":
      return "markdown";
    case "py":
      return "python";
    case "sh":
      return "bash";
    case "yml":
    case "yaml":
      return "yaml";
    default:
      return null;
  }
}

function CodePreview(props: { path: string; code: string }) {
  const lang = useMemo(() => languageFromPath(props.path), [props.path]);

  const highlighted = useMemo(() => {
    try {
      if (lang) {
        return hljs.highlight(props.code, { language: lang, ignoreIllegals: true }).value;
      }
      return hljs.highlightAuto(props.code).value;
    } catch {
      // Fallback: escape is handled by React when we render as text, but
      // here we use HTML, so return plain text wrapped safely.
      return props.code
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    }
  }, [props.code, lang]);

  const className = ["hljs", lang ? `language-${lang}` : ""].filter(Boolean).join(" ");
  return (
    <div className="codePreview">
      <pre>
        <code className={className} dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
}

function updateNode(tree: TreeNode, targetPath: string, fn: (n: TreeNode) => TreeNode): TreeNode {
  if (tree.path === targetPath) return fn(tree);
  if (!tree.children) return tree;
  const nextChildren = tree.children.map((c) => updateNode(c, targetPath, fn));
  // Only allocate a new object if children changed references.
  const changed = nextChildren.some((c, i) => c !== tree.children![i]);
  return changed ? { ...tree, children: nextChildren } : tree;
}

function TreeView(props: {
  node: TreeNode;
  depth: number;
  activeFile: string;
  onToggleDir: (node: TreeNode) => void;
  onOpenFile: (node: TreeNode) => void;
  onOpenTerminalDir: (node: TreeNode) => void;
}) {
  const { node, depth, activeFile } = props;
  const indent = depth * 12;
  const isActive = node.type === "file" && node.path === activeFile;

  return (
    <div>
      <div
        className={"fileRow" + (isActive ? " fileRowActive" : "")}
        style={{ paddingLeft: 8 + indent }}
        onClick={() => {
          if (node.type === "dir") props.onToggleDir(node);
          else if (node.type === "file") props.onOpenFile(node);
        }}
        title={node.path}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
          <span style={{ color: node.type === "dir" ? "var(--accent)" : "var(--text)" }}>
            {node.type === "dir" ? (node.expanded ? "▾" : "▸") : " "}
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.name}</span>
          {node.loading ? <span className="fileMeta">loading…</span> : null}
        </div>

        {node.type === "dir" ? (
          <div className="dirActions" onClick={(e) => e.stopPropagation()}>
            <button className="dirTermBtn" onClick={() => props.onOpenTerminalDir(node)} title="Open terminal in this folder">
              Term
            </button>
          </div>
        ) : null}
      </div>

      {node.type === "dir" && node.expanded ? (
        <div>
          {node.children?.map((c) => (
            <TreeView
              key={c.path}
              node={c}
              depth={depth + 1}
              activeFile={activeFile}
              onToggleDir={props.onToggleDir}
              onOpenFile={props.onOpenFile}
              onOpenTerminalDir={props.onOpenTerminalDir}
            />
          ))}
          {node.loading ? (
            <div className="fileMeta" style={{ paddingLeft: 8 + indent + 24, paddingTop: 4, paddingBottom: 6 }}>
              loading…
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function App() {
  const [isMobile, setIsMobile] = useState(false);
  const [mobileTab, setMobileTab] = useState<"explorer" | "editor" | "terminal">("editor");
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const [leftWidth, setLeftWidth] = useState(320);
  const [isDragging, setIsDragging] = useState(false);
  const [topHeight, setTopHeight] = useState(60); // Terminal 高度百分比（用于交换 Editor/Terminal 高度）
  const [isDraggingVertical, setIsDraggingVertical] = useState(false);

  const [roots, setRoots] = useState<string[]>([]);
  const [activeRoot, setActiveRoot] = useState("");
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [status, setStatus] = useState<string>("");
  const [terminalCwd, setTerminalCwd] = useState<string>("");

  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState("");
  const [fileStateByPath, setFileStateByPath] = useState<
    Record<string, { text: string; dirty: boolean; info: { size: number; mtimeMs: number } | null }>
  >({});

  const activeState = activeFile ? fileStateByPath[activeFile] : undefined;
  const fileText = activeState?.text ?? "";
  const dirty = activeState?.dirty ?? false;
  const fileInfo = activeState?.info ?? null;

  const termDivRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termClientRef = useRef<TermClient | null>(null);
  const termSessionIdRef = useRef<string>("");
  const termPendingStdinRef = useRef<string>(""); // buffer keystrokes before a session is ready
  const [termMode, setTermMode] = useState<"restricted" | "codex" | "cursor" | "cursor-cli">("restricted");
  const termModeRef = useRef<"restricted" | "codex" | "cursor" | "cursor-cli">("restricted");
  const [cursorMode, setCursorMode] = useState<"agent" | "plan" | "ask">("agent");
  const cursorModeRef = useRef<"agent" | "plan" | "ask">("agent");
  const [cursorCliMode, setCursorCliMode] = useState<"agent" | "plan" | "ask">("agent");
  const cursorCliModeRef = useRef<"agent" | "plan" | "ask">("agent");
  const termCwdRef = useRef<string>("");
  const lastOpenKeyRef = useRef<string>("");
  const cursorPromptNudgedRef = useRef(false);
  const termInitedRef = useRef(false);

  const logTerm = (...args: any[]) => {
    // Enable for debugging CLI-Agent
    // eslint-disable-next-line no-console
    console.log("[AppTerm]", ...args);
  };
  const termResizeObsRef = useRef<ResizeObserver | null>(null);
  const termInputBufRef = useRef<string>("");

  const terminalVisible = !isMobile || mobileTab === "terminal";

  useEffect(() => {
    termModeRef.current = termMode;
  }, [termMode]);

  useEffect(() => {
    cursorModeRef.current = cursorMode;
  }, [cursorMode]);

  useEffect(() => {
    cursorCliModeRef.current = cursorCliMode;
  }, [cursorCliMode]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    // Safari legacy fallback
    // eslint-disable-next-line deprecation/deprecation
    mq.addEventListener ? mq.addEventListener("change", apply) : mq.addListener(apply);
    return () => {
      // eslint-disable-next-line deprecation/deprecation
      mq.removeEventListener ? mq.removeEventListener("change", apply) : mq.removeListener(apply);
    };
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const onMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX - 10;
      if (newWidth >= 200 && newWidth <= 600) {
        setLeftWidth(newWidth);
      }
    };
    const onMouseUp = () => setIsDragging(false);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDragging]);

  const rightPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isDraggingVertical) return;
    const onMouseMove = (e: MouseEvent) => {
      const rightPanel = rightPanelRef.current;
      if (!rightPanel) return;
      const rect = rightPanel.getBoundingClientRect();
      const offsetY = e.clientY - rect.top;
      const newHeightPercent = (offsetY / rect.height) * 100;
      // newHeightPercent is the divider position from top (i.e. Editor height %)
      // We store Terminal height %, so invert it.
      if (newHeightPercent >= 30 && newHeightPercent <= 80) {
        setTopHeight(100 - newHeightPercent);
      }
    };
    const onMouseUp = () => setIsDraggingVertical(false);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDraggingVertical]);

  const ready = useMemo(() => roots.length > 0 && activeRoot.length > 0, [roots, activeRoot]);

  const safeFitTerm = useCallback(() => {
    const el = termDivRef.current;
    const fit = fitRef.current;
    const term = termRef.current;
    if (!el || !fit || !term) return;
    if (el.clientWidth <= 0 || el.clientHeight <= 0) return;
    // Avoid a known xterm 5.3.x edge where renderer isn't ready yet.
    const core = (term as any)?._core;
    const dims = core?._renderService?._renderer?.dimensions;
    if (!dims) return;
    try {
      fit.fit();
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    apiRoots()
      .then((r) => {
        setRoots(r.roots);
        setActiveRoot((prev) => prev || r.roots[0] || "");
      })
      .catch((e) => setStatus(`[error] roots: ${e?.message ?? String(e)}`));
  }, []);

  useEffect(() => {
    if (!activeRoot) return;
    setTerminalCwd(activeRoot);
  }, [activeRoot]);

  useEffect(() => {
    if (!activeRoot) return;
    const rootNode: TreeNode = { path: activeRoot, name: baseName(activeRoot), type: "dir", expanded: true };
    setTree(rootNode);
    // Load root children
    (async () => {
      try {
        setTree((t) => (t ? { ...t, loading: true } : t));
        const r = await apiList(activeRoot);
        const children: TreeNode[] = r.entries.map((e) => ({
          path: joinPath(r.path, e.name),
          name: e.name,
          type: e.type,
        }));
        setTree((t) => (t ? { ...t, loading: false, loaded: true, children } : t));
      } catch (e: any) {
        setStatus(`[error] list: ${e?.message ?? String(e)}`);
        setTree((t) => (t ? { ...t, loading: false } : t));
      }
    })();
  }, [activeRoot]);

  const toggleDir = async (node: TreeNode) => {
    // Collapse
    if (node.expanded) {
      setTree((prev) => (prev ? updateNode(prev, node.path, (n) => ({ ...n, expanded: false })) : prev));
      return;
    }

    // Expand (and show loading placeholder immediately)
    setTree((prev) =>
      prev
        ? updateNode(prev, node.path, (n) => ({
            ...n,
            expanded: true,
            loading: n.loaded ? false : true,
          }))
        : prev,
    );
    if (node.loaded) return;
    try {
      const r = await apiList(node.path);
      const children: TreeNode[] = r.entries.map((e: FsEntry) => ({
        path: joinPath(r.path, e.name),
        name: e.name,
        type: e.type,
      }));
      setTree((prev) =>
        prev
          ? updateNode(prev, node.path, (n) => ({ ...n, expanded: true, loading: false, loaded: true, children }))
          : prev,
      );
    } catch (e: any) {
      setStatus(`[error] list: ${e?.message ?? String(e)}`);
      setTree((prev) => (prev ? updateNode(prev, node.path, (n) => ({ ...n, loading: false })) : prev));
    }
  };

  const openFile = async (node: TreeNode) => {
    try {
      setStatus("");
      const r = await apiRead(node.path);
      setActiveFile(r.path);
      setEditorMode("edit");
      setOpenTabs((prev) => (prev.includes(r.path) ? prev : [...prev, r.path]));
      setFileStateByPath((prev) => ({
        ...prev,
        [r.path]: { text: r.text, dirty: false, info: { size: r.size, mtimeMs: r.mtimeMs } },
      }));
    } catch (e: any) {
      setStatus(`[error] read: ${e?.message ?? String(e)}`);
    }
  };

  const save = async () => {
    if (!activeFile) return;
    try {
      const r = await apiWrite(activeFile, fileText);
      setFileStateByPath((prev) => ({
        ...prev,
        [activeFile]: { text: fileText, dirty: false, info: { size: r.size, mtimeMs: r.mtimeMs } },
      }));
      setStatus(`[ok] saved ${baseName(activeFile)}`);
    } catch (e: any) {
      setStatus(`[error] write: ${e?.message ?? String(e)}`);
    }
  };

  const closeTab = (path: string) => {
    const st = fileStateByPath[path];
    if (st?.dirty) {
      const ok = window.confirm(`"${baseName(path)}" has unsaved changes. Close anyway?`);
      if (!ok) return;
    }

    setFileStateByPath((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });

    setOpenTabs((prev) => {
      const nextTabs = prev.filter((p) => p !== path);
      if (activeFile === path) {
        const nextActive = nextTabs[nextTabs.length - 1] ?? "";
        setActiveFile(nextActive);
      }
      return nextTabs;
    });
  };

  // Ctrl+S / Cmd+S
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
        ev.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile, fileText]);

  // Terminal init
  useEffect(() => {
    if (!terminalVisible) return;
    if (termInitedRef.current) return;
    const el = termDivRef.current;
    if (!el) return;
    if (el.clientWidth <= 0 || el.clientHeight <= 0) return;

    const term = new Terminal({
      fontFamily: "var(--mono)",
      fontSize: 12,
      allowProposedApi: true,
      theme: {
        background: "#ffffff",
        foreground: "#0f172a",
        cursor: "#2563eb",
        selectionBackground: "rgba(37,99,235,0.18)",
      },
      cursorBlink: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termInitedRef.current = true;
    // Defer initial fit until layout is ready.
    requestAnimationFrame(() => requestAnimationFrame(() => safeFitTerm()));
    term.focus();

    termRef.current = term;
    fitRef.current = fit;

    const client = new TermClient();
    termClientRef.current = client;
    client.debug = true;
    logTerm("terminal init", { terminalVisible, w: el.clientWidth, h: el.clientHeight });

    // Ensure TUIs can query device/cursor status.
    // xterm.js may not always answer strict clients fast enough; respond explicitly.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (term as any).parser?.registerCsiHandler?.({ final: "n" }, (params: number[]) => {
        const sid = termSessionIdRef.current;
        if (!sid) return true;
        // CSI 5 n: "Status Report" -> "OK"
        if (params?.[0] === 5) {
          void client.stdin(sid, "\u001b[0n").catch(() => {});
          return true;
        }
        // CSI 6 n: "Cursor Position Report"
        if (params?.[0] === 6) {
          // xterm uses 0-based cursor position
          const row = term.buffer.active.cursorY + 1;
          const col = term.buffer.active.cursorX + 1;
          const resp = `\u001b[${row};${col}R`;
          void client.stdin(sid, resp).catch(() => {});
          return true;
        }
        return false;
      });

      // Primary Device Attributes (DA): CSI c
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (term as any).parser?.registerCsiHandler?.({ final: "c" }, (_params: number[]) => {
        const sid = termSessionIdRef.current;
        if (!sid) return true;
        // Identify as xterm-like with common capabilities.
        void client.stdin(sid, "\u001b[?62;1;2;6;7;8;9;15;18;21;22c").catch(() => {});
        return true;
      });

      // Secondary Device Attributes (DA2): CSI > c
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (term as any).parser?.registerCsiHandler?.({ prefix: ">", final: "c" }, (_params: number[]) => {
        const sid = termSessionIdRef.current;
        if (!sid) return true;
        // "xterm" style DA2 response: Pp; Pv; Pc
        void client.stdin(sid, "\u001b[>0;276;0c").catch(() => {});
        return true;
      });
    } catch {}

    // Handle OSC 10/11 (foreground/background color query) for agent CLI.
    // Agent may send ESC]10;?BEL / ESC]11;?BEL to query colors.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (term as any).parser?.registerOscHandler?.(10, (data: string) => {
        if (data !== "?") return false;
        const sid = termSessionIdRef.current;
        if (!sid) return true;
        // Respond with a black foreground color (rgb:0000/0000/0000).
        // Send BOTH BEL and ST terminated variants (different TUIs accept different forms).
        void client
          .stdin(sid, "\x1b]10;rgb:0000/0000/0000\x07\x1b]10;rgb:0000/0000/0000\x1b\\")
          .catch(() => {});
        return true;
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (term as any).parser?.registerOscHandler?.(11, (data: string) => {
        if (data !== "?") return false;
        const sid = termSessionIdRef.current;
        if (!sid) return true;
        // Respond with a white background color (rgb:ffff/ffff/ffff).
        // Send BOTH BEL and ST terminated variants (different TUIs accept different forms).
        void client
          .stdin(sid, "\x1b]11;rgb:ffff/ffff/ffff\x07\x1b]11;rgb:ffff/ffff/ffff\x1b\\")
          .catch(() => {});
        return true;
      });
    } catch {}

    client.onMsg = (m: TermServerMsg) => {
      if (m.t === "term.data" && m.sessionId === termSessionIdRef.current) {
        term.write(m.data);
        logTerm("term.data", { sessionId: m.sessionId, bytes: m.data.length, head: m.data.slice(0, 24) });
        // Cursor Agent interactive UI sometimes only renders after an initial keypress/resize.
        // Nudge once after the banner appears (works for both cursor PTY and cursor-cli PTY).
        if ((termModeRef.current === "cursor" || termModeRef.current === "cursor-cli") && !cursorPromptNudgedRef.current) {
          if (m.data.includes("Cursor Agent")) {
            cursorPromptNudgedRef.current = true;
            const sid = termSessionIdRef.current;
            if (sid) {
              logTerm("nudge prompt: sending Enter", { sessionId: sid, termMode: termModeRef.current });
              setTimeout(() => {
                void client.stdin(sid, "\r").catch(() => {});
                void client.resize(sid, term.cols, term.rows).catch(() => {});
              }, 200);
            }
          }
        }
      }
      if (m.t === "term.exit" && m.sessionId === termSessionIdRef.current) {
        logTerm("term.exit", { sessionId: m.sessionId, code: m.code });
        // Clear session so new keystrokes can be buffered for the next open.
        termSessionIdRef.current = "";
        cursorPromptNudgedRef.current = false;
        // In PTY TUI modes, don't print a shell prompt, but do show exit for debugging.
        if (termModeRef.current === "codex") {
          term.write(`\r\n[codex exited ${m.code ?? "?"}]\r\n`);
        } else if (termModeRef.current === "cursor") {
          term.write(`\r\n[cursor exited ${m.code ?? "?"}]\r\n`);
        } else if (termModeRef.current === "cursor-cli") {
          term.write(`\r\n[cursor-cli exited ${m.code ?? "?"}]\r\n`);
        } else {
          term.write(`\r\n[exit ${m.code ?? "?"}]\r\n$ `);
        }
      }
    };

    let disposed = false;
    client
      .connect()
      .then(() => {
        if (disposed) return;
        // Don't print a prompt here; prompts are managed per-session.
      })
      .catch((e) => {
        term.write(`\r\n[ws error] ${e?.message ?? String(e)}\r\n`);
      });

    term.onData((data) => {
      const sid = termSessionIdRef.current;
      if (!sid) {
        // Session is still opening; buffer keystrokes so user can type immediately after switching modes.
        termPendingStdinRef.current += data;
        return;
      }
      // Local echo with basic editing (server doesn't echo input back).
      // Also: in restricted mode, typing `codex` + Enter will switch to codex mode.
      const isEnter = data === "\r" || data === "\n" || data === "\r\n";
      if (termModeRef.current === "restricted") {
        if (data === "\u007f" || data === "\b") {
          termInputBufRef.current = termInputBufRef.current.slice(0, -1);
          term.write("\b \b");
        } else if (isEnter) {
          const line = termInputBufRef.current.trim();
          termInputBufRef.current = "";
          term.write("\r\n");
          if (line === "codex") {
            term.write("[starting codex…]\r\n");
            setTermMode("codex");
            return; // don't send to restricted backend
          }
        } else {
          termInputBufRef.current += data;
          term.write(data);
        }
      } else if (termModeRef.current === "codex" || termModeRef.current === "cursor" || termModeRef.current === "cursor-cli") {
        // In PTY TUI mode (codex/cursor/cursor-cli), the remote process echoes input itself.
      } else {
        // native: echo locally (server doesn't echo input)
        if (data === "\u007f" || data === "\b") term.write("\b \b");
        else term.write(data);
      }
      void client.stdin(sid, data).catch((e) => {
        if (termModeRef.current === "codex" || termModeRef.current === "cursor-cli") {
          term.write(`\r\n[error] ${e?.message ?? String(e)}\r\n`);
        } else {
          term.write(`\r\n[error] ${e?.message ?? String(e)}\r\n$ `);
        }
      });
    });

    // Fit on container resize (more reliable than window resize in mobile browsers).
    const ro = new ResizeObserver(() => {
      safeFitTerm();
      const sid = termSessionIdRef.current;
      if (!sid) return;
      void client.resize(sid, term.cols, term.rows).catch(() => {});
    });
    ro.observe(el);
    termResizeObsRef.current = ro;

    return () => {
      // Intentionally do NOT dispose on tab switches; only mark disposed for connect() continuation.
      disposed = true;
    };
  }, [safeFitTerm, terminalVisible]);

  // When switching back from Cursor (chat) to terminal, the xterm container may have been hidden.
  // Trigger a fit + backend resize so the terminal renders correctly.
  useEffect(() => {
    if (!terminalVisible) return;
    if (termMode === "cursor") return;
    requestAnimationFrame(() => requestAnimationFrame(() => safeFitTerm()));
    const sid = termSessionIdRef.current;
    const term = termRef.current;
    const client = termClientRef.current;
    if (sid && term && client) {
      void client.resize(sid, term.cols, term.rows).catch(() => {});
    }
  }, [terminalVisible, termMode, safeFitTerm]);

  // Terminal cleanup (unmount only)
  useEffect(() => {
    return () => {
      try {
        termResizeObsRef.current?.disconnect();
      } catch {}
      termResizeObsRef.current = null;
      try {
        // Avoid closing WS during HMR to prevent dropping live PTY sessions.
        // In production/unload, the browser will close the socket anyway.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isHmr = (import.meta as any)?.hot;
        if (!isHmr) {
          termClientRef.current?.close();
        }
      } catch {}
      try {
        termRef.current?.dispose();
      } catch {}
      termRef.current = null;
      fitRef.current = null;
      termClientRef.current = null;
      termSessionIdRef.current = "";
      termInitedRef.current = false;
    };
  }, []);

  // (Re)open terminal session when root changes or mode changes.
  useEffect(() => {
    const client = termClientRef.current;
    const term = termRef.current;
    if (!terminalVisible || !client || !term || !terminalCwd) return;

    // Cursor (chat panel) is NOT a terminal backend mode.
    // Do not open a WS term session; close any existing one to avoid confusing errors like:
    // "[error] term: Unknown mode: cursor"
    if (termMode === "cursor") {
      (async () => {
        const old = termSessionIdRef.current;
        if (old) {
          termSessionIdRef.current = "";
          lastOpenKeyRef.current = "";
          cursorPromptNudgedRef.current = false;
          await client.closeSession(old).catch(() => {});
        }
      })();
      return;
    }

    const openKey =
      `${terminalCwd}::${termMode}` +
      (termMode === "cursor" ? `::${cursorMode}` : "") +
      (termMode === "cursor-cli" ? `::${cursorCliMode}` : "");

    // Only reopen if we don't already have the correct session open.
    if (termSessionIdRef.current && lastOpenKeyRef.current === openKey) {
      return;
    }

    (async () => {
      try {
        logTerm("open session begin", { terminalCwd, termMode, cursorMode, cursorCliMode, openKey });

        // Close previous session if any.
        if (termSessionIdRef.current) {
          const old = termSessionIdRef.current;
          termSessionIdRef.current = "";
          lastOpenKeyRef.current = "";
          logTerm("closing previous session", { old });
          await client.closeSession(old).catch(() => {});
        }
        
        // Determine actual mode for WebSocket
        let actualMode: "restricted" | "codex" | "cursor-cli-agent" | "cursor-cli-plan" | "cursor-cli-ask";
        if (termMode === "cursor-cli") {
          actualMode = `cursor-cli-${cursorCliMode}` as any;
        } else {
          actualMode = termMode as any;
        }
        logTerm("actualMode", { actualMode });
        
        // Reset terminal when switching into codex/cursor-cli mode to avoid polluting the TUI.
        if (termMode === "codex" || termMode === "cursor-cli") {
          term.reset();
        } else {
          term.write(`\r\n[session] opening at ${terminalCwd}\r\n`);
        }

        const resp = await client.open(terminalCwd, term.cols, term.rows, actualMode);
        if (!resp.ok || !resp.sessionId) throw new Error(resp.error ?? "term.open failed");
        termSessionIdRef.current = resp.sessionId;
        lastOpenKeyRef.current = openKey;
        cursorPromptNudgedRef.current = false;
        logTerm("open session ok", { sessionId: resp.sessionId, cwd: resp.cwd, mode: resp.mode });
        // After session opens, force focus back to xterm.
        // This helps when the mode button/dropdown stole focus.
        term.focus();
        requestAnimationFrame(() => term.focus());

        // Send a single resize event to initialize the PTY dimensions
        logTerm("resize after open", { sessionId: resp.sessionId, cols: term.cols, rows: term.rows });
        void client.resize(resp.sessionId, term.cols, term.rows).catch(() => {});

        // For cursor modes, wait a bit for UI to render, then send a dummy input to keep the session alive
        if (termMode === "cursor") {
          await new Promise((r) => setTimeout(r, 1500));
          // Send a single space to wake up the interactive prompt (will be visible but harmless)
          await client.stdin(resp.sessionId, " ").catch(() => {});
        }

        // Flush any keystrokes typed while the session was opening.
        const pending = termPendingStdinRef.current;
        if (pending) {
          termPendingStdinRef.current = "";
          await client.stdin(resp.sessionId, pending).catch(() => {});
        }

        if (termMode !== "codex" && termMode !== "cursor" && termMode !== "cursor-cli") term.write("$ ");
      } catch (e: any) {
        lastOpenKeyRef.current = "";
        setStatus(`[error] term: ${e?.message ?? String(e)}`);
      }
    })();
  }, [terminalCwd, terminalVisible, termMode, cursorMode, cursorCliMode]);

  const ExplorerPanel = (
    <div className={"panel" + (isMobile && mobileTab !== "explorer" ? " hidden" : "")} style={{ flex: isMobile ? 1 : undefined }}>
      <div className="panelHeader">
        <h2>Files</h2>
      </div>
      <div className="panelBody">
        <div className="fileList">
          {tree ? (
            <TreeView
              node={tree}
              depth={0}
              activeFile={activeFile}
              onToggleDir={toggleDir}
              onOpenFile={openFile}
              onOpenTerminalDir={(n) => {
                setTerminalCwd(n.path);
                if (isMobile) setMobileTab("terminal");
              }}
            />
          ) : (
            <div className="fileMeta">{ready ? "loading…" : "no roots"}</div>
          )}
        </div>
      </div>
    </div>
  );

  const EditorPanel = (
    <div
      className={"panel" + (isMobile && mobileTab !== "editor" ? " hidden" : "")}
      style={{
        flex: isMobile ? 1 : undefined,
        height: isMobile ? undefined : `${100 - topHeight}%`,
        minHeight: isMobile ? undefined : 0,
      }}
    >
      {openTabs.length ? (
        <div className="tabStrip" role="tablist" aria-label="Open files">
          {openTabs.map((p) => {
            const isActive = p === activeFile;
            const isDirty = fileStateByPath[p]?.dirty;
            return (
              <div
                key={p}
                className={"fileTab" + (isActive ? " fileTabActive" : "")}
                role="tab"
                aria-selected={isActive}
                tabIndex={0}
                title={p}
                onClick={() => setActiveFile(p)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setActiveFile(p);
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {baseName(p)}
                  {isDirty ? " •" : ""}
                </span>
                <button
                  className="tabClose"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(p);
                  }}
                  aria-label={`Close ${baseName(p)}`}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="panelHeader">
        <h2>Editor</h2>
        <div className="row" style={{ marginLeft: "auto" }}>
          <div className="segmented" aria-label="Editor mode">
            <button className={"segBtn" + (editorMode === "edit" ? " segBtnActive" : "")} onClick={() => setEditorMode("edit")}>
              Edit
            </button>
            <button
              className={"segBtn" + (editorMode === "preview" ? " segBtnActive" : "")}
              onClick={() => setEditorMode("preview")}
              disabled={!activeFile}
              title={!activeFile ? "Open a file first" : "Preview with highlight.js"}
            >
              Preview
            </button>
          </div>
          <span className="fileMeta" title={activeFile}>
            {activeFile ? baseName(activeFile) : "(no file)"}
            {dirty ? " *" : ""}
          </span>
          {fileInfo ? <span className="fileMeta">{bytes(fileInfo.size)}</span> : null}
          <button className="btn" onClick={save} disabled={!activeFile || !dirty}>
            Save
          </button>
        </div>
      </div>
      {editorMode === "preview" && activeFile ? (
        <CodePreview path={activeFile} code={fileText} />
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
          <Editor
            value={fileText}
            path={activeFile || "untitled.txt"}
            defaultLanguage="plaintext"
            language={activeFile ? languageFromPath(activeFile) ?? "plaintext" : "plaintext"}
            onChange={(v) => {
              const next = v ?? "";
              if (!activeFile) return;
              setFileStateByPath((prev) => ({
                ...prev,
                [activeFile]: { text: next, dirty: true, info: prev[activeFile]?.info ?? null },
              }));
            }}
            theme="vs"
            options={{
              fontFamily: "var(--mono)",
              fontSize: 12,
              minimap: { enabled: false },
              wordWrap: "on",
              scrollBeyondLastLine: false,
              smoothScrolling: true,
            }}
          />
        </div>
      )}
    </div>
  );

  const TerminalPanel = (
    <div
      className={"panel" + (isMobile && mobileTab !== "terminal" ? " hidden" : "")}
      style={{
        flex: isMobile ? 1 : undefined,
        height: isMobile ? undefined : `${topHeight}%`,
        minHeight: isMobile ? undefined : 0,
      }}
    >
      <div className="panelHeader">
        <h2>Terminal</h2>
        <span
          className="fileMeta"
          title={terminalCwd}
          style={{
            marginLeft: 8,
            maxWidth: 520,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {terminalCwd ? `cwd: ${terminalCwd}` : ""}
        </span>
        <div className="row" style={{ marginLeft: "auto", gap: "8px", alignItems: "center" }}>
          <div className="segmented" aria-label="Terminal mode">
            <button className={"segBtn" + (termMode === "restricted" ? " segBtnActive" : "")} onClick={() => {
              setTermMode("restricted");
              termRef.current?.focus();
              setTimeout(() => termRef.current?.focus(), 50);
            }}>
              Restricted
            </button>
            <button className={"segBtn" + (termMode === "codex" ? " segBtnActive" : "")} onClick={() => {
              setTermMode("codex");
              termRef.current?.focus();
              setTimeout(() => termRef.current?.focus(), 50);
            }}>
              Codex
            </button>
            <button
              className={"segBtn" + (termMode === "cursor" ? " segBtnActive" : "")}
              onClick={() => {
                setTermMode("cursor");
              }}
              title="Cursor AI (non-interactive mode)"
            >
              Cursor
            </button>
          </div>
        </div>
      </div>
      
      {/* Keep both views mounted; toggle visibility to avoid xterm losing its container */}
      <div style={{ display: termMode === "cursor" ? "block" : "none", flex: 1, minHeight: 0 }}>
        <CursorChatPanel mode={cursorMode} onModeChange={setCursorMode} cwd={terminalCwd} />
      </div>
      <div
        className="term"
        ref={termDivRef}
        style={{ display: termMode === "cursor" ? "none" : "block" }}
        onMouseDown={() => termRef.current?.focus()}
        onTouchStart={() => termRef.current?.focus()}
      />
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <div className="app">
        <div className="panel" style={{ width: isMobile ? "auto" : `${leftWidth}px`, minWidth: isMobile ? "auto" : "200px" }}>
          <div className="panelHeader">
            <h2>Explorer</h2>
            <div className="row" style={{ marginLeft: "auto" }}>
              <select
                className="select"
                value={activeRoot}
                onChange={(e) => {
                  setActiveRoot(e.target.value);
                  setTerminalCwd(e.target.value);
                  setOpenTabs([]);
                  setActiveFile("");
                  setFileStateByPath({});
                  setEditorMode("edit");
                }}
                disabled={roots.length === 0}
                title="roots"
              >
                {roots.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="panelBody">
            <div className="fileList">
              {tree ? (
                <TreeView
                  node={tree}
                  depth={0}
                  activeFile={activeFile}
                  onToggleDir={toggleDir}
                  onOpenFile={openFile}
                  onOpenTerminalDir={(n) => {
                    setTerminalCwd(n.path);
                    if (isMobile) setMobileTab("terminal");
                  }}
                />
              ) : (
                <div className="fileMeta">{ready ? "loading…" : "no roots"}</div>
              )}
            </div>
          </div>
        </div>

        {!isMobile && (
          <div className="resizer" onMouseDown={() => setIsDragging(true)} title="Drag to resize" />
        )}

        <div className="right" style={{ flex: isMobile ? undefined : 1 }} ref={rightPanelRef}>
          {EditorPanel}
          {!isMobile && (
            <div className="resizerVertical" onMouseDown={() => setIsDraggingVertical(true)} title="Drag to resize" />
          )}
          {TerminalPanel}
        </div>
      </div>

      {/* Mobile */}
      {isMobile ? (
        <div className="appMobile">
          <div className="topbar">
            <select
              className="select"
              value={activeRoot}
              onChange={(e) => {
                setActiveRoot(e.target.value);
                setTerminalCwd(e.target.value);
                setOpenTabs([]);
                setActiveFile("");
                setFileStateByPath({});
                setEditorMode("edit");
              }}
              disabled={roots.length === 0}
              title="roots"
              style={{ flex: 1, minWidth: 0 }}
            >
              {roots.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            <div className="tabs">
              <button className={"tabBtn" + (mobileTab === "explorer" ? " tabBtnActive" : "")} onClick={() => setMobileTab("explorer")}>
                Files
              </button>
              <button className={"tabBtn" + (mobileTab === "editor" ? " tabBtnActive" : "")} onClick={() => setMobileTab("editor")}>
                Editor
              </button>
              <button className={"tabBtn" + (mobileTab === "terminal" ? " tabBtnActive" : "")} onClick={() => setMobileTab("terminal")}>
                Terminal
              </button>
            </div>
          </div>

          {ExplorerPanel}
          {EditorPanel}
          {TerminalPanel}
        </div>
      ) : null}

      {status ? (
        <div
          style={{
            position: "fixed",
            top: 12,
            right: 12,
            background: "rgba(255,255,255,0.92)",
            border: "1px solid var(--border)",
            borderRadius: 14,
            padding: "10px 12px",
            fontFamily: "var(--mono)",
            fontSize: 12,
            color: "var(--text)",
            boxShadow: "var(--shadow)",
            maxWidth: 520,
            zIndex: 50,
          }}
        >
          {status}
        </div>
      ) : null}
    </>
  );
}

