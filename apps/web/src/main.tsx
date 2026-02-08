import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import "xterm/css/xterm.css";
import "highlight.js/styles/github.css";
import "./styles.css";
import { App } from "./ui/App";
import { SetupPage } from "./ui/SetupPage";

// Tencent vConsole: enable only when explicitly requested.
if (localStorage.getItem("vconsole") === "1") {
  const { default: VConsole } = await import("vconsole");
  new VConsole();
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
  const [setupChecked, setSetupChecked] = useState(false);
  const isMainRoute = hash === "#/" || hash === "";

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // 打开主页面时检测 config/.setup-done，没有则自动进入安装页
  useEffect(() => {
    if (hash !== "#/setup" && !isMainRoute) {
      setSetupChecked(true);
      return;
    }
    if (hash === "#/setup") {
      setSetupChecked(true);
      return;
    }
    let cancelled = false;
    fetch("/api/setup/check")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setSetupChecked(true);
        // 未完成安装（无 .setup-done）或未添加任何根目录时，进入安装页
        const needSetup = data?.ok && (
          data.setupDone === false ||
          (Array.isArray(data.roots) && data.roots.length === 0)
        );
        if (needSetup) {
          window.location.hash = "#/setup";
          setHash("#/setup");
        }
      })
      .catch(() => {
        if (!cancelled) setSetupChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [hash, isMainRoute]);

  if (hash === "#/setup") {
    return <SetupPage />;
  }
  if (isMainRoute && !setupChecked) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "system-ui", color: "#64748b" }}>
        检测中…
      </div>
    );
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <Root />,
);
