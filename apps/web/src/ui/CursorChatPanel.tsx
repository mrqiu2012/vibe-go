import { useState, useRef, useEffect, useCallback } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiUrl } from "../api";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

type ChatSession = {
  id: string;
  cwd: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
};

function randomId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function updateMessageById(messages: Message[], id: string, patch: Partial<Message>): Message[] {
  return messages.map((m) => (m.id === id ? { ...m, ...patch } : m));
}

type StreamJsonLine = any;

function extractAssistantText(evt: StreamJsonLine): string {
  const text = evt?.message?.content?.[0]?.text;
  if (typeof text === "string" && text.length) return text;
  return "";
}

type SetMessages = React.Dispatch<React.SetStateAction<Message[]>>;

function buildStreamHandler(
  assistantId: string,
  setMessages: SetMessages,
  onSessionId?: (sid: string) => void,
): { handleEvent: (evt: any) => void; appendMetaLine: (line: string) => void } {
  let accumulated = "";
  let toolCount = 0;
  const appendAssistant = (delta: string) => {
    if (!delta) return;
    if (!accumulated.length) delta = delta.replace(/^\n+/, "");
    if (!delta.length) return;
    if (delta.startsWith(accumulated)) {
      accumulated = delta;
    } else {
      accumulated += delta;
    }
    setMessages((prev) => updateMessageById(prev, assistantId, { content: accumulated }));
  };
  const appendMetaLine = (line: string) => {
    if (!line) return;
    accumulated = accumulated.replace(/\n+$/, "") + (accumulated ? "\n" : "") + line;
    setMessages((prev) => updateMessageById(prev, assistantId, { content: accumulated }));
  };
  const handleEvent = (evt: any) => {
    const t = evt?.type;
    const subtype = evt?.subtype;
    if (t === "system" && subtype === "init") {
      const sid = evt?.session_id;
      if (typeof sid === "string" && sid) onSessionId?.(sid);
      return;
    }
    if (t === "assistant") {
      appendAssistant(extractAssistantText(evt));
      return;
    }
    if (t === "tool_call" && subtype === "started") {
      toolCount += 1;
      const argsPath =
        evt?.tool_call?.writeToolCall?.args?.path ??
        evt?.tool_call?.readToolCall?.args?.path ??
        evt?.tool_call?.editToolCall?.args?.path ??
        evt?.tool_call?.applyPatchToolCall?.args?.path;
      if (typeof argsPath === "string" && argsPath) appendMetaLine(`[工具 #${toolCount}] ${argsPath}`);
      else appendMetaLine(`[工具 #${toolCount}] 已启动`);
      return;
    }
    if (t === "stderr") {
      const msg = evt?.message;
      if (typeof msg === "string" && msg.trim()) appendMetaLine(`[标准错误] ${msg.trim()}`);
      return;
    }
    if (t === "error") {
      const msg = evt?.message;
      if (typeof msg === "string" && msg.trim()) appendMetaLine(`[错误] ${msg.trim()}`);
      return;
    }
    if (t === "result") {
      const exitCode = evt?.exitCode;
      const timedOut = evt?.timedOut;
      const sig = evt?.signal;
      appendMetaLine(`[完成] 退出码=${exitCode ?? "?"}${sig ? ` 信号=${sig}` : ""}${timedOut ? " 超时=true" : ""}`);
    }
  };
  return { handleEvent, appendMetaLine };
}

// ==================== Chat API ====================

type ModelOption = { id: string; label: string };

