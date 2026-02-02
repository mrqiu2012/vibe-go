import React from "react";
import ReactDOM from "react-dom/client";
import VConsole from "vconsole";
import "xterm/css/xterm.css";
import "highlight.js/styles/github.css";
import "./styles.css";
import { App } from "./ui/App";

// 腾讯 vConsole：页面上显示调试面板（Console / Network 等）
new VConsole();

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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <App />,
);

