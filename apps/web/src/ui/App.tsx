import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import hljs from "highlight.js";
import { apiList, apiRead, apiRoots, apiWrite, type FsEntry } from "../api";
import { TermClient, type TermServerMsg } from "../wsTerm";

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
  const [topHeight, setTopHeight] = useState(60); // Editor 高度百分比
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
  const [termMode, setTermMode] = useState<"restricted" | "codex" | "cursor">("restricted");
  const termModeRef = useRef<"restricted" | "codex" | "cursor">("restricted");
  const [cursorMode, setCursorMode] = useState<"agent" | "plan" | "ask">("agent");
  const [quickPrompt, setQuickPrompt] = useState("");
  const [cursorThreadId, setCursorThreadId] = useState<string>("");
  const [showCursorDropdown, setShowCursorDropdown] = useState(false);
  const termInitedRef = useRef(false);
  const termResizeObsRef = useRef<ResizeObserver | null>(null);
  const termInputBufRef = useRef<string>("");

  const terminalVisible = !isMobile || mobileTab === "terminal";

  useEffect(() => {
    termModeRef.current = termMode;
  }, [termMode]);

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
      if (newHeightPercent >= 30 && newHeightPercent <= 80) {
        setTopHeight(newHeightPercent);
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

    // Ensure Codex TUI can query cursor position (CSI 6 n).
    // xterm.js may not always send CPR fast enough for strict clients; respond explicitly.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (term as any).parser?.registerCsiHandler?.({ final: "n" }, (params: number[]) => {
        if (params?.[0] !== 6) return false;
        const sid = termSessionIdRef.current;
        if (!sid) return true;
        // xterm uses 0-based cursor position
        const row = term.buffer.active.cursorY + 1;
        const col = term.buffer.active.cursorX + 1;
        const resp = `\u001b[${row};${col}R`;
        void client.stdin(sid, resp).catch(() => {});
        return true;
      });
    } catch {}

    client.onMsg = (m: TermServerMsg) => {
      if (m.t === "term.data" && m.sessionId === termSessionIdRef.current) {
        term.write(m.data);
      }
      if (m.t === "term.exit" && m.sessionId === termSessionIdRef.current) {
        // In codex TUI mode, do not print extra prompts; let codex control the screen.
        if (termModeRef.current !== "codex") term.write(`\r\n[exit ${m.code ?? "?"}]\r\n$ `);
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
      if (!sid) return;
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
      } else if (termModeRef.current === "codex") {
        // In codex TUI mode (PTY), the remote process echoes input itself.
      } else {
        // native: echo locally (server doesn't echo input)
        if (data === "\u007f" || data === "\b") term.write("\b \b");
        else term.write(data);
      }
      void client.stdin(sid, data).catch((e) => {
        if (termModeRef.current === "codex") {
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

  // Terminal cleanup (unmount only)
  useEffect(() => {
    return () => {
      try {
        termResizeObsRef.current?.disconnect();
      } catch {}
      termResizeObsRef.current = null;
      try {
        termClientRef.current?.close();
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

  // (Re)open terminal session when root changes.
  useEffect(() => {
    const client = termClientRef.current;
    const term = termRef.current;
    if (!terminalVisible || !client || !term || !terminalCwd) return;

    (async () => {
      try {
        // Close previous session if any.
        if (termSessionIdRef.current) {
          const old = termSessionIdRef.current;
          termSessionIdRef.current = "";
          await client.closeSession(old).catch(() => {});
        }
        
        // Determine actual mode for WebSocket
        let actualMode: "restricted" | "codex" | "agent" | "plan" | "ask" = termMode === "cursor" ? cursorMode : termMode;
        
        // Reset terminal when switching into codex/cursor mode to avoid polluting the TUI.
        if (termMode === "codex" || termMode === "cursor") {
          term.reset();
        } else {
          term.write(`\r\n[session] opening at ${terminalCwd}\r\n`);
        }

        // Build options for cursor modes
        const options = termMode === "cursor" ? {
          prompt: quickPrompt || undefined,
          resume: cursorThreadId || undefined,
        } : undefined;

        const resp = await client.open(terminalCwd, term.cols, term.rows, actualMode, options);
        if (!resp.ok || !resp.sessionId) throw new Error(resp.error ?? "term.open failed");
        termSessionIdRef.current = resp.sessionId;
        
        // Save threadId for resume functionality
        if (resp.threadId) {
          setCursorThreadId(resp.threadId);
        }
        
        // Clear quick prompt after use
        if (quickPrompt) {
          setQuickPrompt("");
        }
        
        if (termModeRef.current !== "codex" && termModeRef.current !== "cursor") term.write("$ ");
      } catch (e: any) {
        setStatus(`[error] term: ${e?.message ?? String(e)}`);
      }
    })();
  }, [terminalCwd, terminalVisible, termMode, cursorMode, quickPrompt]);

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
      style={{ flex: isMobile ? 1 : undefined, height: isMobile ? undefined : `${topHeight}%`, minHeight: isMobile ? undefined : 0 }}
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
    <div className={"panel" + (isMobile && mobileTab !== "terminal" ? " hidden" : "")} style={{ flex: isMobile ? 1 : 1, minHeight: isMobile ? undefined : 0 }}>
      <div className="panelHeader">
        <h2>Terminal</h2>
        <div className="row" style={{ marginLeft: "auto", gap: "8px", alignItems: "center" }}>
          <div className="segmented" aria-label="Terminal mode">
            <button className={"segBtn" + (termMode === "restricted" ? " segBtnActive" : "")} onClick={() => setTermMode("restricted")}>
              Restricted
            </button>
            <button className={"segBtn" + (termMode === "codex" ? " segBtnActive" : "")} onClick={() => setTermMode("codex")}>
              Codex
            </button>
            <div className="cursorBtnWrapper" style={{ position: "relative" }}>
              <button 
                className={"segBtn" + (termMode === "cursor" ? " segBtnActive" : "")} 
                onClick={() => {
                  setTermMode("cursor");
                  setShowCursorDropdown(!showCursorDropdown);
                }}
                onBlur={(e) => {
                  // Only hide if focus is not moving to dropdown
                  if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) {
                    setTimeout(() => setShowCursorDropdown(false), 150);
                  }
                }}
              >
                Cursor ({cursorMode}) ▼
              </button>
              {showCursorDropdown && (
                <div className="cursorDropdown">
                  <button onClick={() => { setCursorMode("agent"); setShowCursorDropdown(false); setTermMode("cursor"); }}>
                    Agent
                  </button>
                  <button onClick={() => { setCursorMode("plan"); setShowCursorDropdown(false); setTermMode("cursor"); }}>
                    Plan
                  </button>
                  <button onClick={() => { setCursorMode("ask"); setShowCursorDropdown(false); setTermMode("cursor"); }}>
                    Ask
                  </button>
                </div>
              )}
            </div>
          </div>
          
          {termMode === "cursor" && (
            <>
              <input
                type="text"
                className="promptInput"
                placeholder="Quick prompt (Enter to run)..."
                value={quickPrompt}
                onChange={(e) => setQuickPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && quickPrompt.trim()) {
                    // Trigger session restart with prompt by changing terminalCwd state
                    setTerminalCwd(terminalCwd);
                  }
                }}
                style={{ flex: 1, maxWidth: "300px" }}
              />
              {cursorThreadId && (
                <button 
                  className="btn" 
                  onClick={() => {
                    // Clear prompt and trigger resume
                    setQuickPrompt("");
                    setTerminalCwd(terminalCwd);
                  }}
                  title="Resume last conversation"
                  style={{ fontSize: "11px", padding: "4px 8px" }}
                >
                  Resume
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <div className="term" ref={termDivRef} />
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
            left: 12,
            bottom: 12,
            right: 12,
            background: "rgba(255,255,255,0.92)",
            border: "1px solid var(--border)",
            borderRadius: 14,
            padding: "10px 12px",
            fontFamily: "var(--mono)",
            fontSize: 12,
            color: "var(--text)",
            boxShadow: "var(--shadow)",
          }}
        >
          {status}
        </div>
      ) : null}
    </>
  );
}

