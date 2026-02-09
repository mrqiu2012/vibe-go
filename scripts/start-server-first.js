/**
 * 先启动后端，等待 /ping 就绪后再启动 protocol + web，避免前端先请求时后端未就绪导致 500。
 * 用法: node scripts/start-server-first.js（需在项目根目录执行）
 */
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const PORT = 3990;
const ROOT = path.resolve(__dirname, "..");
const MAX_WAIT_MS = 30000;
const POLL_MS = 600;

function waitForPing() {
  return new Promise((resolve) => {
    const start = Date.now();
    function tryOne() {
      const req = http.get(`http://127.0.0.1:${PORT}/ping`, (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve(true));
      });
      req.on("error", () => {
        if (Date.now() - start >= MAX_WAIT_MS) return resolve(false);
        setTimeout(tryOne, POLL_MS);
      });
      req.setTimeout(3000, () => {
        req.destroy();
        if (Date.now() - start >= MAX_WAIT_MS) return resolve(false);
        setTimeout(tryOne, POLL_MS);
      });
    }
    tryOne();
  });
}

console.log("[dev] Starting server first...");
const server = spawn("pnpm", ["--filter", "@vibego/server", "dev"], {
  cwd: ROOT,
  stdio: "inherit",
  shell: true,
});

server.on("error", (err) => {
  console.error("[dev] Failed to start server:", err);
  process.exit(1);
});

server.on("exit", (code, signal) => {
  if (code != null && code !== 0) {
    console.error("[dev] Server exited with code", code, signal != null ? "signal " + signal : "");
  }
});

waitForPing().then((ok) => {
  if (!ok) {
    console.warn("[dev] Server did not respond to /ping in time; starting frontend anyway.");
  } else {
    console.log("[dev] Server ready on port", PORT);
  }
  // 使用根目录的 dev:web 脚本，避免 Windows 下 concurrently 子命令解析问题
  const front = spawn("pnpm", ["run", "dev:web"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });
  front.on("exit", (code) => {
    server.kill();
    process.exit(code != null ? code : 0);
  });
});
