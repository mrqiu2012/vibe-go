import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { loader } from "@monaco-editor/react";

// Load monaco from node_modules (served at /vs by Vite)
loader.config({
  paths: {
    vs: "/vs",
  },
});
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import hljs from "highlight.js";
import { 
  apiList, 
  apiRead, 
  apiRoots, 
  apiWrite, 
  apiMkdir,
  apiGetWorkspaces,
  apiCreateWorkspace,
  apiSetActiveWorkspace,
  apiDeleteWorkspace,
  apiGetLastOpenedFile,
  apiSetLastOpenedFile,
  apiGetActiveRoot,
  apiSetActiveRoot,
  apiUrl,
  type FsEntry,
  type Workspace,
} from "../api";
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
  const name = baseName(lower);
  if (name === "dockerfile" || name.startsWith("dockerfile.")) return "dockerfile";
  if (name === "makefile" || name === "gnumakefile") return "makefile";
  if (name === ".env" || name.endsWith(".env")) return "dotenv";
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
    case "jsonc":
      return "json";
    case "cjs":
    case "mjs":
      return "javascript";
    case "css":
      return "css";
    case "scss":
    case "sass":
    case "less":
      return "scss";
    case "html":
      return "xml";
    case "xml":
    case "svg":
      return "xml";
    case "md":
      return "markdown";
    case "mdx":
      return "markdown";
    case "py":
      return "python";
    case "sh":
    case "bash":
    case "zsh":
      return "bash";
    case "ps1":
      return "powershell";
    case "yml":
    case "yaml":
      return "yaml";
    case "toml":
      return "toml";
    case "ini":
    case "cfg":
      return "ini";
    case "go":
      return "go";
    case "rs":
      return "rust";
    case "java":
      return "java";
    case "kt":
    case "kts":
      return "kotlin";
    case "swift":
      return "swift";
    case "rb":
      return "ruby";
    case "php":
      return "php";
    case "sql":
      return "sql";
    case "c":
    case "h":
      return "c";
    case "cc":
    case "cpp":
    case "cxx":
    case "hpp":
    case "hh":
    case "hxx":
      return "cpp";
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

