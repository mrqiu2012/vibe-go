import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import "xterm/css/xterm.css";
import "highlight.js/styles/github.css";
import "./styles.css";
import { apiUrl } from "./api";
import { App } from "./ui/App";
import { SetupPage } from "./ui/SetupPage";

// Tencent vConsole: enable only when explicitly requested.
if (localStorage.getItem("vconsole") === "1") {
  void import("vconsole").then(({ default: VConsole }) => {
    new VConsole();
  });
}

// Monaco Editor 在布局变化（如切换 Codex/终端模式）时会取消内部异步操作并抛出 Canceled，属于预期行为，忽略即可
window.addEventListener("unhandledrejection", (event) => {
  const r = event.reason;
  const name = typeof r === "object" && r !== null ? r.name : null;
  const msg = typeof r === "object" && r !== null ? r.message : String(r ?? "");
  const isMonacoCanceled =
    (name === "Canceled" && msg === "Canceled") ||
    (typeof msg === "string" && msg.includes("Canceled"));
  if (isMonacoCanceled) {
    event.preventDefault();
    event.stopPropagation();
  }
});

function Root() {
  const [hash, setHash] = useState(() => window.location.hash || "#/");
  const [setupError, setSetupError] = useState<string | null>(null);
  const isMainRoute = hash === "#/" || hash === "";

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // 打开主页面时检测后端是否可用，但不再因为未配置根目录而强制跳转安装页。
  useEffect(() => {
    if (hash !== "#/setup" && !isMainRoute) {
      return;
    }
    if (hash === "#/setup") {
      return;
    }
    let cancelled = false;
    const maxAttempts = 8;
    const delayMs = 1500;
    function attempt(n: number) {
      if (cancelled) return;
      fetch(apiUrl("/api/setup/check"))
        .then(async (r) => {
          const body = await r.text();
          if (!r.ok) {
            let errMsg = `${r.status}`;
            try {
              const j = JSON.parse(body) as { error?: string };
              if (j?.error) errMsg = j.error;
            } catch {
              if (body) errMsg = body.slice(0, 200);
            }
            return Promise.reject(new Error(errMsg));
          }
          try {
            return JSON.parse(body) as { ok?: boolean; setupDone?: boolean; roots?: unknown[] };
          } catch {
            return Promise.reject(new Error("Invalid JSON"));
          }
        })
        .then((data) => {
          if (cancelled) return;
          if (!data?.ok) {
            throw new Error("Setup check failed");
          }
        })
        .catch((err: Error) => {
          if (cancelled) return;
          const msg = err?.message ?? String(err);
          if (n < maxAttempts) {
            if (n === 0) console.warn("[setup/check] attempt failed:", msg);
            setTimeout(() => attempt(n + 1), delayMs);
          } else {
            console.error("[setup/check] all retries failed. Backend may be down or returning 500:", msg);
            setSetupError(msg);
          }
        });
    }
    attempt(0);
    return () => {
      cancelled = true;
    };
  }, [hash, isMainRoute]);

  if (hash === "#/setup") {
    return <SetupPage />;
  }
  if (isMainRoute && setupError) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "system-ui", color: "#64748b", gap: 8, padding: 24, textAlign: "center" }}>
        <span style={{ color: "#dc2626" }}>后端未就绪或出错</span>
        <span style={{ fontSize: 14 }}>请确认已运行：pnpm dev 或 pnpm dev:server</span>
        <span style={{ fontSize: 12, maxWidth: 400 }}>错误信息：{setupError}</span>
        <button
          type="button"
          style={{ marginTop: 8, padding: "6px 12px", cursor: "pointer" }}
          onClick={() => { setSetupError(null); window.location.reload(); }}
        >
          重试
        </button>
      </div>
    );
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <Root />,
);
