# 方案：后端任务独立运行 + 本地缓冲文件 + 前端从文件读取

## 一、目标

- **后端任务与前端解耦**：任务由后端独立启动、独立运行，不依赖任何前端连接是否存在。
- **输出先落盘**：流式输出先写入**本地缓冲文件**，前端只负责按需从文件（或通过接口读文件内容）拉取。
- **前端可随时接入**：页面刷新、关掉再开、换设备，只要知道 `runId`，都能继续从缓冲文件读到完整/增量输出。

## 二、整体架构

```
前端 POST「启动任务」 → 后端生成 runId，立即返回
                    → 后端起子进程，输出只写「缓冲文件」
                    ↓
前端 GET「任务输出」 → 后端按 runId 读缓冲文件（支持 offset/增量）
                    → 返回 NDJSON 行（或 SSE 流）
```

- 任务生命周期、超时、结束，全部在后端完成；**不依赖**前端的连接、断开、刷新。
- 前端只做两件事：发起「启动」、按需「拉取输出」（轮询或长轮询/流式读文件）。

---

## 三、后端设计要点

### 3.1 任务启动（与前端解耦）

- **接口**：保留或新增「启动任务」API，例如 `POST /api/cursor-agent/start`（或沿用现有 stream 的 POST 但改语义）。
- **行为**：
  - 校验参数（prompt、mode、cwd 等），生成唯一 `runId`。
  - **立即**返回 200 + `runId`（body 或 header），不保持长连接、不绑任何 response。
  - 在后台异步启动 Cursor Agent 子进程（与当前请求完全脱钩）。
- **结论**：前端只拿到 `runId`，任务是否在跑、何时结束，都不依赖该请求是否还连着。

### 3.2 缓冲文件

- **路径**：为每次运行单独一个文件，例如：  
  `{bufferDir}/{runId}.ndjson`  
  其中 `bufferDir` 可配置（如项目下 `data/agent-buffers/` 或系统 temp 目录）。
- **格式**：与当前一致，一行一个 JSON（NDJSON），例如：
  - 普通输出行（Cursor CLI 的 stream-json 行）
  - 封装行：`{ "type": "stderr", "message": "..." }`
  - 结束行：`{ "type": "result", "exitCode": ..., "signal": ..., "timedOut": ... }`
- **写入方**：仅后端子进程的 stdout/stderr 处理逻辑（与当前 spawn 回调类似）：
  - 每收到一行就 **append** 到该 runId 对应文件。
  - 进程正常结束或超时被杀时，写一条 `type: "result"` 再关闭文件。
- **不依赖连接**：不往任何 `res`、不维护 `listeners`；只写文件，任务完全独立于前端。

### 3.3 任务输出读取接口（前端从“文件”读）

- **语义**：按 `runId` 读该任务的缓冲文件，支持从某位置开始读（增量），避免重复拉取。
- **方式一：按字节/行 offset 轮询（推荐先做）**
  - 例如：`GET /api/cursor-agent/task/:runId/output?offset=0`  
  - 服务端打开 `{runId}.ndjson`，从 `offset` 起读（或按行跳过），返回：
    - 新内容（例如后续 raw 字节或 NDJSON 行）
    - 以及新的 `offset` 或 `nextOffset`，供下次请求使用。
  - 若任务已结束，可同时返回 `ended: true`，前端停止轮询。
- **方式二：长轮询**
  - 同上 GET，但若当前没有新内容且任务未结束，则挂起一段时间（如 15–30s）再返回；减少轮询次数。
- **方式三：流式读文件（SSE 或 chunked）**
  - `GET /api/cursor-agent/task/:runId/stream`  
  - 服务端打开文件，从开头或指定 offset 流式读出并推给 response；读到当前 EOF 时若任务未结束，可 tail 文件（轮询文件变化）继续推，直到任务结束。
- **未找到 runId / 文件**：返回 404；任务已结束且文件已被清理时同理。

### 3.4 超时与进程管理（保持现有逻辑）

- 沿用现有「无输出 N 分钟则杀进程」的 inactivity 超时；超时后写 `type: "result", timedOut: true` 到缓冲文件并关闭文件。
- 不在 `req.on("close")` 里杀进程；任务只由「正常结束」或「inactivity 超时」结束。

