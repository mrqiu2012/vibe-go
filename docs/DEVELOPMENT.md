# 开发与运行说明

本文档汇总开发环境下的运行方式、端口、以及近期为解决 500/连接失败等问题所做的改动。

## 端口与访问

| 服务     | 端口 | 说明 |
|----------|------|------|
| 前端 (Vite) | 3989 | 页面：http://localhost:3989/ |
| 后端 (Express) | 3990 | API：http://localhost:3990/api/*，WebSocket：ws://localhost:3990/ws/term |

前端在开发时**直接请求后端 3990**（不经过 3989 代理），因此需保证后端先于或与前端同时启动。

## 启动方式

### 推荐：一键启动（先起后端再起前端）

```bash
pnpm dev
```

- 执行 `node scripts/start-server-first.js`：先启动后端，轮询 `http://127.0.0.1:3990/ping` 直到就绪（最多约 30 秒），再启动前端（protocol + web）。
- 可避免前端先请求时后端未监听导致的 500 或 ERR_CONNECTION_REFUSED。

### 端口被占用时

```bash
pnpm dev:fresh
```

- 先执行 `node scripts/free-ports.js`，释放 3989、3990 上占用进程（Windows 用 netstat + taskkill），再执行 `pnpm dev`。

### 分终端启动（便于看后端日志）

- 终端 1：`pnpm dev:server`（仅后端，保持运行）
- 终端 2：`pnpm dev:web`（protocol + web）

### 其他脚本

- `pnpm dev:all`：后端、前端、protocol 同时启动（不保证后端先就绪）。
- `pnpm dev:server`：仅后端。
- `pnpm dev:web`：仅前端（protocol + web）。

## 近期改动总结（运行/开发相关）

### 1. 后端：数据库延迟加载

- **问题**：静态 `import "./db.js"` 会加载 `better-sqlite3`，若该原生模块加载失败（如未编译、Node 版本不匹配），进程在 `main()` 前就退出，导致 3990 从未监听，前端出现 ERR_CONNECTION_REFUSED 或 500。
- **改动**：改为**延迟加载** db 模块（`getDbModule()`，首次需要时 `await import("./db.js")`），成功则缓存，失败则缓存错误并打日志。
- **效果**：后端总能启动并监听 3990；`/ping`、`/api/roots`、`/api/setup/check` 等不依赖 db 的接口正常；依赖 db 的接口在 db 加载失败时返回 503，便于单独排查数据库/环境问题。

### 2. 前端：直接请求后端 3990，取消代理

- **问题**：原先通过 Vite 将 3989 的 `/api` 代理到 3990，代理异常或后端未就绪时易出现 500，且错误来源不直观。
- **改动**：
  - 移除 Vite 的 `/api`、`/ws` 代理配置。
  - 在 `api.ts` 中增加 `API_BASE`（开发时为 `http://localhost:3990`）和 `apiUrl(path)`，所有 API 请求改为 `fetch(apiUrl("/api/..."))`。
  - `main.tsx`、`SetupPage.tsx`、`CursorChatPanel.tsx`、`App.tsx` 中涉及 `/api` 的请求均改为使用 `apiUrl(...)`。
- **效果**：前端在开发环境下直接请求 3990，不再经 3989 转发；错误时更容易区分是后端未启动还是接口逻辑问题。

### 3. 启动顺序：先后端再前端

- **问题**：`pnpm dev` 原先用 concurrently 同时起 server、protocol、web，前端常早于后端就绪，首屏请求 `/api/setup/check` 等易 500 或连接被拒。
- **改动**：
  - `pnpm dev` 改为执行 `node scripts/start-server-first.js`：先 spawn 后端，轮询 `/ping` 成功后再执行 `pnpm run dev:web`。
  - 原“三进程同时启动”保留为 `pnpm dev:all`。
- **效果**：使用 `pnpm dev` 时，前端开始请求时后端通常已在 3990 监听。

### 4. 端口占用与一键释放

- **问题**：重复启动或异常退出后，3989/3990 被占导致后端或前端启动失败（EADDRINUSE / Port already in use）。
- **改动**：
  - 新增 `scripts/free-ports.js`：在 Windows 上根据 netstat 查找占用 3989、3990 的进程并用 taskkill 结束；Unix 上可用 lsof + kill。
  - 新增 `pnpm dev:fresh`：先执行 `node scripts/free-ports.js` 再执行 `pnpm dev`。
- **效果**：端口冲突时可直接执行 `pnpm dev:fresh` 再启动。

### 5. 前端：setup 检查失败时的提示与重试

- **问题**：后端未就绪时，前端反复重试 `/api/setup/check` 仍失败，只看到控制台 500，没有明确提示。
- **改动**：
  - 对 `/api/setup/check` 的响应解析错误信息（含 500 时的 `{ error }`），并在重试全部失败时展示一屏提示：“后端未就绪或出错”、建议运行 `pnpm dev` 或 `pnpm dev:server`，以及错误信息与“重试”按钮。
- **效果**：用户能明确知道需先启动后端，并可根据错误信息排查。

### 6. CORS：暴露 X-Run-Id 给前端

- **问题**：前端在 3989、后端在 3990，属于跨域。浏览器默认不暴露自定义响应头，`X-Run-Id` 虽由后端设置但前端 `resp.headers.get("X-Run-Id")` 得到 null，被当作“服务端未返回 X-Run-Id”，该错误被写入助手消息并持久化到会话。
- **改动**：后端 CORS 配置增加 `exposedHeaders: ["X-Run-Id"]`。
- **效果**：流式接口返回的 `X-Run-Id` 对前端可见，Cursor 对话流可正常关联 runId，不再出现“服务端未返回 X-Run-Id”的助手消息。

### 7. 启动脚本在 Windows 下的兼容

- **问题**：`start-server-first.js` 中通过 concurrently 传入 `"pnpm --filter @vibego/protocol dev"` 与 `"pnpm --filter @vibego/web dev"` 时，在 Windows 上子命令解析异常，导致前端启动失败（如出现“'dev' 不是内部或外部命令”）。
- **改动**：前端启动改为调用根目录的 `pnpm run dev:web`，不再向 concurrently 传入两条独立 pnpm 命令。
- **效果**：Windows 下 `pnpm dev` 可稳定先起后端再起前端。

## 配置文件

- 后端配置：`config/config.json`（须为合法 JSON，不要使用 `//` 注释）。
- 端口、roots、limits 等见 `config/config.example.json` 及 [README.md](../README.md) 中的配置说明。

## 故障排查

- **ERR_CONNECTION_REFUSED（3990）**：后端未启动或已崩溃。先运行 `pnpm dev:server` 看控制台是否有 `[server] main() started`、`✅ Server running on 0.0.0.0:3990` 或报错信息。
- **500 且后端已启动**：查看后端终端日志，接口会打印 `[api/roots]`、`[api/setup/check]` 等错误；若为 db 相关，会看到 `[server] db module load failed: ...`。
- **3989 / 3990 端口被占用**：执行 `pnpm dev:fresh` 或手动运行 `node scripts/free-ports.js` 后再启动。

更多稳定性与守护进程说明见 [STABILITY.md](STABILITY.md)。