function findNode(tree: TreeNode, targetPath: string): TreeNode | null {
  if (tree.path === targetPath) return tree;
  if (!tree.children) return null;
  for (const child of tree.children) {
    const found = findNode(child, targetPath);
    if (found) return found;
  }
  return null;
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
  const [copyOpen, setCopyOpen] = useState(false);
  const copyMenuRef = useRef<HTMLDivElement>(null);

  const copyToClipboard = useCallback((text: string) => {
    const done = () => setCopyOpen(false);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
      return;
    }
    // Fallback for non-secure context or when clipboard API is unavailable
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } finally {
      done();
    }
  }, []);

  useEffect(() => {
    if (!copyOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (copyMenuRef.current && !copyMenuRef.current.contains(e.target as Node)) setCopyOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [copyOpen]);

  return (
    <div className="fileTreeNode" data-depth={depth} style={{ ["--tree-indent" as any]: `${indent}px` }}>
      <div
        className={"fileRow" + (isActive ? " fileRowActive" : "")}
        data-path={node.path}
        onClick={() => {
          if (node.type === "dir") props.onToggleDir(node);
          else if (node.type === "file") props.onOpenFile(node);
        }}
        title={node.path}
      >
        <div className="fileRowLeft">
          <span className="fileCaret" style={{ color: node.type === "dir" ? "var(--accent)" : "var(--text)" }}>
            {node.type === "dir" ? (node.expanded ? "▾" : "▸") : " "}
          </span>
          <span className="fileName">{node.name}</span>
          {node.loading ? <span className="fileMeta">加载中…</span> : null}
        </div>

        <div className="dirActions" onClick={(e) => e.stopPropagation()}>
          <div className="copyPathWrap" ref={copyMenuRef}>
            <button
              type="button"
              className="copyPathBtn"
              onClick={() => setCopyOpen((o) => !o)}
              title="复制文件名或路径"
              aria-label="复制"
            >
              ⎘
            </button>
            {copyOpen ? (
              <div className="copyPathMenu">
                <button type="button" onClick={() => copyToClipboard(node.name)}>复制文件名</button>
                <button type="button" onClick={() => copyToClipboard(node.path)}>复制路径</button>
              </div>
            ) : null}
          </div>
          {node.type === "dir" ? (
            <button className="dirTermBtn" onClick={() => props.onOpenTerminalDir(node)} title="在此文件夹打开终端">
              Go
            </button>
          ) : null}
        </div>
      </div>

      {node.type === "dir" && node.expanded ? (
        <div className={"fileChildren" + (depth > 0 ? " fileChildrenNested" : "")}>
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
              加载中…
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function App() {
  const [isMobile, setIsMobile] = useState(false);
  const [mobileTab, setMobileTab] = useState<"explorer" | "editor" | "terminal">("terminal");
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const [leftWidth, setLeftWidth] = useState(320);
  const [isDragging, setIsDragging] = useState(false);
  const [topHeight, setTopHeight] = useState(49); // 终端区域宽度百分比（桌面端左右分栏）
  const [isDraggingVertical, setIsDraggingVertical] = useState(false);

  // PC 端三块区域折叠状态（仅桌面端生效）
  const [panelExplorerCollapsed, setPanelExplorerCollapsed] = useState(false);
  const [panelEditorCollapsed, setPanelEditorCollapsed] = useState(false); // 编辑器默认展开
  const [panelTerminalCollapsed, setPanelTerminalCollapsed] = useState(false);

  const [roots, setRoots] = useState<string[]>([]);
  const [activeRoot, setActiveRoot] = useState("");
  const [tree, setTree] = useState<TreeNode | null>(null);
  const treeRef = useRef<TreeNode | null>(null);
  const expandingTreeRef = useRef(false);
  const lastSyncedExplorerRootRef = useRef<string>("");
  const lastSyncedExplorerPathRef = useRef<string>("");
  const manualRootOverrideRef = useRef(false);
  const autoExpandSeqRef = useRef(0);
  const autoExpandRequestRef = useRef<{ id: number; root: string; path: string } | null>(null);
  const userCollapsedByRootRef = useRef<Map<string, Set<string>>>(new Map());
  const fileListRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<string>("");
  const [terminalCwd, setTerminalCwd] = useState<string>("");

  // Auto-hide status toast after 3 seconds
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => {
      setStatus("");
    }, 3000);
    return () => clearTimeout(timer);
  }, [status]);

  // Workspace management
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>("");

  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState("");
  const [fileStateByPath, setFileStateByPath] = useState<
    Record<string, { text: string; dirty: boolean; info: { size: number; mtimeMs: number } | null }>
  >({});
  const restoredRootRef = useRef<string>("");
  const [explorerUserPath, setExplorerUserPath] = useState<string>("");

  const activeState = activeFile ? fileStateByPath[activeFile] : undefined;
  const fileText = activeState?.text ?? "";
  const dirty = activeState?.dirty ?? false;
  const fileInfo = activeState?.info ?? null;

  const termAreaWrapRef = useRef<HTMLDivElement | null>(null);
  const termDivRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termClientRef = useRef<TermClient | null>(null);
  const termSessionIdRef = useRef<string>("");
  const termSessionModeRef = useRef<"restricted" | "codex" | "agent" | "plan" | "ask" | "native" | "">("");
  const termSessionIsPtyRef = useRef(false);
  const termPendingStdinRef = useRef<string>(""); // buffer keystrokes before a session is ready
  // Buffer term.data that arrives before term.open.resp (sessionId not set yet) so we don't drop initial output
  const termPendingDataBufferRef = useRef<Map<string, string[]>>(new Map());
  const [termMode, setTermMode] = useState<"restricted" | "codex" | "cursor" | "cursor-cli">("cursor");
  const termModeRef = useRef<"restricted" | "codex" | "cursor" | "cursor-cli">("cursor");
  const [restrictedNonce, setRestrictedNonce] = useState(0);
  const [cursorMode, setCursorMode] = useState<"agent" | "plan" | "ask">("agent");
  const cursorModeRef = useRef<"agent" | "plan" | "ask">("agent");
  const [cursorCliMode, setCursorCliMode] = useState<"agent" | "plan" | "ask">("agent");
  const cursorCliModeRef = useRef<"agent" | "plan" | "ask">("agent");
  const termCwdRef = useRef<string>("");
  const lastOpenKeyRef = useRef<string>("");
  const cursorPromptNudgedRef = useRef(false);
  const termInitedRef = useRef(false);

  const logTerm = (..._args: any[]) => {};
  const termResizeObsRef = useRef<ResizeObserver | null>(null);
  const termInputBufRef = useRef<string>("");

  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [pasteModalText, setPasteModalText] = useState("");
  const pasteModalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createModalType, setCreateModalType] = useState<"file" | "folder">("file");
  const [createModalName, setCreateModalName] = useState("");
  const [createModalParent, setCreateModalParent] = useState("");
  const createModalInputRef = useRef<HTMLInputElement | null>(null);
  const [mobileKeysVisible, setMobileKeysVisible] = useState(false);
  const mobileKeysTouchedRef = useRef(false);
  const termMobileControlsRef = useRef<HTMLDivElement | null>(null);
  const lastMobileControlsHRef = useRef<number>(-1);
  const collapsedPanelWidth = 48;
  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId],
  );
  const projectCwd = activeWorkspace?.cwd || terminalCwd;
  const splitGapPercent = 2;

  const terminalVisible = !isMobile || mobileTab === "terminal";

  const sendTermInput = useCallback((data: string) => {
    const term = termRef.current;
    const client = termClientRef.current;
    const sid = termSessionIdRef.current;
    if (!term || !client) return;
    if (!sid) {
      termPendingStdinRef.current += data;
      return;
    }

    const isPty = termSessionIsPtyRef.current;
    if (!isPty) {
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
            term.write("[启动 codex…]\r\n");
            setTermMode("codex");
            return;
          }
        } else {
          termInputBufRef.current += data;
          term.write(data);
        }
      } else {
        if (data === "\u007f" || data === "\b") term.write("\b \b");
        else term.write(data);
      }
    }

    void client.stdin(sid, data).catch((e) => {
      if (termModeRef.current === "codex" || termModeRef.current === "cursor-cli") {
        term.write(`\r\n[错误] ${e?.message ?? String(e)}\r\n`);
      } else {
        term.write(`\r\n[错误] ${e?.message ?? String(e)}\r\n$ `);
      }
    });
  }, []);

  const handleTermKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (termModeRef.current !== "cursor-cli") return;
      if (!termSessionIsPtyRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      let data: string | null = null;
      switch (e.key) {
        case "ArrowUp":
          data = "\x1b[A";
          break;
        case "ArrowDown":
          data = "\x1b[B";
          break;
        case "ArrowLeft":
          data = "\x1b[D";
          break;
        case "ArrowRight":
          data = "\x1b[C";
          break;
        case "Enter":
          data = "\r";
          break;
        case "Backspace":
          data = "\x7f";
          break;
        default:
          if (e.key.length === 1) data = e.key;
      }

      if (data) {
        e.preventDefault();
        sendTermInput(data);
      }
    },
    [sendTermInput],
  );

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
    if (!isMobile) return;
    if (termMode === "cursor") return;
    if (mobileKeysTouchedRef.current) return;
    setMobileKeysVisible(true);
  }, [isMobile, termMode]);

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
      const offsetX = e.clientX - rect.left;
      const newWidthPercent = (offsetX / rect.width) * 100;
      // newWidthPercent is the divider position from left (i.e. Editor width %)
      // We store Terminal width %, so invert it.
      if (newWidthPercent >= 30 && newWidthPercent <= 80) {
        setTopHeight(100 - newWidthPercent);
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
    // Force reflow so hidden→visible container has up-to-date dimensions (e.g. after Cursor→Codex)
    void el.offsetHeight;
    if (el.clientWidth <= 0 || el.clientHeight <= 0) {
      try {
        fit.fit();
      } catch {
        // ignore; will retry on next delayed fit
      }
      return;
    }
    const core = (term as any)?._core;
    const dims = core?._renderService?._renderer?.dimensions;
    if (!dims) {
      try {
        fit.fit();
      } catch {
        // ignore
      }
      return;
    }
    try {
      fit.fit();
    } catch {
      // ignore
    }
  }, []);

  // Mobile: when the on-screen keyboard overlays the bottom area (iOS Safari), push the terminal panes up
  // by the measured keyboard height. This keeps the last rows visible and lets xterm refit cleanly.
  useEffect(() => {
    const wrap = termAreaWrapRef.current;
    if (!wrap) return;

    if (!isMobile || !terminalVisible || termMode === "cursor") {
      wrap.style.setProperty("--term-kb-bottom", "0px");
      return;
    }

    let raf = 0;
    let lastApplied = -1;
    const vv = window.visualViewport ?? null;

    const computeKeyboardBottom = () => {
      if (!vv) return 0;
      // When the keyboard is open on iOS Safari, innerHeight often stays stable while visualViewport shrinks.
      const px = Math.round(window.innerHeight - (vv.height + vv.offsetTop));
      // Avoid reacting to minor chrome/address-bar changes; keyboard is usually much larger.
      return px >= 80 ? px : 0;
    };

    const applyNow = () => {
      const kb = computeKeyboardBottom();
      if (kb === lastApplied) return;
      lastApplied = kb;
      wrap.style.setProperty("--term-kb-bottom", `${kb}px`);
      // Let layout settle, then refit xterm so rows/cols match the new height.
      requestAnimationFrame(() => {
        safeFitTerm();
        setTimeout(safeFitTerm, 50);
      });
    };

    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        applyNow();
      });
    };

    applyNow();
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.addEventListener("focusin", schedule);
    window.addEventListener("focusout", schedule);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.removeEventListener("focusin", schedule);
      window.removeEventListener("focusout", schedule);
      wrap.style.setProperty("--term-kb-bottom", "0px");
    };
  }, [isMobile, terminalVisible, termMode, safeFitTerm]);

  // Mobile: measure the height of the "dpad + input" controls so panes can be lifted precisely
  // (instead of hardcoding a padding/bottom value).
  useEffect(() => {
    const wrap = termAreaWrapRef.current;
    if (!wrap) return;

    if (!isMobile || !terminalVisible || termMode === "cursor" || !mobileKeysVisible) {
      wrap.style.setProperty("--term-mobile-controls-h", "0px");
      lastMobileControlsHRef.current = -1;
      return;
    }

    const controls = termMobileControlsRef.current;
    if (!controls) {
      wrap.style.setProperty("--term-mobile-controls-h", "0px");
      lastMobileControlsHRef.current = -1;
      return;
    }

    let raf = 0;
    const applyNow = () => {
      const h = Math.max(0, Math.ceil(controls.getBoundingClientRect().height));
      if (h === lastMobileControlsHRef.current) return;
      lastMobileControlsHRef.current = h;
      wrap.style.setProperty("--term-mobile-controls-h", `${h}px`);
      requestAnimationFrame(() => {
        safeFitTerm();
        setTimeout(safeFitTerm, 50);
      });
    };

    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        applyNow();
      });
    };

    applyNow();
    const ro = new ResizeObserver(schedule);
    ro.observe(controls);
    window.addEventListener("resize", schedule);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      wrap.style.setProperty("--term-mobile-controls-h", "0px");
      lastMobileControlsHRef.current = -1;
    };
  }, [isMobile, terminalVisible, termMode, mobileKeysVisible, safeFitTerm]);

  // Sometimes after switching Cursor <-> Codex/Restricted, the terminal container DOM may be re-created
  // (or third-party children removed), leaving the term div empty:
  // <div class="term termPane termPaneActive"></div>
  // In that case, re-attach xterm to the current container and refit.
  const ensureTermAttached = useCallback(() => {
    const el = termDivRef.current;
    const term = termRef.current;
    if (!el || !term) return;

    const existingXterm = el.querySelector(".xterm");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const termElement = (term as any)?.element as HTMLElement | undefined | null;
    const attachedHere = termElement ? el.contains(termElement) : false;
    if (existingXterm && attachedHere) return;

    // Best-effort detach from any previous parent and clear the container before re-opening.
    try {
      if (termElement?.parentElement && termElement.parentElement !== el) {
        termElement.parentElement.removeChild(termElement);
      }
    } catch {}
    try {
      // Clear any stale nodes to avoid duplicates when re-opening.
      el.innerHTML = "";
    } catch {}
    try {
      term.open(el);
    } catch {}
  }, []);

  useEffect(() => {
    apiRoots()
      .then(async (r) => {
        setRoots(r.roots);
        let dbRoot: string | null = null;
        try {
          const res = await apiGetActiveRoot();
          dbRoot = res.root;
        } catch {}
        // Try to restore last active root from SQLite, then localStorage
        const saved = localStorage.getItem("vibego:activeRoot");
        const defaultRoot =
          ((dbRoot && r.roots.includes(dbRoot) ? dbRoot : null) ??
            (saved && r.roots.includes(saved) ? saved : null) ??
            r.roots[0]) ||
          "";
        setActiveRoot((prev) => prev || defaultRoot);
      })
      .catch((e) => setStatus(`[错误] 根目录: ${e?.message ?? String(e)}`));
  }, []);

  // Persist activeRoot to localStorage
  useEffect(() => {
    if (activeRoot) {
      localStorage.setItem("vibego:activeRoot", activeRoot);
      apiSetActiveRoot(activeRoot).catch(() => {});
    }
  }, [activeRoot]);

  useEffect(() => {
    if (activeRoot) {
      localStorage.setItem("vibego:lastExplorerRoot", activeRoot);
    }
  }, [activeRoot]);

  // Load workspaces from database on mount
  useEffect(() => {
    let cancelled = false;
    apiGetWorkspaces()
      .then((res) => {
        if (cancelled) return;
        setWorkspaces(res.workspaces);
        if (res.workspaces.length > 0) {
          // Always prefer workspace marked isActive=true, then activeId, then first one
          const activeWs =
            res.workspaces.find((w) => w.isActive) ??
            (res.activeId ? res.workspaces.find((w) => w.id === res.activeId) : null) ??
            res.workspaces[0];
          setActiveWorkspaceId(activeWs.id);
          manualRootOverrideRef.current = false;
          syncExplorerRootForCwd(activeWs.cwd, { force: true });
          setTerminalCwd(activeWs.cwd);
          // Set it as active in DB
          apiSetActiveWorkspace(activeWs.id).catch(() => {});
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const resolveRootForCwd = useCallback(
    (cwd: string) => {
      if (roots.length === 0) return "";
      let best = "";
      for (const r of roots) {
        if (cwd === r || cwd.startsWith(r + "/")) {
          if (r.length > best.length) best = r;
        }
      }
      return best || activeRoot;
    },
    [roots, activeRoot],
  );

  const syncExplorerRootForCwd = useCallback(
    (cwd: string, opts?: { force?: boolean }) => {
      if (manualRootOverrideRef.current && !opts?.force) return;
      const root = resolveRootForCwd(cwd);
      if (!root) return;
      if (root && root !== activeRoot) {
        setActiveRoot(root);
      }
    },
    [resolveRootForCwd, activeRoot],
  );

  // Workspace management functions
  const addWorkspace = useCallback(async (cwd: string) => {
    // Check if workspace already exists locally
    const existing = workspaces.find((w) => w.cwd === cwd);
    if (existing) {
      setActiveWorkspaceId(existing.id);
      manualRootOverrideRef.current = false;
      syncExplorerRootForCwd(existing.cwd, { force: true });
      setTerminalCwd(existing.cwd);
      // Update active in DB
      apiSetActiveWorkspace(existing.id).catch(() => {});
      return;
    }
    
    const newWorkspace = {
      id: `ws_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      cwd,
      name: baseName(cwd),
      isActive: true,
    };
    
    try {
      const res = await apiCreateWorkspace(newWorkspace);
      setWorkspaces((prev) => [...prev, res.workspace]);
      setActiveWorkspaceId(res.workspace.id);
      manualRootOverrideRef.current = false;
      syncExplorerRootForCwd(cwd, { force: true });
      setTerminalCwd(cwd);
    } catch {
      // Fallback: add locally anyway
      setWorkspaces((prev) => [...prev, { ...newWorkspace, createdAt: Date.now() }]);
      setActiveWorkspaceId(newWorkspace.id);
      manualRootOverrideRef.current = false;
      syncExplorerRootForCwd(cwd, { force: true });
      setTerminalCwd(cwd);
    }
  }, [workspaces, syncExplorerRootForCwd]);

  const removeWorkspace = useCallback(async (id: string) => {
    // Optimistically update UI
    setWorkspaces((prev) => {
      const next = prev.filter((w) => w.id !== id);
      // If removing active workspace, switch to another
      if (id === activeWorkspaceId && next.length > 0) {
        setActiveWorkspaceId(next[0].id);
        manualRootOverrideRef.current = false;
        syncExplorerRootForCwd(next[0].cwd, { force: true });
        setTerminalCwd(next[0].cwd);
        // Update active in DB
        apiSetActiveWorkspace(next[0].id).catch(() => {});
      } else if (next.length === 0) {
        setActiveWorkspaceId("");
        // Keep terminalCwd as activeRoot when no workspaces
      }
      return next;
    });
    
    // Delete from DB
    try {
      await apiDeleteWorkspace(id);
    } catch {}
  }, [activeWorkspaceId, syncExplorerRootForCwd]);

  const switchWorkspace = useCallback(async (id: string) => {
    const ws = workspaces.find((w) => w.id === id);
    if (ws) {
      setActiveWorkspaceId(id);
      manualRootOverrideRef.current = false;
      syncExplorerRootForCwd(ws.cwd, { force: true });
      setTerminalCwd(ws.cwd);
      // Update active in DB
      try {
        await apiSetActiveWorkspace(id);
      } catch {}
    }
  }, [workspaces, syncExplorerRootForCwd]);

  const initializedCwdRef = useRef(false);

  useEffect(() => {
    if (!activeRoot) return;
    // Only initialize terminalCwd if no workspaces loaded
    if (!initializedCwdRef.current) {
      initializedCwdRef.current = true;
      // If workspaces already loaded, don't override
      if (workspaces.length > 0) return;
      const savedCwd = localStorage.getItem("vibego:terminalCwd");
      // Only use saved cwd if it starts with the active root (valid path)
      if (savedCwd && savedCwd.startsWith(activeRoot)) {
        setTerminalCwd(savedCwd);
        return;
      }
    }
    // Only set terminalCwd from activeRoot if no workspaces
    if (workspaces.length === 0) {
      setTerminalCwd(activeRoot);
    }
  }, [activeRoot, workspaces.length]);

  // Persist terminalCwd to localStorage
  useEffect(() => {
    if (terminalCwd) {
      localStorage.setItem("vibego:terminalCwd", terminalCwd);
    }
  }, [terminalCwd]);

  useEffect(() => {
    if (roots.length === 0 || !terminalCwd) return;
    syncExplorerRootForCwd(terminalCwd);
  }, [roots.length, terminalCwd, syncExplorerRootForCwd]);

  useEffect(() => {
    if (roots.length === 0 || !projectCwd) return;
    syncExplorerRootForCwd(projectCwd);
  }, [roots.length, projectCwd, syncExplorerRootForCwd]);

  useEffect(() => {
    if (!activeRoot || !projectCwd) return;
    if (!projectCwd.startsWith(activeRoot)) return;
    localStorage.setItem(`vibego:lastExplorerPath:${activeRoot}`, projectCwd);
  }, [activeRoot, projectCwd]);

  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  const explorerTargetPath = useMemo(() => {
    if (!activeRoot) return "";
    if (explorerUserPath && explorerUserPath.startsWith(activeRoot)) return explorerUserPath;
    if (projectCwd && projectCwd.startsWith(activeRoot)) return projectCwd;
    const saved = localStorage.getItem(`vibego:lastExplorerPath:${activeRoot}`) || "";
    if (saved && saved.startsWith(activeRoot)) return saved;
    return activeRoot;
  }, [activeRoot, projectCwd, explorerUserPath]);

  useEffect(() => {
    lastSyncedExplorerRootRef.current = "";
    lastSyncedExplorerPathRef.current = "";
  }, [projectCwd, activeRoot]);

  const scrollToTerminalCwd = useCallback((): boolean => {
    if (!explorerTargetPath) return false;
    if (!fileListRef.current) return false;
    if (!isMobile && panelExplorerCollapsed) return false;
    if (isMobile && mobileTab !== "explorer") return false;
    const escape = (globalThis as any).CSS?.escape ?? ((v: string) => v.replace(/["\\]/g, "\\$&"));
    const selector = `[data-path="${escape(explorerTargetPath)}"]`;
    const target = fileListRef.current.querySelector(selector) as HTMLElement | null;
    if (!target) return false;
    target.scrollIntoView({ block: "start" });
    return true;
  }, [explorerTargetPath, isMobile, mobileTab, panelExplorerCollapsed]);

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
        setStatus(`[错误] 列表: ${e?.message ?? String(e)}`);
        setTree((t) => (t ? { ...t, loading: false } : t));
      }
    })();
  }, [activeRoot]);

  useEffect(() => {
    if (!activeRoot || !explorerTargetPath) return;
    if (!explorerTargetPath.startsWith(activeRoot)) return;
    if (!treeRef.current) return;
    if (expandingTreeRef.current) return;

    // Only skip re-expand when we already synced this path and tree changed due to user collapse.
    // Set lastSynced only after expandToPath completes so initial load and tree-with-children updates still run.
    if (
      lastSyncedExplorerRootRef.current === activeRoot &&
      lastSyncedExplorerPathRef.current === explorerTargetPath
    ) {
      return;
    }

    const rootToSync = activeRoot;
    const pathToSync = explorerTargetPath;
    const waitForNode = async (path: string, attempts = 20): Promise<TreeNode | null> => {
      for (let i = 0; i < attempts; i += 1) {
        const currentTree = treeRef.current;
        const node = currentTree ? findNode(currentTree, path) : null;
        if (node) return node;
        await new Promise((r) => setTimeout(r, 50));
      }
      return null;
    };

    const expandToPath = async () => {
      expandingTreeRef.current = true;
      try {
        const rel = pathToSync.slice(rootToSync.length).replace(/^\/+/, "");
        const parts = rel ? rel.split("/") : [];
        let currentPath = rootToSync;

        for (const part of parts) {
          currentPath = joinPath(currentPath, part);
          const node = await waitForNode(currentPath);
          if (!node || node.type !== "dir") return;

          if (!node.expanded) {
            setTree((prev) =>
              prev
                ? updateNode(prev, node.path, (n) => ({
                    ...n,
                    expanded: true,
                    loading: n.loaded ? false : true,
                  }))
                : prev,
            );
          }

          if (!node.loaded) {
            try {
              const r = await apiList(node.path);
              const children: TreeNode[] = r.entries.map((e: FsEntry) => ({
                path: joinPath(r.path, e.name),
                name: e.name,
                type: e.type,
              }));
              setTree((prev) =>
                prev
                  ? updateNode(prev, node.path, (n) => ({
                      ...n,
                      expanded: true,
                      loading: false,
                      loaded: true,
                      children,
                    }))
                  : prev,
              );
              await new Promise((r) => setTimeout(r, 0));
            } catch (e: any) {
              setStatus(`[error] list: ${e?.message ?? String(e)}`);
              setTree((prev) =>
                prev ? updateNode(prev, node.path, (n) => ({ ...n, loading: false })) : prev,
              );
              return;
            }
          }
        }
      } finally {
        expandingTreeRef.current = false;
        lastSyncedExplorerRootRef.current = rootToSync;
        lastSyncedExplorerPathRef.current = pathToSync;
        setTimeout(() => {
          scrollToTerminalCwd();
        }, 50);
      }
    };

    void expandToPath();
  }, [activeRoot, explorerTargetPath, scrollToTerminalCwd, tree]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const ok = scrollToTerminalCwd();
      if (!ok) {
        setTimeout(() => {
          scrollToTerminalCwd();
        }, 80);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [scrollToTerminalCwd, tree]);

  // Restore last opened file from SQLite when activeRoot changes
  useEffect(() => {
    if (!activeRoot) return;
    if (restoredRootRef.current === activeRoot) return;
    let cancelled = false;
    const restoreFromPath = async (path: string) => {
      if (!path.startsWith(activeRoot)) return;
      const r = await apiRead(path);
      if (cancelled) return;
      setOpenTabs((prev) => (prev.includes(r.path) ? prev : [r.path]));
      setActiveFile(r.path);
      setFileStateByPath((prev) => ({
        ...prev,
        [r.path]: { text: r.text, dirty: false, info: { size: r.size, mtimeMs: r.mtimeMs } },
      }));
      setEditorMode("edit");
    };

    apiGetLastOpenedFile(activeRoot)
      .then((res) => {
        if (cancelled) return;
        restoredRootRef.current = activeRoot;
        if (res.filePath) return restoreFromPath(res.filePath);
        const fallback = localStorage.getItem(`vibego:lastOpenedFile:${activeRoot}`);
        if (fallback) return restoreFromPath(fallback);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeRoot, activeFile, openTabs.length]);

  const toggleDir = async (node: TreeNode) => {
    setExplorerUserPath(node.path);
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
      if (!isMobile) setPanelEditorCollapsed(false); // 点击文件时若编辑器折叠则展开
      setOpenTabs((prev) => (prev.includes(r.path) ? prev : [...prev, r.path]));
      setFileStateByPath((prev) => ({
        ...prev,
        [r.path]: { text: r.text, dirty: false, info: { size: r.size, mtimeMs: r.mtimeMs } },
      }));
      if (activeRoot) apiSetLastOpenedFile(activeRoot, r.path).catch(() => {});
      if (activeRoot) {
        localStorage.setItem(`vibego:lastOpenedFile:${activeRoot}`, r.path);
      }
    } catch (e: any) {
      setStatus(`[错误] 读取: ${e?.message ?? String(e)}`);
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
      setStatus(`[成功] 已保存 ${baseName(activeFile)}`);
    } catch (e: any) {
      setStatus(`[错误] 写入: ${e?.message ?? String(e)}`);
    }
  };

  const closeTab = (path: string) => {
    const st = fileStateByPath[path];
    if (st?.dirty) {
      const ok = window.confirm(`"${baseName(path)}" 有未保存的更改。仍要关闭吗？`);
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

  const refreshDirectoryInTree = useCallback(
    async (dirPath: string) => {
      try {
        const r = await apiList(dirPath);
        const children: TreeNode[] = r.entries.map((e: FsEntry) => ({
          path: joinPath(r.path, e.name),
          name: e.name,
          type: e.type,
        }));
        if (dirPath === activeRoot) {
          setTree((prev) =>
            prev ? { ...prev, children, loaded: true, loading: false } : prev,
          );
        } else {
          setTree((prev) =>
            prev
              ? updateNode(prev, dirPath, (n) => ({
                  ...n,
                  children,
                  loaded: true,
                  loading: false,
                }))
              : prev,
          );
        }
      } catch (e: any) {
        setStatus(`[错误] 刷新: ${e?.message ?? String(e)}`);
      }
    },
    [activeRoot],
  );

  const createFolder = useCallback(() => {
    const parentDir = explorerTargetPath || activeRoot;
    if (!parentDir) return;
    setCreateModalType("folder");
    setCreateModalParent(parentDir);
    setCreateModalName("");
    setCreateModalOpen(true);
    setTimeout(() => createModalInputRef.current?.focus(), 80);
  }, [explorerTargetPath, activeRoot]);

  const createFile = useCallback(() => {
    const parentDir = explorerTargetPath || activeRoot;
    if (!parentDir) return;
    setCreateModalType("file");
    setCreateModalParent(parentDir);
    setCreateModalName("");
    setCreateModalOpen(true);
    setTimeout(() => createModalInputRef.current?.focus(), 80);
  }, [explorerTargetPath, activeRoot]);

  const handleCreateConfirm = useCallback(async () => {
    const parentDir = createModalParent;
    const rawName = createModalName.trim();
    if (!parentDir) {
      setCreateModalOpen(false);
      return;
    }
    if (!rawName) {
      setStatus("[错误] 名称不能为空");
      return;
    }
    const newPath = joinPath(parentDir, rawName);
    try {
      if (createModalType === "folder") {
        await apiMkdir(newPath);
        setStatus(`[成功] 已创建文件夹 ${rawName}`);
        await refreshDirectoryInTree(parentDir);
      } else {
        const r = await apiWrite(newPath, "");
        setStatus(`[成功] 已创建文件 ${rawName}`);
        await refreshDirectoryInTree(parentDir);
        setActiveFile(newPath);
        setEditorMode("edit");
        if (!isMobile) setPanelEditorCollapsed(false);
        setOpenTabs((prev) => (prev.includes(newPath) ? prev : [...prev, newPath]));
        setFileStateByPath((prev) => ({
          ...prev,
          [newPath]: { text: "", dirty: false, info: { size: r.size, mtimeMs: r.mtimeMs } },
        }));
      }
      setCreateModalOpen(false);
      setCreateModalName("");
    } catch (e: any) {
      setStatus(
        `[错误] 创建${createModalType === "folder" ? "文件夹" : "文件"}: ${e?.message ?? String(e)}`,
      );
    }
  }, [
    createModalParent,
    createModalName,
    createModalType,
    isMobile,
    refreshDirectoryInTree,
  ]);

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

  // Terminal init: only when a mode that shows the terminal (Codex/Restricted/cursor-cli).
  // In Cursor mode we don't create the terminal so xterm is never opened in a 0x0 hidden container.
  useEffect(() => {
    if (!terminalVisible) return;
    if (termMode === "cursor") return;
    if (termInitedRef.current) return;
    const el = termDivRef.current;
    if (!el) return;

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
    // Container is visible (Codex/Restricted/cursor-cli); fit after layout.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        safeFitTerm();
        // Extra fit after a short delay so xterm renderer is ready
        setTimeout(safeFitTerm, 50);
      });
    });
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
      if (m.t === "term.data") {
        const sid = m.sessionId;
        if (sid === termSessionIdRef.current) {
          term.write(m.data);
          logTerm("term.data", { sessionId: sid, bytes: m.data.length, head: m.data.slice(0, 24) });
          // Cursor Agent TUI sometimes only renders after resize. Nudge with resize only (Enter + resize
          // can cause full redraw and duplicate output in terminal).
          if ((termModeRef.current === "cursor" || termModeRef.current === "cursor-cli") && !cursorPromptNudgedRef.current) {
            if (m.data.includes("Cursor Agent")) {
              cursorPromptNudgedRef.current = true;
              const s = termSessionIdRef.current;
              if (s) {
                logTerm("nudge prompt: sending resize only", { sessionId: s, termMode: termModeRef.current });
                setTimeout(() => void client.resize(s, term.cols, term.rows).catch(() => {}), 200);
              }
            }
          }
        } else {
          // Buffer for Codex and Cursor CLI in case output arrives before open.resp.
          if (termModeRef.current === "codex" || termModeRef.current === "cursor-cli") {
            if (!termPendingDataBufferRef.current.has(sid)) termPendingDataBufferRef.current.set(sid, []);
            termPendingDataBufferRef.current.get(sid)!.push(m.data);
          }
        }
      }
      if (m.t === "term.exit" && m.sessionId === termSessionIdRef.current) {
        const sessionMode = termSessionModeRef.current;
        logTerm("term.exit", { sessionId: m.sessionId, code: m.code, termMode: sessionMode || termModeRef.current });
        // For PTY-based modes (codex, cursor, cursor-cli), term.exit means the whole session ended.
        // For restricted mode, term.exit only means a single command finished — keep the session open.
        if (sessionMode === "codex") {
          termSessionIdRef.current = "";
          termSessionModeRef.current = "";
          termSessionIsPtyRef.current = false;
          cursorPromptNudgedRef.current = false;
          term.write(`\r\n[codex 已退出 ${m.code ?? "?"}]\r\n`);
        } else if (
          sessionMode === "agent" ||
          sessionMode === "plan" ||
          sessionMode === "ask" ||
          sessionMode === "cursor-cli-agent" ||
          sessionMode === "cursor-cli-plan" ||
          sessionMode === "cursor-cli-ask"
        ) {
          termSessionIdRef.current = "";
          termSessionModeRef.current = "";
          termSessionIsPtyRef.current = false;
          cursorPromptNudgedRef.current = false;
          term.write(`\r\n[cursor-cli 已退出 ${m.code ?? "?"}]\r\n`);
        } else if (sessionMode === "restricted" && termSessionIsPtyRef.current) {
          termSessionIdRef.current = "";
          termSessionModeRef.current = "";
          termSessionIsPtyRef.current = false;
          term.write(`\r\n[restricted PTY 已退出 ${m.code ?? "?"}]\r\n`);
        } else {
          // restricted mode: command finished, but session stays open for more commands
          term.write(`$ `);
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
        term.write(`\r\n[WebSocket 错误] ${e?.message ?? String(e)}\r\n`);
      });

    term.onData((data) => {
      sendTermInput(data);
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
  }, [safeFitTerm, terminalVisible, termMode, sendTermInput]);

  // When switching to Codex/Restricted (including Cursor→Codex again), the xterm container may have been hidden.
  // Trigger fit + backend resize; multiple delayed fits so layout and renderer are ready.
  useEffect(() => {
    if (!terminalVisible) return;
    if (termMode === "cursor") return;
    const runFit = () => {
      ensureTermAttached();
      const el = termDivRef.current;
      if (el) void el.offsetHeight; // force reflow before fit
      safeFitTerm();
      const sid = termSessionIdRef.current;
      const term = termRef.current;
      const client = termClientRef.current;
      if (term && term.rows > 0) {
        try {
          term.refresh(0, term.rows - 1);
        } catch {}
      }
      if (sid && term && client) {
        void client.resize(sid, term.cols, term.rows).catch(() => {});
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(runFit));
    const t1 = setTimeout(runFit, 150);
    const t2 = setTimeout(runFit, 400);
    const t3 = setTimeout(runFit, 700);
    const t4 = setTimeout(runFit, 1200);
    const t5 = setTimeout(runFit, 1800);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  }, [terminalVisible, termMode, safeFitTerm, ensureTermAttached]);

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
      termSessionIsPtyRef.current = false;
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
    if (termMode === "cursor") return;

    const openKey =
      `${terminalCwd}::${termMode}` +
      (termMode === "cursor-cli" ? `::${cursorCliMode}` : "") +
      (termMode === "restricted" ? `::r${restrictedNonce}` : "");

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
          termSessionModeRef.current = "";
          termSessionIsPtyRef.current = false;
          lastOpenKeyRef.current = "";
          logTerm("closing previous session", { old });
          await client.closeSession(old).catch(() => {});
        }
        
        // Determine actual mode for WebSocket
        // Map cursor-cli modes to the backend modes: cursor-cli-agent/plan/ask
        let actualMode:
          | "restricted"
          | "native"
          | "codex"
          | "agent"
          | "plan"
          | "ask"
          | "cursor-cli-agent"
          | "cursor-cli-plan"
          | "cursor-cli-ask";
        if (termMode === "cursor-cli") {
          actualMode = `cursor-cli-${cursorCliMode}` as
            | "cursor-cli-agent"
            | "cursor-cli-plan"
            | "cursor-cli-ask";
        } else {
          actualMode = termMode; // termMode here is "restricted" | "codex"
        }
        logTerm("actualMode", { actualMode });
        
        // Reset terminal when switching into codex/cursor-cli/restricted to avoid mixing outputs.
        if (termMode === "codex" || termMode === "cursor-cli" || termMode === "restricted") {
          term.reset();
        } else {
          term.write(`\r\n[会话] 正在打开 ${terminalCwd}\r\n`);
        }

        const resp = await client.open(terminalCwd, term.cols, term.rows, actualMode);
        if (!resp.ok || !resp.sessionId) throw new Error(resp.error ?? "term.open failed");
        termSessionIdRef.current = resp.sessionId;
        termSessionModeRef.current = actualMode;
        const isPtySession =
          actualMode === "codex" ||
          actualMode === "agent" ||
          actualMode === "plan" ||
          actualMode === "ask" ||
          actualMode === "cursor-cli-agent" ||
          actualMode === "cursor-cli-plan" ||
          actualMode === "cursor-cli-ask" ||
          (actualMode === "restricted" && resp.mode === "restricted-pty");
        termSessionIsPtyRef.current = isPtySession;
        lastOpenKeyRef.current = openKey;
        cursorPromptNudgedRef.current = false;
        // Flush any term.data that arrived before term.open.resp (e.g. Codex welcome / PTY hint)
        const buf = termPendingDataBufferRef.current.get(resp.sessionId);
        if (buf?.length) {
          for (const d of buf) term.write(d);
          termPendingDataBufferRef.current.delete(resp.sessionId);
        }
        termPendingDataBufferRef.current.clear();
        logTerm("open session ok", { sessionId: resp.sessionId, cwd: resp.cwd, mode: resp.mode });
        // After session opens, force focus back to xterm.
        // This helps when the mode button/dropdown stole focus.
        term.focus();
        requestAnimationFrame(() => term.focus());

        // Send a single resize event to initialize the PTY dimensions
        logTerm("resize after open", { sessionId: resp.sessionId, cols: term.cols, rows: term.rows });
        void client.resize(resp.sessionId, term.cols, term.rows).catch(() => {});

        if (isPtySession) {
          try {
            const snap = await fetch(apiUrl(`/api/term/snapshot/${resp.sessionId}?tailBytes=20000`));
            if (snap.ok) {
              const payload = await snap.json();
              if (payload?.data && term.buffer.active.length === 0) {
                term.write(payload.data);
              } else if (!payload?.data) {
                const replay = await fetch(apiUrl(`/api/term/replay/${resp.sessionId}?tailBytes=20000`));
                if (replay.ok) {
                  const text = await replay.text();
                  if (text && term.buffer.active.length === 0) {
                    term.write(text);
                  }
                }
              }
            } else {
              const replay = await fetch(apiUrl(`/api/term/replay/${resp.sessionId}?tailBytes=20000`));
              if (replay.ok) {
                const text = await replay.text();
                if (text && term.buffer.active.length === 0) {
                  term.write(text);
                }
              }
            }
          } catch {}
        }

        // Flush any keystrokes typed while the session was opening.
        const pending = termPendingStdinRef.current;
        if (pending) {
          termPendingStdinRef.current = "";
          await client.stdin(resp.sessionId, pending).catch(() => {});
        }

        if (!isPtySession && termMode !== "codex" && termMode !== "cursor-cli") term.write("$ ");
      } catch (e: any) {
        lastOpenKeyRef.current = "";
          setStatus(`[错误] 终端: ${e?.message ?? String(e)}`);
      }
    })();
  }, [terminalCwd, terminalVisible, termMode, cursorMode, cursorCliMode]);

  const ExplorerPanel = (
    <div className={"panel" + (isMobile && mobileTab !== "explorer" ? " hidden" : "")} style={{ flex: isMobile ? 1 : undefined }}>
      <div className="panelHeader" style={{ flexDirection: "column", alignItems: "stretch" }}>
        <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
          <h2>文件</h2>
        </div>
        <div className="row" style={{ gap: 6, marginTop: 6 }}>
          <button
            type="button"
            className="segBtn"
            onClick={createFolder}
            disabled={!activeRoot}
            title="新建文件夹"
          >
            📁+
          </button>
          <button
            type="button"
            className="segBtn"
            onClick={createFile}
            disabled={!activeRoot}
            title="新建文件"
          >
            📄+
          </button>
        </div>
      </div>
      <div className="panelBody">
        <div className="fileList" ref={(el) => {
          if (el) fileListRef.current = el;
        }}>
          {tree ? (
            <TreeView
              node={tree}
              depth={0}
              activeFile={activeFile}
              onToggleDir={toggleDir}
              onOpenFile={openFile}
              onOpenTerminalDir={(n) => {
                // Auto create/switch workspace when clicking Term button
                addWorkspace(n.path);
                if (isMobile) setMobileTab("terminal");
              }}
            />
          ) : (
            <div className="fileMeta">{ready ? "加载中…" : "无根目录"}</div>
          )}
        </div>
      </div>
    </div>
  );

  // Editor panel and Terminal panel are inlined (not inner components) so that toggling
  // collapse does not change component identity and thus does not unmount/remount
  // CursorChatPanel or trigger session list refetch / terminal session reopen.

  return (
    <>
        {/* 桌面端 */}
      <div className="app">
        <div
          className={
            "panel" +
            (!isMobile && panelExplorerCollapsed ? " panelCollapsed panelExplorerCollapsed" : "")
          }
          style={{
            width: isMobile ? "auto" : panelExplorerCollapsed ? 48 : leftWidth,
            minWidth: isMobile ? "auto" : panelExplorerCollapsed ? 48 : "200px",
          }}
        >
          <div className="panelHeader" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
              <h2>Files</h2>
              {!isMobile && panelExplorerCollapsed && (
                <span style={{ writingMode: "vertical-rl", fontSize: 12, color: "var(--muted)" }}>文件</span>
              )}
              {!panelExplorerCollapsed && (
                <div className="row" style={{ marginLeft: "auto", gap: 8, alignItems: "center" }}>
                <a href="#/setup" className="setupLink" title="配置与安装指南" style={{ fontSize: 12, color: "var(--muted)" }}>
                  安装指南
                </a>
                <select
                    className="select"
                    value={activeRoot}
                    onChange={(e) => {
                      manualRootOverrideRef.current = true;
                      setActiveRoot(e.target.value);
                      setTerminalCwd(e.target.value);
                      setOpenTabs([]);
                      setActiveFile("");
                      setFileStateByPath({});
                      setEditorMode("edit");
                    setExplorerUserPath(e.target.value);
                    }}
                    disabled={roots.length === 0}
                    title="根目录"
                  >
                    {roots.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {!isMobile && (
                <button
                  type="button"
                  className="panelCollapseBtn"
                  onClick={() => setPanelExplorerCollapsed(!panelExplorerCollapsed)}
                  title={panelExplorerCollapsed ? "展开文件目录" : "折叠文件目录"}
                >
                  {panelExplorerCollapsed ? "▶" : "◀"}
                </button>
              )}
            </div>
            {!panelExplorerCollapsed && (
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                <button
                  type="button"
                  className="segBtn"
                  onClick={createFolder}
                  disabled={!activeRoot}
                  title="新建文件夹"
                >
                  📁+
                </button>
                <button
                  type="button"
                  className="segBtn"
                  onClick={createFile}
                  disabled={!activeRoot}
                  title="新建文件"
                >
                  📄+
                </button>
              </div>
            )}
          </div>
          <div className="panelBody">
            <div className="fileList" ref={(el) => {
              if (el) fileListRef.current = el;
            }}>
              {tree ? (
                <TreeView
                  node={tree}
                  depth={0}
                  activeFile={activeFile}
                  onToggleDir={toggleDir}
                  onOpenFile={openFile}
                  onOpenTerminalDir={(n) => {
                    addWorkspace(n.path);
                    if (isMobile) setMobileTab("terminal");
                  }}
                />
              ) : (
                <div className="fileMeta">{ready ? "加载中…" : "无根目录"}</div>
              )}
            </div>
          </div>
        </div>

        {!isMobile && !panelExplorerCollapsed && (
          <div className="resizer" onMouseDown={() => setIsDragging(true)} title="拖拽调整大小" />
        )}

        <div className="right" style={{ flex: isMobile ? undefined : 1 }} ref={rightPanelRef}>
          {/* Editor panel (inlined to avoid remount on collapse toggle) */}
          <div
            className={
              "panel" +
              (isMobile && mobileTab !== "editor" ? " hidden" : "") +
              (!isMobile && panelEditorCollapsed ? " panelCollapsed panelVerticalCollapsed" : "")
            }
            style={{
              flex: isMobile
                ? 1
                : panelEditorCollapsed
                  ? `0 0 ${collapsedPanelWidth}px`
                  : panelTerminalCollapsed
                    ? 1
                    : `0 0 ${Math.max(0, 100 - topHeight - splitGapPercent)}%`,
              width: isMobile
                ? undefined
                : panelEditorCollapsed
                  ? `${collapsedPanelWidth}px`
                  : panelTerminalCollapsed
                    ? undefined
                    : `${Math.max(0, 100 - topHeight - splitGapPercent)}%`,
              minWidth: isMobile ? undefined : panelEditorCollapsed ? collapsedPanelWidth : 0,
            }}
          >
            {!panelEditorCollapsed ? (
              <div className="tabStrip" role="tablist" aria-label="已打开文件">
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
                      onClick={() => {
                        setActiveFile(p);
                        if (activeRoot) apiSetLastOpenedFile(activeRoot, p).catch(() => {});
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          setActiveFile(p);
                          if (activeRoot) apiSetLastOpenedFile(activeRoot, p).catch(() => {});
                        }
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
                        aria-label={`关闭 ${baseName(p)}`}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
                {!isMobile && (
                  <div className="row" style={{ marginLeft: "auto" }}>
                    <button
                      type="button"
                      className="panelCollapseBtn"
                      onClick={() => setPanelEditorCollapsed(!panelEditorCollapsed)}
                      title="向左折叠编辑器"
                    >
                      ◀
                    </button>
                  </div>
                )}
              </div>
            ) : null}

            <div className="panelHeader">
              <h2>编辑器</h2>
              {!isMobile && panelEditorCollapsed ? (
                <span className="collapsedLabel">编辑器</span>
              ) : null}
              {!isMobile && panelEditorCollapsed ? (
                <button
                  type="button"
                  className="panelCollapseBtn"
                  onClick={() => setPanelEditorCollapsed(false)}
                  title="展开编辑器"
                >
                  ▶
                </button>
              ) : null}
              <span className="fileMeta" title={activeFile}>
                {activeFile ? baseName(activeFile) : "(无文件)"}
                {dirty ? " *" : ""}
              </span>
              {fileInfo ? <span className="fileMeta">{bytes(fileInfo.size)}</span> : null}
              {!panelEditorCollapsed ? (
                <div className="row" style={{ marginLeft: "auto" }}>
                  <div className="segmented" aria-label="编辑器模式">
                    <button className={"segBtn" + (editorMode === "edit" ? " segBtnActive" : "")} onClick={() => setEditorMode("edit")}>
                      编辑
                    </button>
                    <button
                      className={"segBtn" + (editorMode === "preview" ? " segBtnActive" : "")}
                      onClick={() => setEditorMode("preview")}
                      disabled={!activeFile}
                      title={!activeFile ? "请先打开文件" : "使用 highlight.js 预览"}
                    >
                      预览
                    </button>
                  </div>
                  <button className="segBtn" onClick={save} disabled={!activeFile || !dirty}>
                    保存
                  </button>
                </div>
              ) : null}
            </div>
            <div className="panelBody" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
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
                      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
                    }}
                  />
                </div>
              )}
            </div>
          </div>
          {!isMobile && !panelEditorCollapsed && !panelTerminalCollapsed && (
            <div className="resizerVertical" onMouseDown={() => setIsDraggingVertical(true)} title="拖拽调整大小" />
          )}
          {/* Terminal panel (inlined to avoid remount on collapse toggle) */}
          <div
            className={
              "panel" +
              (isMobile && mobileTab !== "terminal" ? " hidden" : "") +
              (!isMobile && panelTerminalCollapsed ? " panelCollapsed panelVerticalCollapsed" : "")
            }
            style={{
              flex: isMobile
                ? 1
                : panelTerminalCollapsed
                  ? `0 0 ${collapsedPanelWidth}px`
                  : panelEditorCollapsed
                    ? 1
                    : `0 0 ${topHeight}%`,
              width: isMobile
                ? undefined
                : panelTerminalCollapsed
                  ? `${collapsedPanelWidth}px`
                  : panelEditorCollapsed
                    ? undefined
                    : `${topHeight}%`,
              minWidth: isMobile
                ? undefined
                : panelTerminalCollapsed
                  ? collapsedPanelWidth
                  : termMode === "cursor-cli"
                    ? 520
                    : 0,
              minHeight: isMobile ? "65dvh" : undefined,
            }}
          >
            {!panelTerminalCollapsed ? (
            <div className="workspaceTabStrip">
              {workspaces.length === 0 ? (
                <div className="workspaceEmpty">点击文件夹的「Go」按钮打开工作区</div>
              ) : (
                workspaces.map((ws) => (
                  <div
                    key={ws.id}
                    className={"workspaceTab" + (ws.id === activeWorkspaceId ? " workspaceTabActive" : "")}
                    onClick={() => switchWorkspace(ws.id)}
                    title={ws.cwd}
                  >
                    <span className="workspaceTabName">{ws.name}</span>
                    <button
                      className="workspaceTabClose"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeWorkspace(ws.id);
                      }}
                      title="关闭工作区"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
              {!isMobile && (
                <div className="row" style={{ marginLeft: "auto" }}>
                  <button
                    type="button"
                    className="panelCollapseBtn"
                    onClick={() => setPanelTerminalCollapsed(!panelTerminalCollapsed)}
                    title={panelTerminalCollapsed ? "展开终端" : "向右折叠终端"}
                  >
                    {panelTerminalCollapsed ? "◀" : "▶"}
                  </button>
                </div>
              )}
            </div>
            ) : null}
            <div className="panelHeader termPanelHeader">
              {!isMobile && panelTerminalCollapsed ? (
                <span className="collapsedLabel">终端</span>
              ) : null}
              {!isMobile && panelTerminalCollapsed ? (
                <button
                  type="button"
                  className="panelCollapseBtn"
                  onClick={() => setPanelTerminalCollapsed(false)}
                  title="展开终端"
                >
                  ◀
                </button>
              ) : null}
              {!panelTerminalCollapsed ? (
                <div className="termPanelHeaderRow">
                  <div className="segmented" aria-label="终端模式">
                    <button
                      className={"segBtn" + (termMode === "cursor" ? " segBtnActive" : "")}
                      onClick={() => setTermMode("cursor")}
                      title="Cursor Chat（非交互模式）"
                    >
                      Cursor Chat
                    </button>
                  <button className={"segBtn" + (termMode === "codex" ? " segBtnActive" : "")} onClick={() => {
                    setTermMode("codex");
                    termRef.current?.focus();
                    setTimeout(() => termRef.current?.focus(), 50);
                  }}>
                    Codex
                  </button>
                  <button className={"segBtn" + (termMode === "cursor-cli" ? " segBtnActive" : "")} onClick={() => {
                    setTermMode("cursor-cli");
                    termRef.current?.focus();
                    setTimeout(() => termRef.current?.focus(), 50);
                  }}>
                    Cursor CLI
                  </button>
                  <button className={"segBtn" + (termMode === "restricted" ? " segBtnActive" : "")} onClick={() => {
                    setRestrictedNonce((n) => n + 1);
                    setTermMode("restricted");
                    termRef.current?.focus();
                    setTimeout(() => termRef.current?.focus(), 50);
                  }}>
                    Restricted
                  </button>
                </div>
                  <div className="row" style={{ marginLeft: "auto" }}>
                    {(termMode === "codex" || termMode === "restricted") && (
                      <button
                        type="button"
                        className="termPasteBtn"
                        title="粘贴到终端"
                        onClick={() => {
                          const sid = termSessionIdRef.current;
                          const client = termClientRef.current;
                          if (!sid || !client) return;
                          setPasteModalText("");
                          setPasteModalOpen(true);
                          setTimeout(() => pasteModalTextareaRef.current?.focus(), 80);
                        }}
                      >
                        粘贴
                      </button>
                    )}
                    {isMobile && termMode !== "cursor" ? (
                      <button
                        type="button"
                        className="termPasteBtn"
                        title={mobileKeysVisible ? "隐藏方向键" : "显示方向键"}
                        onClick={() => {
                          mobileKeysTouchedRef.current = true;
                          setMobileKeysVisible((v) => !v);
                        }}
                      >
                        {mobileKeysVisible ? "键盘" : "方向键"}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <div className="termPanelHeaderCwd" title={terminalCwd}>
                {terminalCwd ? `工作目录: ${terminalCwd}` : ""}
              </div>
            </div>
            <div
              className={
                "termAreaWrap" +
                (isMobile && terminalVisible && termMode !== "cursor" && mobileKeysVisible
                  ? " termAreaWrapWithKeys"
                  : "")
              }
              ref={termAreaWrapRef}
              tabIndex={0}
              onKeyDown={handleTermKeyDown}
              style={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                position: "relative",
              }}
            >
              <div
                className={
                  "termChatWrap termPane " +
                  (termMode === "cursor" ? "termPaneActive" : "termPaneHidden")
                }
                style={{
                  flex: 1,
                  minHeight: 0,
                  height: "100%",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                <CursorChatPanel mode={cursorMode} onModeChange={setCursorMode} cwd={terminalCwd} />
              </div>
              <div
                className={
                  "term termPane " +
                  (termMode === "cursor" ? "termPaneHidden" : "termPaneActive")
                }
                ref={termDivRef}
                style={{
                  minHeight: termMode === "cursor" ? undefined : (isMobile ? 120 : 80),
                  flexDirection: "column",
                  overflow: "hidden",
                }}
                onMouseDown={() => termRef.current?.focus()}
                onTouchStart={() => termRef.current?.focus()}
              />
              {isMobile && terminalVisible && termMode !== "cursor" && mobileKeysVisible ? (
                <div className="termMobileControls" ref={termMobileControlsRef}>
                  <div className="termMobileKeysRow">
                    <button
                      type="button"
                      className="termMobileKeyBtn"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        sendTermInput("\x1b[A");
                        termRef.current?.focus();
                      }}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="termMobileKeyBtn"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        sendTermInput("\x1b[B");
                        termRef.current?.focus();
                      }}
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      className="termMobileKeyBtn"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        sendTermInput("\x1b[D");
                        termRef.current?.focus();
                      }}
                    >
                      Left
                    </button>
                    <button
                      type="button"
                      className="termMobileKeyBtn"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        sendTermInput("\x1b[C");
                        termRef.current?.focus();
                      }}
                    >
                      Right
                    </button>
                    <button
                      type="button"
                      className="termMobileKeyBtn termMobileKeyEnter"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        sendTermInput("\r");
                        termRef.current?.focus();
                      }}
                    >
                      Enter
                    </button>
                  </div>
                </div>
              ) : null}
                </div>
              </div>
            </div>
      </div>

      {/* 移动端 */}
      {isMobile ? (
        <div className="appMobile">
          <div className="topbar">
            <select
              className="select"
              value={activeRoot}
              onChange={(e) => {
                manualRootOverrideRef.current = true;
                setActiveRoot(e.target.value);
                setTerminalCwd(e.target.value);
                setOpenTabs([]);
                setActiveFile("");
                setFileStateByPath({});
                setEditorMode("edit");
                setExplorerUserPath(e.target.value);
              }}
              disabled={roots.length === 0}
              title="根目录"
              style={{ flex: 1, minWidth: 0 }}
            >
              {roots.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <a href="#/setup" className="setupLink" title="配置与安装指南" style={{ fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>
              安装
            </a>
            <div className="tabs">
              <button className={"tabBtn" + (mobileTab === "explorer" ? " tabBtnActive" : "")} onClick={() => setMobileTab("explorer")}>
                文件
              </button>
              <button className={"tabBtn" + (mobileTab === "editor" ? " tabBtnActive" : "")} onClick={() => setMobileTab("editor")}>
                编辑器
              </button>
              <button className={"tabBtn" + (mobileTab === "terminal" ? " tabBtnActive" : "")} onClick={() => setMobileTab("terminal")}>
                终端
              </button>
            </div>
          </div>

          {ExplorerPanel}
          {/* Mobile editor panel (same structure as desktop, isMobile makes collapse btn hidden) */}
          <div
            className={"panel" + (isMobile && mobileTab !== "editor" ? " hidden" : "")}
            style={{ flex: 1 }}
          >
            <div className="tabStrip" role="tablist" aria-label="已打开文件">
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
                    onClick={() => {
                      setActiveFile(p);
                      if (activeRoot) apiSetLastOpenedFile(activeRoot, p).catch(() => {});
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setActiveFile(p);
                        if (activeRoot) apiSetLastOpenedFile(activeRoot, p).catch(() => {});
                      }
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
                      aria-label={`关闭 ${baseName(p)}`}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              {!isMobile && (
                <div className="row" style={{ marginLeft: "auto" }}>
                  <button
                    type="button"
                    className="panelCollapseBtn"
                    onClick={() => setPanelEditorCollapsed(!panelEditorCollapsed)}
                    title={panelEditorCollapsed ? "展开编辑器" : "向左折叠编辑器"}
                  >
                    {panelEditorCollapsed ? "▶" : "◀"}
                  </button>
                </div>
              )}
            </div>
            <div className="panelHeader">
              <h2>编辑器</h2>
              <div className="row" style={{ marginLeft: "auto" }}>
                <div className="segmented" aria-label="编辑器模式">
                  <button className={"segBtn" + (editorMode === "edit" ? " segBtnActive" : "")} onClick={() => setEditorMode("edit")}>
                    编辑
                  </button>
                  <button
                    className={"segBtn" + (editorMode === "preview" ? " segBtnActive" : "")}
                    onClick={() => setEditorMode("preview")}
                    disabled={!activeFile}
                    title={!activeFile ? "请先打开文件" : "使用 highlight.js 预览"}
                  >
                    预览
                  </button>
                </div>
                <span className="fileMeta" title={activeFile}>
                  {activeFile ? baseName(activeFile) : "(无文件)"}
                  {dirty ? " *" : ""}
                </span>
                {fileInfo ? <span className="fileMeta">{bytes(fileInfo.size)}</span> : null}
                <button className="btn" onClick={save} disabled={!activeFile || !dirty}>
                  保存
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
                    scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
                  }}
                />
              </div>
            )}
          </div>
          {/* Mobile terminal panel */}
          <div
            className={"panel" + (isMobile && mobileTab !== "terminal" ? " hidden" : "")}
            style={{ flex: 1, minHeight: "65dvh" }}
          >
            <div className="workspaceTabStrip">
              {workspaces.length === 0 ? (
                <div className="workspaceEmpty">点击文件夹的「Go」按钮打开工作区</div>
              ) : (
                workspaces.map((ws) => (
                  <div
                    key={ws.id}
                    className={"workspaceTab" + (ws.id === activeWorkspaceId ? " workspaceTabActive" : "")}
                    onClick={() => switchWorkspace(ws.id)}
                    title={ws.cwd}
                  >
                    <span className="workspaceTabName">{ws.name}</span>
                    <button
                      className="workspaceTabClose"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeWorkspace(ws.id);
                      }}
                      title="关闭工作区"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="panelHeader termPanelHeader">
              <div className="termPanelHeaderRow">
                <div className="segmented" aria-label="终端模式">
                  <button
                    className={"segBtn" + (termMode === "cursor" ? " segBtnActive" : "")}
                    onClick={() => setTermMode("cursor")}
                    title="Cursor Chat（非交互模式）"
                  >
                    Cursor Chat
                  </button>
                  <button className={"segBtn" + (termMode === "codex" ? " segBtnActive" : "")} onClick={() => setTermMode("codex")}>
                    Codex
                  </button>
                  <button className={"segBtn" + (termMode === "cursor-cli" ? " segBtnActive" : "")} onClick={() => setTermMode("cursor-cli")}>
                    Cursor CLI
                  </button>
                  <button className={"segBtn" + (termMode === "restricted" ? " segBtnActive" : "")} onClick={() => {
                    setRestrictedNonce((n) => n + 1);
                    setTermMode("restricted");
                  }}>
                    Restricted
                  </button>
                </div>
                {(termMode === "codex" || termMode === "restricted") && (
                  <button
                    type="button"
                    className="termPasteBtn"
                    title="粘贴到终端"
                    onClick={() => {
                      const sid = termSessionIdRef.current;
                      const client = termClientRef.current;
                      if (!sid || !client) return;
                      setPasteModalText("");
                      setPasteModalOpen(true);
                      setTimeout(() => pasteModalTextareaRef.current?.focus(), 80);
                    }}
                  >
                    粘贴
                  </button>
                )}
                {isMobile && termMode !== "cursor" ? (
                  <button
                    type="button"
                    className="termPasteBtn"
                    title={mobileKeysVisible ? "隐藏方向键" : "显示方向键"}
                    onClick={() => {
                      mobileKeysTouchedRef.current = true;
                      setMobileKeysVisible((v) => !v);
                    }}
                  >
                    {mobileKeysVisible ? "键盘" : "方向键"}
                  </button>
                ) : null}
              </div>
              <div className="termPanelHeaderCwd" title={terminalCwd}>
                {terminalCwd ? `工作目录: ${terminalCwd}` : ""}
              </div>
            </div>
            <div
              className={
                "termAreaWrap" +
                (isMobile && terminalVisible && termMode !== "cursor" && mobileKeysVisible
                  ? " termAreaWrapWithKeys"
                  : "")
              }
              ref={termAreaWrapRef}
              tabIndex={0}
              onKeyDown={handleTermKeyDown}
              style={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                position: "relative",
              }}
            >
              <div
                className={
                  "termChatWrap termPane " +
                  (termMode === "cursor" ? "termPaneActive" : "termPaneHidden")
                }
                style={{
                  flex: 1,
                  minHeight: 0,
                  height: "100%",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                <CursorChatPanel mode={cursorMode} onModeChange={setCursorMode} cwd={terminalCwd} />
              </div>
              <div
                className={
                  "term termPane " +
                  (termMode === "cursor" ? "termPaneHidden" : "termPaneActive")
                }
                ref={termDivRef}
                style={{
                  minHeight: termMode === "cursor" ? undefined : 120,
                  flexDirection: "column",
                  overflow: "hidden",
                }}
                onMouseDown={() => termRef.current?.focus()}
                onTouchStart={() => termRef.current?.focus()}
              />
              {isMobile && terminalVisible && termMode !== "cursor" && mobileKeysVisible ? (
                <div className="termMobileControls" ref={termMobileControlsRef}>
                  <div className="termMobileKeysRow">
                    <button
                      type="button"
                      className="termMobileKeyBtn"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        sendTermInput("\x1b[A");
                        termRef.current?.focus();
                      }}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="termMobileKeyBtn"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        sendTermInput("\x1b[B");
                        termRef.current?.focus();
                      }}
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      className="termMobileKeyBtn"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        sendTermInput("\x1b[D");
                        termRef.current?.focus();
                      }}
                    >
                      Left
                    </button>
                    <button
                      type="button"
                      className="termMobileKeyBtn"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        sendTermInput("\x1b[C");
                        termRef.current?.focus();
                      }}
                    >
                      Right
                    </button>
                    <button
                      type="button"
                      className="termMobileKeyBtn termMobileKeyEnter"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        sendTermInput("\r");
                        termRef.current?.focus();
                      }}
                    >
                      Enter
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {pasteModalOpen ? (
        <div
          className="pasteModalOverlay"
          onClick={() => setPasteModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pasteModalTitle"
        >
          <div
            className="pasteModalBox"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="pasteModalTitle" className="pasteModalTitle">粘贴到终端</h3>
            <textarea
              ref={pasteModalTextareaRef}
              className="pasteModalTextarea"
              value={pasteModalText}
              onChange={(e) => setPasteModalText(e.target.value)}
              placeholder="在此输入或粘贴内容，点击确定发送到终端"
              rows={6}
            />
            <div className="pasteModalActions">
              <button
                type="button"
                className="btn"
                onClick={() => setPasteModalOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const sid = termSessionIdRef.current;
                  const client = termClientRef.current;
                  if (sid && client && pasteModalText) {
                    void client.stdin(sid, pasteModalText).catch(() => {});
                  }
                  setPasteModalOpen(false);
                  setPasteModalText("");
                }}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {createModalOpen ? (
        <div
          className="pasteModalOverlay"
          onClick={() => setCreateModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="createModalTitle"
        >
          <div
            className="pasteModalBox"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="createModalTitle" className="pasteModalTitle">
              新建{createModalType === "folder" ? "文件夹" : "文件"}
            </h3>
            <p className="fileMeta" style={{ marginBottom: 8 }}>
              在当前目录下新建。
              当前目录: {createModalParent || "(未选择目录)"}
            </p>
            <input
              ref={createModalInputRef}
              type="text"
              style={{
                width: "100%",
                padding: "6px 10px",
                fontSize: 14,
                fontFamily: "var(--mono)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                boxSizing: "border-box",
              }}
              placeholder={
                createModalType === "folder"
                  ? "例如：src 或 docs"
                  : "例如：index.ts 或 README.md"
              }
              value={createModalName}
              onChange={(e) => setCreateModalName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCreateConfirm();
                }
              }}
            />
            <div className="pasteModalActions">
              <button
                type="button"
                className="btn"
                onClick={() => setCreateModalOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void handleCreateConfirm();
                }}
              >
                确定
              </button>
            </div>
          </div>
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