### 3.5 缓冲文件清理

- 策略示例：任务结束超过一定时间（如 24 小时）且无新读取后，删除该 runId 的缓冲文件，避免占盘。
- 可选：记录「最后读取时间」或「已读 offset 已达文件末尾」再决定是否可删。

---

## 四、前端设计要点

### 4.1 启动任务

- 调用 `POST /api/cursor-agent/start`（或你定的启动 API），body 与现在一致（prompt、mode、cwd 等）。
- 收到 200 后从 body/header 取 `runId`，存到 state/ref（与当前会话/助理消息绑定）。
- **不**再依赖「流式 response 体」来维持任务；任务已在后端独立跑。

### 4.2 消费输出（从“文件”读）

- **轮询**：定时或 requestAnimationFrame 调用 `GET /api/cursor-agent/task/:runId/output?offset=上次的 offset`。
  - 用返回的新内容按行 `JSON.parse` 后，复用现有 `handleEvent` 更新 UI（与当前方案 A 的「重放 + 追新」一致）。
  - 用返回的 `nextOffset` 作为下次 `offset`；若 `ended: true` 则停止轮询并设 loading = false。
- **可选：长轮询或 SSE**：若后端提供长轮询或流式读文件接口，前端可改为「一次连接拉一段」或「一个长连接持续拉」，逻辑仍是「解析 NDJSON 行 → handleEvent」。
- **Visibility**：从后台回到前台时，若当前有未结束的 `runId`，继续用该 `runId` 从最新 offset 轮询即可，无需「重连」HTTP 流，因为数据源是文件。

### 4.3 停止任务（可选）

- 若需要「用户点停止」：可增加 `POST /api/cursor-agent/task/:runId/stop`，后端杀该 runId 对应进程，并在缓冲文件末尾写 `type: "result", signal: "SIGTERM"` 等；前端轮询会自然读到结束行并停止。

### 4.4 不依赖连接、可随时刷新

- 刷新页面或新开 Tab：若能从会话/本地恢复出当前任务的 `runId`，即可直接对 `runId` 做 output 轮询，从 offset 0 或上次保存的 offset 继续读，实现「后台执行 + 随时再看」。

---

## 五、与当前方案 A 的对比

| 维度         | 当前方案 A（内存缓冲 + 重连）     | 新方案（文件缓冲 + 独立任务）     |
|--------------|----------------------------------|----------------------------------|
| 任务是否依赖前端 | 仍由「某次 POST」创建，断线不杀进程但 run 在内存 | 不依赖；启动即返回，进程只写文件 |
| 输出存哪     | 内存 Map + 可选写文件             | 只写本地缓冲文件                 |
| 前端拿数据   | 长连接流 或 重连 GET 流           | 轮询/长轮询/流式读「文件内容」   |
| 服务重启     | 内存 run 丢失                     | 仅影响正在跑的进程；已落盘输出可读 |
| 多端/多 Tab  | 需共享同一 runId 并重连           | 同一 runId 多端轮询同一文件即可 |

---

## 六、实施顺序建议

1. **后端**
   - 定好缓冲目录与命名（`bufferDir`、`{runId}.ndjson`）。
   - 新增「启动任务」API：只生成 runId、创建缓冲文件、异步 spawn 子进程，stdout/stderr 只写该文件，立即 200 + runId。
   - 移除或淡化「stream 长连接」的写 res 逻辑；`req.on("close")` 不再杀进程（若仍保留 stream 接口可只做兼容，主路径走「启动 + 文件」）。
   - 新增「读输出」API：`GET /api/cursor-agent/task/:runId/output?offset=...`（及可选的 long-poll / stream 变体）。
   - 任务结束（正常/超时）时写 result 行并关闭文件；可选实现清理策略。
2. **前端**
   - 启动改为调新 API，只拿 `runId`。
   - 用轮询（或长轮询/SSE）从 output 接口拉取，用现有 `handleEvent` 更新 UI，维护 `offset` 与 `ended`。
   - 从后台恢复时继续对当前 `runId` 轮询，无需再依赖「流重连」。
