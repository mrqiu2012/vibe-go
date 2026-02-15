# VibeGo

**中文**  
VibeGo 是一款本机两段式 Web IDE：目录树 + 文件编辑器 + 受限终端，并集成 Cursor CLI（`agent`）、Codex CLI、Claude Code CLI（`claude`）与 OpenCode CLI（`opencode`）。

**English**  
VibeGo is a local two-panel Web IDE: file tree + editor + restricted terminal, with Cursor CLI (`agent`), Codex CLI, Claude Code CLI (`claude`), and OpenCode CLI (`opencode`) integration.

---

**中文 | 主要特性**

- 本地目录树与文件编辑器
- 受限终端（Restricted / Codex / Claude / OpenCode / Cursor 模式）
- 前后端分离，开发态端口清晰
- Windows 兼容（CLI 路径查找、PTY 行为优化）

**English | Highlights**

- Local file tree and editor
- Restricted terminal modes (Restricted / Codex / Claude / OpenCode / Cursor)
- Clear dev ports with separated frontend/backend
- Windows-friendly CLI path handling and PTY behavior

---

**中文 | 安装与运行**

1. 环境要求  
   Node.js v18+  
   pnpm 10.4.0+（见 `package.json` 的 `packageManager`）  
   终端环境（Windows 推荐 PowerShell）

可选但推荐：  
Cursor CLI（`agent`）、Ripgrep（`rg`）、Codex CLI（`codex`）、Claude Code CLI（`claude`）、OpenCode CLI（`opencode`）

2. 获取项目

```bash
cd <你的工作目录>
git clone <repo> vibe-go
cd vibe-go
```

3. 安装依赖

```bash
pnpm install
```

4. 配置项目

```bash
cp config/config.example.json config/config.json
```

把本机可访问目录放到 `config/roots.local.json`（自动忽略，不提交）：

```json
[
  "/path/to/workspace"
]
```

说明：  
`config/roots.local.json` 会覆盖 `config/config.json` 的 `roots`。  
在安装引导页添加根目录时，会自动生成该文件。  
也可以用环境变量覆盖（优先级最高）：

```bash
VIBEGO_ROOTS='["/path/a","/path/b"]' pnpm dev
```

Windows 路径示例：`E:\\test`。

前端 API 基址（可选）  
在前端开发或内网访问场景，可通过 `VITE_API_BASE` 指定后端地址：

```bash
VITE_API_BASE="http://<server-ip>:3990" pnpm dev
```

5. 安装 CLI（可选但推荐）

Cursor CLI（agent）：

```bash
curl https://cursor.com/install -fsS | bash
```

Windows PowerShell：

```powershell
irm 'https://cursor.com/install?win32=true' | iex
```

验证：

```bash
agent --version
```

Ripgrep（rg）：

```bash
rg --version
```

Codex CLI：

```bash
npm i -g @openai/codex
codex --version
```

Claude Code CLI：

```bash
# 官方推荐（macOS/Linux/WSL）
curl -fsSL https://claude.ai/install.sh | bash

# 或 macOS Homebrew
brew install --cask claude-code

claude --version
```

Windows PowerShell：

```powershell
irm https://claude.ai/install.ps1 | iex
claude --version
```

OpenCode CLI：

```bash
# 官方推荐
curl -fsSL https://opencode.ai/install | bash

# 或 npm
npm install -g opencode-ai

opencode --version
```

6. 启动项目

```bash
pnpm dev
```

其他方式：  
`pnpm dev:fresh`（释放 3989/3990）  
`pnpm dev:server`（仅后端）  
`pnpm dev:web`（仅前端）  
`pnpm dev:all`（不保证先后顺序）

7. 访问与验证

Web 前端：`http://localhost:3989/`  
服务器 API：`http://localhost:3990/api/*`  
WebSocket：`ws://localhost:3990/ws/term`  
健康检查：`http://localhost:3990/healthz`

验证 API：

```bash
curl http://localhost:3990/api/roots
```

8. 安装引导页提示  
数据库初始化可跳过并直接进入功能页，但聊天记录/工作区等功能可能不可用或报错。

---

**English | Install & Run**

1. Requirements  
   Node.js v18+  
   pnpm 10.4.0+ (see `package.json` `packageManager`)  
   Terminal (PowerShell recommended on Windows)

Optional but recommended:  
Cursor CLI (`agent`), Ripgrep (`rg`), Codex CLI (`codex`), Claude Code CLI (`claude`), OpenCode CLI (`opencode`)

2. Clone

```bash
cd <your-workspace>
git clone <repo> vibe-go
cd vibe-go
```

3. Install dependencies

```bash
pnpm install
```

4. Configuration

```bash
cp config/config.example.json config/config.json
```

Put local roots in `config/roots.local.json` (git-ignored):

```json
[
  "/path/to/workspace"
]
```

Notes:  
`config/roots.local.json` overrides `roots` in `config/config.json`.  
The setup page will generate it when you add roots.  
You can override via env (highest priority):

