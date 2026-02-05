import http from "node:http";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import express from "express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getRepoRoot(): string {
  return path.resolve(__dirname, "..", "..", "..");
}

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const onDone = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(500);
    socket.on("connect", () => onDone(true));
    socket.on("timeout", () => onDone(false));
    socket.on("error", () => onDone(false));
    socket.connect(port, "127.0.0.1", () => {});
  });
}

async function getPortStatus(): Promise<{ frontend: boolean; backend: boolean }> {
  const [frontend, backend] = await Promise.all([checkPort(3989), checkPort(3990)]);
  return { frontend, backend };
}

const PORT = Number(process.env.CONTROL_PORT ?? 3991);
const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.get("/api/status", async (_req, res) => {
  try {
    const status = await getPortStatus();
    res.json({ ok: true, ...status });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post("/api/restart", (_req, res) => {
  const repoRoot = getRepoRoot();

  // 1. Kill processes on 3989 and 3990
  const kill = spawn("sh", ["-c", "lsof -ti:3989,3990 | xargs kill -9 2>/dev/null; sleep 2; echo done"], {
    cwd: repoRoot,
    stdio: "ignore",
  });

  kill.on("close", (code) => {
    // 2. Start pnpm dev in detached mode (don't wait for it)
    const child = spawn("pnpm", ["dev"], {
      cwd: repoRoot,
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    child.unref();

    res.json({ ok: true, message: "重启已触发，项目正在后台启动…" });
  });

  kill.on("error", (err) => {
    console.error("Kill error:", err);
    res.status(500).json({ ok: false, error: String(err) });
  });
});

const server = http.createServer(app);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Control panel: http://localhost:${PORT}/`);
});
