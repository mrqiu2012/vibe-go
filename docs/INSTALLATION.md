# VibeGo 通用安装与运行指南

本指南提供跨平台的主要安装与运行流程。Windows 细节请参考 `docs/INSTALLATION_WINDOWS.md`。

## 1. 前置要求

- Node.js（推荐 v18+）
- pnpm（推荐 9.15.9+）
- 终端环境（Windows 推荐 PowerShell）

验证：

```bash
node --version
pnpm --version
```

## 2. 获取项目

```bash
cd <你的工作目录>
# 已经有代码则跳过
# git clone <repo> vibe-go
cd vibe-go
```

## 3. 安装依赖

```bash
pnpm install
```

## 4. 配置项目

如果 `config/config.json` 不存在，从示例复制：

```bash
cp config/config.example.json config/config.json
```

编辑 `config/config.json`，至少设置 `roots` 为可访问目录：

```json
{
  "server": { "port": 3990 },
  "roots": ["/path/to/workspace"],
  "dangerousCommandDenylist": [
    "sudo", "su", "rm", "shutdown", "reboot", "kill", "pkill",
    "launchctl", "chmod", "chown", "chgrp", "dd", "diskutil", "mount", "umount"
  ],
  "limits": { "timeoutSec": 900, "maxOutputKB": 1024, "maxSessions": 4 }
}
```

Windows 路径请使用双反斜杠，例如：`E:\\phpstudy_pro\\WWW`。

## 5. 安装 CLI（可选但推荐）

### Cursor CLI (agent)

- Windows 安装与路径细节：`docs/INSTALLATION_WINDOWS.md`
- macOS / Linux 安装（官方一键脚本）：

```bash
curl https://cursor.com/install -fsS | bash
```

- Windows 安装（PowerShell）：

```powershell
irm 'https://cursor.com/install?win32=true' | iex
```

- 安装完成后验证：

```bash
agent --version
```

### Ripgrep（建议安装，终端/搜索依赖）

```bash
rg --version
```

### Codex CLI（可选）

```bash
npm i -g @openai/codex
codex --version
```

## 6. 启动项目

推荐开发模式（启动 server + web + protocol）：

```bash
pnpm dev
```

只启动后端：

```bash
pnpm --filter @vibego/server dev
```

只启动前端：

```bash
pnpm --filter @vibego/web dev
```

## 7. 访问与验证

- Web 前端：`http://localhost:3989`
- 服务器 API：`http://localhost:3990`
- 健康检查：`http://localhost:3990/healthz`

验证 API：

```bash
curl http://localhost:3990/api/roots
```

## 8. 常见问题指引（概览）

- 终端或 Cursor Chat 无输出：Windows 请看 `docs/INSTALLATION_WINDOWS.md`
- 找不到 `agent` / `rg` / `codex`：检查 PATH 或重启终端
- 500 错误：确认后端端口 3990 是否监听

## 参考文档

- `docs/INSTALLATION_WINDOWS.md`
- `docs/codex-cli-installation.md`
- `docs/cursor-cli-guide origin.md`

最后更新：2026-02-07
