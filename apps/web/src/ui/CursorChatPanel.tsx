import { useState, useRef, useEffect } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
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

function storageKeyForCwd(cwd: string) {
  return `cursorChatId::${cwd}`;
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatId, setChatId] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load persisted chatId for this cwd (memory across reload).
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(storageKeyForCwd(cwd)) ?? "";
      setChatId(typeof v === "string" ? v : "");
    } catch {
      setChatId("");
    }
  }, [cwd]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

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
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
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
        let errText = `Request failed (${resp.status})`;
        try {
          const j = await resp.json();
          if (j?.error) errText = String(j.error);
        } catch {}
        throw new Error(errText);
      }
      if (!resp.body) {
        throw new Error("Missing response body (stream not supported)");
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
            try {
              window.localStorage.setItem(storageKeyForCwd(cwd), sid);
            } catch {}
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
          if (typeof argsPath === "string" && argsPath) appendMetaLine(`[tool #${toolCount}] ${argsPath}`);
          else appendMetaLine(`[tool #${toolCount}] started`);
          return;
        }
        if (t === "stderr") {
          const msg = evt?.message;
          if (typeof msg === "string" && msg.trim()) appendMetaLine(`[stderr] ${msg.trim()}`);
          return;
        }
        if (t === "error") {
          const msg = evt?.message;
          if (typeof msg === "string" && msg.trim()) appendMetaLine(`[error] ${msg.trim()}`);
          return;
        }
        if (t === "result") {
          // End marker from our server wrapper (exitCode/signal/timedOut)
          const exitCode = evt?.exitCode;
          const timedOut = evt?.timedOut;
          const sig = evt?.signal;
          appendMetaLine(`[done] exit=${exitCode ?? "?"}${sig ? ` signal=${sig}` : ""}${timedOut ? " timedOut=true" : ""}`);
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
          content: (prev.find((m) => m.id === assistantId)?.content || "") + `\nError: ${e?.message ?? String(e)}`,
        }),
      );
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  };

  const handleNewChat = () => {
    // Clear remembered session for this cwd; next send starts a new conversation.
    try {
      abortRef.current?.abort();
    } catch {}
    abortRef.current = null;
    setLoading(false);
    setChatId("");
    try {
      window.localStorage.removeItem(storageKeyForCwd(cwd));
    } catch {}
    setMessages([]);
    setInput("");
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
        <button className="newChatBtn" onClick={handleNewChat} disabled={loading} title="Start a new conversation for this folder">
          New chat
        </button>
        {loading && <span className="loadingIndicator">●</span>}
        {loading ? (
          <button className="stopBtn" onClick={handleStop} title="Stop current request">
            Stop
          </button>
        ) : null}
      </div>

      <div className="chatMessages">
        {messages.length === 0 && (
          <div className="emptyState">
            <p>Start a conversation with Cursor {mode.charAt(0).toUpperCase() + mode.slice(1)}.</p>
            <p className="hint">Type your question or task below. (Ctrl/Cmd + Enter to send)</p>
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
          placeholder={`Ask ${mode}... (Ctrl/Cmd+Enter to send)`}
          disabled={loading}
          rows={3}
        />
        <button className="sendBtn" onClick={handleSend} disabled={loading || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
