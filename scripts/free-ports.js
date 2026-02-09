/**
 * 释放 3989、3990 端口（Windows 上先结束占用进程），便于后端/前端能正常启动。
 * 用法: node scripts/free-ports.js
 * 或在 pnpm dev:fresh 中先执行此脚本再启动。
 */
const { execSync } = require("child_process");
const os = require("os");

const PORTS = [3989, 3990];

function freePortsWindows() {
  const pids = new Set();
  try {
    const out = execSync("netstat -ano", { encoding: "utf8", windowsHide: true });
    for (const line of out.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.toUpperCase().includes("LISTENING")) continue;
      for (const port of PORTS) {
        if (trimmed.includes(`:${port}`)) {
          const parts = trimmed.split(/\s+/);
          const pid = parts[parts.length - 1];
          if (/^\d+$/.test(pid)) pids.add(pid);
        }
      }
    }
  } catch (e) {
    console.warn("netstat failed:", e.message);
    return;
  }
  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: "pipe", windowsHide: true });
      console.log("[free-ports] Killed process", pid);
    } catch (e) {
      // 可能已退出或权限不足
    }
  }
}

function freePortsUnix() {
  try {
    for (const port of PORTS) {
      execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, { stdio: "pipe" });
    }
  } catch (e) {
    // 无进程占用时 lsof 会非 0
  }
}

if (os.platform() === "win32") {
  freePortsWindows();
} else {
  freePortsUnix();
}