/** 固定模型列表，不请求 Cursor CLI */
const CURSOR_MODELS: ModelOption[] = [
  { id: "auto", label: "Auto（当前）" },
  { id: "composer-1", label: "Composer 1" },
  { id: "gpt-5.2", label: "GPT-5.2" },
  { id: "gpt-5.2-codex", label: "GPT-5.2 Codex" },
  { id: "gpt-5.2-codex-high", label: "GPT-5.2 Codex High" },
  { id: "gpt-5.2-codex-low", label: "GPT-5.2 Codex Low" },
  { id: "gpt-5.2-codex-xhigh", label: "GPT-5.2 Codex Extra High" },
  { id: "gpt-5.2-codex-fast", label: "GPT-5.2 Codex Fast" },
  { id: "gpt-5.2-codex-high-fast", label: "GPT-5.2 Codex High Fast" },
  { id: "gpt-5.2-codex-low-fast", label: "GPT-5.2 Codex Low Fast" },
  { id: "gpt-5.2-codex-xhigh-fast", label: "GPT-5.2 Codex Extra High Fast" },
  { id: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max" },
  { id: "gpt-5.1-codex-max-high", label: "GPT-5.1 Codex Max High" },
  { id: "opus-4.5-thinking", label: "Claude 4.5 Opus (Thinking)（默认）" },
  { id: "gpt-5.2-high", label: "GPT-5.2 High" },
  { id: "gemini-3-pro", label: "Gemini 3 Pro" },
  { id: "opus-4.5", label: "Claude 4.5 Opus" },
  { id: "sonnet-4.5", label: "Claude 4.5 Sonnet" },
  { id: "sonnet-4.5-thinking", label: "Claude 4.5 Sonnet (Thinking)" },
  { id: "gpt-5.1-high", label: "GPT-5.1 High" },
  { id: "gemini-3-flash", label: "Gemini 3 Flash" },
  { id: "grok", label: "Grok" },
];

async function fetchSessions(cwd: string): Promise<ChatSession[]> {
  try {
    const res = await fetch(apiUrl(`/api/chat/sessions?cwd=${encodeURIComponent(cwd)}`));
    const data = await res.json();
    if (data.ok) return data.sessions;
    return [];
  } catch {
    return [];
  }
}

async function createSessionApi(session: ChatSession): Promise<ChatSession | null> {
  try {
    const res = await fetch(apiUrl("/api/chat/sessions"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(session),
    });
    const data = await res.json();
    if (data.ok) return data.session;
    return null;
  } catch {
    return null;
  }
}

async function updateSessionApi(session: ChatSession): Promise<boolean> {
  try {
    const res = await fetch(apiUrl(`/api/chat/sessions/${session.id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: session.title,
        messages: session.messages,
        updatedAt: session.updatedAt,
      }),
    });
    const data = await res.json();
    return data.ok;
  } catch {
    return false;
  }
}

async function deleteSessionApi(sessionId: string): Promise<boolean> {
  try {
    const res = await fetch(apiUrl(`/api/chat/sessions/${sessionId}`), {
      method: "DELETE",
    });
    const data = await res.json();
    return data.ok;
  } catch {
    return false;
  }
}

async function updateMessageApi(messageId: string, content: string): Promise<boolean> {
  try {
    const res = await fetch(apiUrl(`/api/chat/messages/${messageId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const data = await res.json();
    return data.ok;
  } catch {
    return false;
  }
}

function generateTitle(messages: Message[]): string {
  const firstUserMsg = messages.find((m) => m.role === "user");
  if (!firstUserMsg) return "新对话";
  const text = firstUserMsg.content.trim();
  return text.length > 40 ? text.slice(0, 40) + "..." : text;
}

const CURSOR_RUN_STORAGE_KEY = "cursorAgentRun";

type StoredRun = { cwd: string; sessionId: string; runId: string; assistantId: string; offset: number };

function loadStoredRun(): StoredRun | null {
  try {
    const raw = localStorage.getItem(CURSOR_RUN_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as StoredRun;
    if (o && typeof o.runId === "string" && typeof o.assistantId === "string" && typeof o.offset === "number") {
      return o;
    }
  } catch {}
  return null;
}

function saveStoredRun(cwd: string, sessionId: string, runId: string, assistantId: string, offset: number) {
  try {
    localStorage.setItem(
      CURSOR_RUN_STORAGE_KEY,
      JSON.stringify({ cwd, sessionId, runId, assistantId, offset }),
    );
  } catch {}
}

function clearStoredRun() {
  try {
    localStorage.removeItem(CURSOR_RUN_STORAGE_KEY);
  } catch {}
}

export function CursorChatPanel({
  mode,
  onModeChange,
  cwd,
}: {
  mode: "agent" | "plan" | "ask";
  onModeChange: (mode: "agent" | "plan" | "ask") => void;
  cwd: string;
}) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatId, setChatId] = useState<string>("");
  const [showHistory, setShowHistory] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>("auto");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const runIdRef = useRef<string | null>(null);
  const assistantIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string>("");
  const stopRequestedRef = useRef(false);
  const handlerRef = useRef<ReturnType<typeof buildStreamHandler> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamDeadRef = useRef(false);
  const loadingRef = useRef(false);

  // Load sessions from database on mount or cwd change (skip when cwd not yet set)
  useEffect(() => {
    if (!cwd) {
      setSessions([]);
      setCurrentSessionId("");
      setMessages([]);
      setChatId("");
      return;
    }
    let cancelled = false;
    fetchSessions(cwd).then((loaded) => {
      if (cancelled) return;
      setSessions(loaded);
      // Open the most recent session by default
      if (loaded.length > 0) {
        const latest = loaded[0]; // Already sorted by updated_at DESC
        setCurrentSessionId(latest.id);
        setMessages(latest.messages);
        setChatId(latest.id);
      } else {
        setCurrentSessionId("");
        setMessages([]);
        setChatId("");
      }
    });
    return () => { cancelled = true; };
  }, [cwd]);

  // Update current session in sessions list and persist to database
  const updateCurrentSession = useCallback((newMessages: Message[]) => {
    if (!currentSessionId) return;
    const now = Date.now();
    const newTitle = generateTitle(newMessages);
    
    setSessions((prev) => {
      const updated = prev.map((s) =>
        s.id === currentSessionId
          ? { ...s, messages: newMessages, title: newTitle, updatedAt: now }
          : s
      );
      // Persist to database (async, fire-and-forget)
      const sessionToUpdate = updated.find((s) => s.id === currentSessionId);
      if (sessionToUpdate) {
        updateSessionApi(sessionToUpdate);
      }
      return updated;
    });
  }, [currentSessionId]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Sync messages to current session whenever they change (debounced)
  useEffect(() => {
    if (!currentSessionId || messages.length === 0) return;
    const timer = setTimeout(() => {
      updateCurrentSession(messages);
    }, 500);
    return () => clearTimeout(timer);
  }, [messages, currentSessionId, updateCurrentSession]);

  // 方案 A：关掉网页再打开 — 用 runId 重连 GET /api/cursor-agent/stream/:runId，先拿缓冲再追新
  useEffect(() => {
    if (!cwd || !currentSessionId) return;
    const stored = loadStoredRun();
    if (!stored || stored.cwd !== cwd || stored.sessionId !== currentSessionId) return;

    setMessages((prev) => {
      if (prev.some((m) => m.id === stored.assistantId)) return prev;
      return [...prev, { id: stored.assistantId, role: "assistant" as const, content: "", timestamp: Date.now() }];
    });
    runIdRef.current = stored.runId;
    assistantIdRef.current = stored.assistantId;
    sessionIdRef.current = stored.sessionId;
    setLoading(true);
    streamDeadRef.current = false;
    handlerRef.current = buildStreamHandler(stored.assistantId, setMessages, (sid) => setChatId(sid));

    let cancelled = false;
    (async () => {
      const rid = stored.runId;
      try {
        const r = await fetch(apiUrl(`/api/cursor-agent/stream/${rid}`));
        if (cancelled) return;
        if (!r.ok) {
          if (r.status === 404) {
            clearStoredRun();
            setLoading(false);
            runIdRef.current = null;
            assistantIdRef.current = null;
            handlerRef.current = null;
          }
          return;
        }
        const reader = r.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (cancelled) return;
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          const handler = handlerRef.current;
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (handler) {
              try {
                handler.handleEvent(JSON.parse(trimmed));
              } catch {
                handler.appendMetaLine(trimmed);
              }
            }
          }
        }
        if (buf.trim() && handlerRef.current) {
          try {
            handlerRef.current.handleEvent(JSON.parse(buf.trim()));
          } catch {
            handlerRef.current.appendMetaLine(buf.trim());
          }
        }
        if (!cancelled) {
          clearStoredRun();
          setLoading(false);
          runIdRef.current = null;
          assistantIdRef.current = null;
          handlerRef.current = null;
        }
      } catch {
        if (!cancelled) {
          streamDeadRef.current = true;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, currentSessionId]);

  // 方案 A：从后台回到前台时，若流已断则用 runId 重连
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (!loadingRef.current || !runIdRef.current || !streamDeadRef.current) return;
      const rid = runIdRef.current;
      const handler = handlerRef.current;
      const cwdNow = cwd;
      const sessionIdNow = sessionIdRef.current;
      const assistantIdNow = assistantIdRef.current;
      if (!handler || !cwdNow || !sessionIdNow || !assistantIdNow) return;
      streamDeadRef.current = false;
      (async () => {
        try {
          const r = await fetch(apiUrl(`/api/cursor-agent/stream/${rid}`));
          if (!r.ok) {
            if (r.status === 404) {
              clearStoredRun();
              setLoading(false);
              runIdRef.current = null;
              assistantIdRef.current = null;
              handlerRef.current = null;
            }
            return;
          }
          const reader = r.body?.getReader();
          if (!reader) return;
          const decoder = new TextDecoder();
          let buf = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            const h = handlerRef.current;
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              if (h) {
                try {
                  h.handleEvent(JSON.parse(trimmed));
                } catch {
                  h.appendMetaLine(trimmed);
                }
              }
            }
          }
          if (buf.trim() && handlerRef.current) {
            try {
              handlerRef.current.handleEvent(JSON.parse(buf.trim()));
            } catch {
              handlerRef.current.appendMetaLine(buf.trim());
            }
          }
          clearStoredRun();
          setLoading(false);
          runIdRef.current = null;
          assistantIdRef.current = null;
          handlerRef.current = null;
        } catch {
          streamDeadRef.current = true;
        }
      })();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [cwd]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    let sessionId = currentSessionId;
    if (!sessionId) {
      sessionId = randomId();
      const newSession: ChatSession = {
        id: sessionId,
        cwd,
        title: "新对话",
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setCurrentSessionId(sessionId);
      setChatId(sessionId);
      setSessions((prev) => [newSession, ...prev]);
      createSessionApi(newSession);
    }

    const userMsg: Message = {
      id: randomId(),
      role: "user",
      content: input.trim(),
      timestamp: Date.now(),
    };
    const assistantId = randomId();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
    };
    const newMessages = [...messages, userMsg, assistantMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    stopRequestedRef.current = false;
    runIdRef.current = null;
    assistantIdRef.current = assistantId;
    sessionIdRef.current = sessionId;
    streamDeadRef.current = false;
    handlerRef.current = buildStreamHandler(assistantId, setMessages, (sid) => setChatId(sid));

    const ac = new AbortController();
    abortControllerRef.current = ac;

    try {
      const resume = chatId || undefined;
      const resp = await fetch(apiUrl("/api/cursor-agent/stream"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: userMsg.content,
          mode,
          cwd,
          force: true,
          resume,
          model: selectedModel || "auto",
        }),
        signal: ac.signal,
      });

      if (!resp.ok) {
        if (ac.signal.aborted) return;
        let errText = `请求失败 (${resp.status})`;
        try {
          const j = await resp.json();
          if (j?.error) errText = String(j.error);
        } catch {}
        throw new Error(errText);
      }

      const runId = resp.headers.get("X-Run-Id")?.trim();
      if (!runId) throw new Error("服务端未返回 X-Run-Id");

      runIdRef.current = runId;
      saveStoredRun(cwd, sessionId, runId, assistantId, 0);

      const reader = resp.body?.getReader();
      if (!reader) throw new Error("无响应体");

      const decoder = new TextDecoder();
      let buf = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (ac.signal.aborted || stopRequestedRef.current) break;
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          const handler = handlerRef.current;
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (handler) {
              try {
                handler.handleEvent(JSON.parse(trimmed));
              } catch {
                handler.appendMetaLine(trimmed);
              }
            }
          }
        }
        if (buf.trim() && handlerRef.current && !ac.signal.aborted) {
          try {
            handlerRef.current.handleEvent(JSON.parse(buf.trim()));
          } catch {
            handlerRef.current.appendMetaLine(buf.trim());
          }
        }

        if (ac.signal.aborted || stopRequestedRef.current) {
          streamDeadRef.current = true;
          clearStoredRun();
          setLoading(false);
          runIdRef.current = null;
          assistantIdRef.current = null;
          handlerRef.current = null;
        } else {
          clearStoredRun();
          setLoading(false);
          runIdRef.current = null;
          assistantIdRef.current = null;
          handlerRef.current = null;
        }
      } catch (readErr: any) {
        if (ac.signal.aborted || stopRequestedRef.current) {
          streamDeadRef.current = true;
          clearStoredRun();
          setLoading(false);
          runIdRef.current = null;
          assistantIdRef.current = null;
          handlerRef.current = null;
        } else {
          streamDeadRef.current = true;
          setMessages((prev) =>
            updateMessageById(prev, assistantId, {
              content: (prev.find((m) => m.id === assistantId)?.content || "") + `\n[连接断开，回到前台将自动重连]`,
            }),
          );
        }
      }
    } catch (e: any) {
      if (ac.signal.aborted || stopRequestedRef.current) {
        streamDeadRef.current = true;
        return;
      }
      clearStoredRun();
      setMessages((prev) =>
        updateMessageById(prev, assistantId, {
          content: (prev.find((m) => m.id === assistantId)?.content || "") + `\n错误: ${e?.message ?? String(e)}`,
        }),
      );
      setLoading(false);
      runIdRef.current = null;
      assistantIdRef.current = null;
      handlerRef.current = null;
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handleNewChat = () => {
    clearStoredRun();
    stopRequestedRef.current = true;
    const rid = runIdRef.current;
    if (rid) {
      fetch(apiUrl(`/api/cursor-agent/stream/${rid}/stop`), { method: "POST" }).catch(() => {});
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    runIdRef.current = null;
    assistantIdRef.current = null;
    setLoading(false);
    setCurrentSessionId("");
    setChatId("");
    setMessages([]);
    setInput("");
    setShowHistory(false);
  };

  const handleSelectSession = (session: ChatSession) => {
    clearStoredRun();
    stopRequestedRef.current = true;
    const rid = runIdRef.current;
    if (rid) {
      fetch(apiUrl(`/api/cursor-agent/stream/${rid}/stop`), { method: "POST" }).catch(() => {});
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    runIdRef.current = null;
    assistantIdRef.current = null;
    setLoading(false);
    setCurrentSessionId(session.id);
    setChatId(session.id);
    setMessages(session.messages);
    setShowHistory(false);
  };

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Delete from database
    await deleteSessionApi(sessionId);
    
    const newSessions = sessions.filter((s) => s.id !== sessionId);
    setSessions(newSessions);
    
    // If deleting the current session, clear it
    if (sessionId === currentSessionId) {
      setCurrentSessionId("");
      setChatId("");
      setMessages([]);
    }
  };

  const handleStop = () => {
    stopRequestedRef.current = true;
    const rid = runIdRef.current;
    if (rid) {
      fetch(apiUrl(`/api/cursor-agent/stream/${rid}/stop`), { method: "POST" }).catch(() => {});
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    // 不立即清 loading，等流读到 result 帧后再结束
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="cursorChatPanel">
      <div className="chatHeader">
        <select className="modeSelector" value={mode} onChange={(e) => onModeChange(e.target.value as any)}>
          <option value="agent">Agent</option>
          <option value="plan">Plan</option>
          <option value="ask">Ask</option>
        </select>
        <select
          className="modelSelector"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          title="切换模型"
        >
          {CURSOR_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <button className="newChatBtn" onClick={handleNewChat} disabled={loading} title="为此文件夹开始新对话">
          新建
        </button>
        <div
          className={"historyBtnWrap" + (showHistory ? " historyBtnActive" : "") + (loading ? " historyBtnWrapDisabled" : "")}
          title="查看聊天历史"
          role="button"
          tabIndex={loading ? -1 : 0}
          aria-pressed={showHistory}
          onClick={() => {
            if (loading) return;
            setShowHistory((prev) => !prev);
          }}
          onKeyDown={(e) => {
            if (loading) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setShowHistory((prev) => !prev);
            }
          }}
        >
          <span className="historyBtnLabel">历史 ({sessions.length})</span>
        </div>
        {loading && <span className="loadingIndicator">●</span>}
        {loading ? (
          <button className="stopBtn" onClick={handleStop} title="停止当前请求">
            停止
          </button>
        ) : null}
      </div>

      {showHistory ? (
        <div className="chatHistoryPanel">
          <div className="historyHeader">
            <span>聊天历史</span>
            <button className="closeHistoryBtn" onClick={() => setShowHistory(false)}>×</button>
          </div>
          <div className="historyList">
            {sessions.length === 0 ? (
              <div className="historyEmpty">暂无聊天历史</div>
            ) : (
              [...sessions].reverse().map((session) => (
                <div
                  key={session.id}
                  className={"historyItem" + (session.id === currentSessionId ? " historyItemActive" : "")}
                  onClick={() => handleSelectSession(session)}
                >
                  <div className="historyItemTitle">{session.title}</div>
                  <div className="historyItemMeta">
                    <span>{new Date(session.updatedAt).toLocaleDateString()}</span>
                    <span>{session.messages.length} 条消息</span>
                  </div>
                  <button
                    className="historyItemDelete"
                    onClick={(e) => handleDeleteSession(session.id, e)}
                    title="删除此对话"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="chatMessages">
          <div className="chatMessagesInner">
            {messages.length === 0 && (
              <div className="emptyState">
                <p>与 Cursor {mode.charAt(0).toUpperCase() + mode.slice(1)} 开始对话。</p>
                <p className="hint">在下方输入您的问题或任务。（Ctrl/Cmd + Enter 发送）</p>
              </div>
            )}

            {messages.map((m) => {
              const raw = typeof m.content === "string" ? m.content : "";
              const content = raw.replace(/^\n+/, "").trimEnd();
              if (!content.length) return null;
              return (
                <div key={m.id} className={`message ${m.role}`}>
                  <div className="messageContent">
                    {m.role === "assistant" ? (
                      <div className="markdownBody">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                      </div>
                    ) : (
                      <pre>{content}</pre>
                    )}
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="message assistant">
                <div className="messageContent">
                  <div className="thinkingDots">
                    <span>●</span>
                    <span>●</span>
                    <span>●</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>
      )}

      <div className="chatInput">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`向 ${mode} 提问...（Ctrl/Cmd+Enter 发送）`}
          disabled={loading}
          rows={3}
        />
        <button className="sendBtn" onClick={handleSend} disabled={loading || !input.trim()}>
          发送
        </button>
      </div>
    </div>
  );
}