```bash
VIBEGO_ROOTS='["/path/a","/path/b"]' pnpm dev
```

Windows path example: `E:\\test`.

5. Install CLIs (optional but recommended)

Cursor CLI (agent):

```bash
curl https://cursor.com/install -fsS | bash
```

Windows PowerShell:

```powershell
irm 'https://cursor.com/install?win32=true' | iex
```

Verify:

```bash
agent --version
```

Ripgrep (rg):

```bash
rg --version
```

Codex CLI:

```bash
npm i -g @openai/codex
codex --version
```

Claude Code CLI:

```bash
# Recommended (macOS/Linux/WSL)
curl -fsSL https://claude.ai/install.sh | bash

# Or Homebrew on macOS
brew install --cask claude-code

claude --version
```

Windows PowerShell:

```powershell
irm https://claude.ai/install.ps1 | iex
claude --version
```

OpenCode CLI:

```bash
# Recommended
curl -fsSL https://opencode.ai/install | bash

# Or npm
npm install -g opencode-ai

opencode --version
```

6. Start

```bash
pnpm dev
```

Other modes:  
`pnpm dev:fresh` (free 3989/3990)  
`pnpm dev:server` (backend only)  
`pnpm dev:web` (frontend only)  
`pnpm dev:all` (no guaranteed order)

7. Verify

Web: `http://localhost:3989/`  
API: `http://localhost:3990/api/*`  
WebSocket: `ws://localhost:3990/ws/term`  
Health: `http://localhost:3990/healthz`

Test API:

```bash
curl http://localhost:3990/api/roots
```

8. Setup note  
You can skip DB initialization to enter the app, but chat/workspace features may be unavailable or error.

---

**中文 | Windows 说明（重点）**

- `agent` 首次运行需信任 Workspace（弹窗按 `a` 选择 Trust）
- Windows 下启动建议使用前台命令（不要后台 Start-Process），否则 PTY 可能不可用
- `agent`/`rg`/`codex`/`claude`/`opencode` 找不到时，先检查 PATH，Windows 用 `where.exe` 验证  
  常见位置：`%LOCALAPPDATA%\\cursor-agent\\agent.cmd`，`%APPDATA%\\npm\\codex.cmd`

Ripgrep 推荐通过 winget 安装：

```powershell
winget install --id BurntSushi.ripgrep.MSVC -e --accept-source-agreements --accept-package-agreements
rg --version
```

若已安装但仍提示找不到 `rg`，可将 `rg.exe` 所在目录加入用户 PATH（重开终端生效）：

```powershell
$rgExe = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter "rg.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
$rgDir = $rgExe.DirectoryName
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($rgDir -and ($userPath -notlike "*$rgDir*")) {
  [Environment]::SetEnvironmentVariable("Path", $userPath + ";" + $rgDir, "User")
  Write-Host "已添加 rg 目录到用户 PATH，请重开终端后执行 rg --version"
}
```

**English | Windows Notes**

- First run of `agent` requires Workspace Trust (press `a`)
- Start in a foreground terminal (avoid background Start-Process), or PTY may fail
- If `agent`/`rg`/`codex`/`claude`/`opencode` is not found, check PATH via `where.exe`  
  Common locations: `%LOCALAPPDATA%\\cursor-agent\\agent.cmd`, `%APPDATA%\\npm\\codex.cmd`

Install ripgrep with winget:

```powershell
winget install --id BurntSushi.ripgrep.MSVC -e --accept-source-agreements --accept-package-agreements
rg --version
```

If `rg` is still missing, add the `rg.exe` directory to user PATH:

```powershell
$rgExe = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter "rg.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
$rgDir = $rgExe.DirectoryName
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($rgDir -and ($userPath -notlike "*$rgDir*")) {
  [Environment]::SetEnvironmentVariable("Path", $userPath + ";" + $rgDir, "User")
  Write-Host "rg directory added. Restart your terminal and run rg --version"
}
```

---

**中文 | 常见问题**

- 3990 连接失败：后端未启动或崩溃，先运行 `pnpm dev:server`
- 500 且后端已启动：查看后端日志，db 加载失败会返回 503
- 3989/3990 被占用：运行 `pnpm dev:fresh`
- 找不到 `agent`/`rg`/`codex`/`claude`/`opencode`：检查 PATH，Windows 用 `where.exe`

**English | Troubleshooting**

- 3990 connection refused: backend not running, try `pnpm dev:server`
- 500 with backend up: check server logs; DB load failure returns 503
- Ports 3989/3990 in use: run `pnpm dev:fresh`
- `agent`/`rg`/`codex`/`claude`/`opencode` not found: check PATH, use `where.exe` on Windows

---

**中文 | 后台常驻**

使用 PM2：

```bash
pnpm add -g pm2
pnpm pm2:start
```

**English | Run in Background**

Using PM2:

```bash
pnpm add -g pm2
pnpm pm2:start
```

---

**License**

MIT License, see `LICENSE`.
