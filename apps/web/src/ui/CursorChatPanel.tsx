import { useState, useRef, useEffect, useCallback } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

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
  // Cursor CLI stream-json shape can evolve; be defensive.
  const text = evt?.message?.content?.[0]?.text;
  if (typeof text === "string" && text.length) return text;
  return "";
}

// ==================== Chat API ====================

async function fetchSessions(cwd: string): Promise<ChatSession[]> {
  try {
    const res = await fetch(`/api/chat/sessions?cwd=${encodeURIComponent(cwd)}`);
    const data = await res.json();
    if (data.ok) return data.sessions;
    console.error("[ChatAPI] fetchSessions error:", data.error);
    return [];
  } catch (e) {
    console.error("[ChatAPI] fetchSessions error:", e);
    return [];
  }
}

async function createSessionApi(session: ChatSession): Promise<ChatSession | null> {
  try {
    const res = await fetch("/api/chat/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(session),
    });
    const data = await res.json();
    if (data.ok) return data.session;
    console.error("[ChatAPI] createSession error:", data.error);
    return null;
  } catch (e) {
    console.error("[ChatAPI] createSession error:", e);
    return null;
  }
}

async function updateSessionApi(session: ChatSession): Promise<boolean> {
  try {
    const res = await fetch(`/api/chat/sessions/${session.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: session.title,
        messages: session.messages,
        updatedAt: session.updatedAt,
      }),
    });
    const data = await res.json();
    if (!data.ok) console.error("[ChatAPI] updateSession error:", data.error);
    return data.ok;
  } catch (e) {
    console.error("[ChatAPI] updateSession error:", e);
    return false;
  }
}

async function deleteSessionApi(sessionId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/chat/sessions/${sessionId}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!data.ok) console.error("[ChatAPI] deleteSession error:", data.error);
    return data.ok;
  } catch (e) {
    console.error("[ChatAPI] deleteSession error:", e);
    return false;
  }
}

async function updateMessageApi(messageId: string, content: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/chat/messages/${messageId}`, {
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    // Create new session if none exists
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
      // Persist to database
      createSessionApi(newSession);
    }

    // Add user message
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

    try {
      const ac = new AbortController();
      abortRef.current = ac;

      const resume = chatId || undefined;
      const resp = await fetch("/api/cursor-agent/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: userMsg.content, mode, cwd, force: true, resume }),
        signal: ac.signal,
      });

      if (!resp.ok) {
        // Try to parse JSON error body if present
        let errText = `请求失败 (${resp.status})`;
        try {
          const j = await resp.json();
          if (j?.error) errText = String(j.error);
        } catch {}
        throw new Error(errText);
      }
      if (!resp.body) {
        throw new Error("缺少响应体（不支持流式传输）");
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let accumulated = "";
      let toolCount = 0;

      const appendAssistant = (delta: string) => {
        if (!delta) return;
        accumulated += delta;
        setMessages((prev) => updateMessageById(prev, assistantId, { content: accumulated }));
      };

      const appendMetaLine = (line: string) => {
        if (!line) return;
        // Keep metadata readable but not too noisy.
        accumulated += (accumulated ? "\n" : "") + line;
        setMessages((prev) => updateMessageById(prev, assistantId, { content: accumulated }));
      };

      const handleEvent = (evt: any) => {
        const t = evt?.type;
        const subtype = evt?.subtype;
        if (t === "system" && subtype === "init") {
          const sid = evt?.session_id;
          if (typeof sid === "string" && sid && sid !== chatId) {
            setChatId(sid);
          }
          return;
        }
        if (t === "assistant") {
          appendAssistant(extractAssistantText(evt));
          return;
        }
        if (t === "tool_call" && subtype === "started") {
          toolCount += 1;
          // Try to extract a useful hint (path) but stay resilient.
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
          // End marker from our server wrapper (exitCode/signal/timedOut)
          const exitCode = evt?.exitCode;
          const timedOut = evt?.timedOut;
          const sig = evt?.signal;
          appendMetaLine(`[完成] 退出码=${exitCode ?? "?"}${sig ? ` 信号=${sig}` : ""}${timedOut ? " 超时=true" : ""}`);
          return;
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        while (true) {
          const nl = buf.indexOf("\n");
          if (nl === -1) break;
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            handleEvent(JSON.parse(line));
          } catch {
            // If server ever sends a non-JSON line, keep it visible.
            appendMetaLine(line);
          }
        }
      }

      const tail = (buf + decoder.decode()).trim();
      if (tail) {
        try {
          handleEvent(JSON.parse(tail));
        } catch {
          appendMetaLine(tail);
        }
      }
    } catch (e: any) {
      setMessages((prev) =>
        updateMessageById(prev, assistantId, {
          content: (prev.find((m) => m.id === assistantId)?.content || "") + `\n错误: ${e?.message ?? String(e)}`,
        }),
      );
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  };

  const handleNewChat = () => {
    // Abort any in-flight request
    try {
      abortRef.current?.abort();
    } catch {}
    abortRef.current = null;
    setLoading(false);
    
    // Clear current session state - next send will create a new session
    setCurrentSessionId("");
    setChatId("");
    setMessages([]);
    setInput("");
    setShowHistory(false);
  };

  const handleSelectSession = (session: ChatSession) => {
    // Abort any in-flight request
    try {
      abortRef.current?.abort();
    } catch {}
    abortRef.current = null;
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
    try {
      abortRef.current?.abort();
    } catch {}
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
        <span className="chatTitle">Cursor AI</span>
        <select className="modeSelector" value={mode} onChange={(e) => onModeChange(e.target.value as any)}>
          <option value="agent">Agent</option>
          <option value="plan">Plan</option>
          <option value="ask">Ask</option>
        </select>
        <button className="newChatBtn" onClick={handleNewChat} disabled={loading} title="为此文件夹开始新对话">
          新建
        </button>
        <button
          className={"historyBtn" + (showHistory ? " historyBtnActive" : "")}
          onClick={() => setShowHistory(!showHistory)}
          disabled={loading}
          title="查看聊天历史"
        >
          历史 ({sessions.length})
        </button>
        {loading && <span className="loadingIndicator">●</span>}
        {loading ? (
          <button className="stopBtn" onClick={handleStop} title="停止当前请求">
            停止
          </button>
        ) : null}
      </div>

      {showHistory && (
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
      )}

      <div className="chatMessages">
        {messages.length === 0 && (
          <div className="emptyState">
            <p>与 Cursor {mode.charAt(0).toUpperCase() + mode.slice(1)} 开始对话。</p>
            <p className="hint">在下方输入您的问题或任务。（Ctrl/Cmd + Enter 发送）</p>
          </div>
        )}

        {messages.map((m) => {
          const hasContent = typeof m.content === "string" && m.content.trim().length > 0;
          if (!hasContent) return null;
          return (
            <div key={m.id} className={`message ${m.role}`}>
              <div className="messageContent">
                <pre>{m.content}</pre>
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
