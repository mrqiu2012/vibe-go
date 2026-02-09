# VibeGo Windows 安装和配置指南

本文档记录了在 Windows 系统上安装和配置 VibeGo 项目的完整过程。

## 目录

1. [项目概述](#项目概述)
2. [前置要求](#前置要求)
3. [安装步骤](#安装步骤)
4. [配置说明](#配置说明)
5. [常见问题解决](#常见问题解决)
6. [验证安装](#验证安装)

---

## 项目概述

VibeGo 是一个本机两段式 Web IDE，包含：
- 目录树 + 文件编辑器
- 受限终端
- Cursor CLI (agent) 集成
- Codex CLI 集成

**默认端口：**
- Web 前端：`http://localhost:3989`
- 服务器 API：`http://localhost:3990`

---

## 前置要求

### 必需软件

1. **Node.js** (推荐 v18+)
2. **pnpm** (包管理器，版本 9.15.9+)
3. **PowerShell** (Windows 自带)

### 验证安装

```powershell
# 检查 Node.js
node --version

# 检查 pnpm
pnpm --version
```

---

## 安装步骤

### 1. 克隆/下载项目

```powershell
cd E:\phpstudy_pro\WWW\vibe-go
```

### 2. 安装项目依赖

```powershell
pnpm install
```

这会安装所有工作区的依赖（protocol、server、web、control）。

### 3. 配置项目

#### 3.1 创建配置文件

如果 `config/config.json` 不存在，从示例文件复制：

```powershell
cp config/config.example.json config/config.json
```

#### 3.2 编辑配置文件

编辑 `config/config.json`，设置允许访问的目录：

```json
{
  "server": {
    "port": 3990
  },
  "roots": [
    "E:\\phpstudy_pro\\WWW"
  ],
  "dangerousCommandDenylist": [
    "sudo", "su", "rm", "shutdown", "reboot", "kill", "pkill",
    "launchctl", "chmod", "chown", "chgrp", "dd", "diskutil", "mount", "umount"
  ],
  "limits": {
    "timeoutSec": 900,
    "maxOutputKB": 1024,
    "maxSessions": 4
  }
}
```

**重要：**
- `roots` 数组中的路径必须是 Windows 格式（使用双反斜杠 `\\`）
- 确保路径存在且可访问

### 4. 安装 Cursor CLI (agent)

#### 4.1 使用 PowerShell 安装

```powershell
irm 'https://cursor.com/install?win32=true' | iex
```

#### 4.2 验证安装

```powershell
agent --version
```

应该显示版本号，例如：`2026.01.28-fd13201`

#### 4.3 添加到 PATH（如果需要）

如果 `agent` 命令在 CMD 中不可用，需要重新打开终端或手动添加到 PATH：

```powershell
# 检查 agent 位置
where.exe agent

# 通常位置：C:\Users\<用户名>\AppData\Local\cursor-agent\agent.cmd
```

#### 4.4 首次运行需要信任工作区

首次运行 `agent` 会弹出 **Workspace Trust** 提示，需要在弹窗中按 `a` 选择 Trust。  
如果不信任，`cursor-cli-agent` 终端会无法启动。

建议手动先运行一次：

```powershell
cd /d E:\phpstudy_pro\WWW\vibe-go
agent
```

### 5. 安装 Ripgrep (rg)

#### 5.1 使用 winget 安装

```powershell
winget install --id BurntSushi.ripgrep.MSVC -e --accept-source-agreements --accept-package-agreements
```

#### 5.2 验证安装

```powershell
rg --version
```

应该显示版本号，例如：`ripgrep 15.1.0`

#### 5.2.1 已安装但仍提示找不到 rg（更新环境变量 PATH）

winget 会把 ripgrep 装到用户目录下的嵌套子目录，但 PATH 里可能只加了父目录，导致系统找不到 `rg.exe`。  
若已用 winget 安装且 `winget install` 提示“找到已安装的现有包”，但运行 `agent` 仍报 “Could not find ripgrep (rg) binary”，说明需要把**包含 `rg.exe` 的子目录**加入用户 PATH。

**方法一：直接把 ripgrep 目录加入用户 PATH（推荐）**

在 PowerShell 中执行（请把下面的路径换成你机器上实际找到的 `ripgrep-*` 目录）：

```powershell
# 1) 查找 rg.exe 所在目录（通常为 WinGet Packages 下的 ripgrep-* 子目录）
$rgExe = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter "rg.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
$rgDir = $rgExe.DirectoryName
Write-Host "找到 ripgrep 目录: $rgDir"

# 2) 将该目录加入用户环境变量 Path（永久生效）
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath -notlike "*$rgDir*") {
  [Environment]::SetEnvironmentVariable("Path", $currentPath + ";" + $rgDir, "User")
  Write-Host "已添加 ripgrep 目录到用户 PATH。请关闭并重新打开终端后执行: rg --version"
} else {
  Write-Host "PATH 中已包含该目录。若仍找不到 rg，请重新打开终端。"
}
```

然后**关闭当前所有 CMD/PowerShell 窗口，重新打开一个新终端**，再执行：

```powershell
rg --version
agent
```

**方法二：拷贝 rg.exe 到用户 bin 并加入 PATH**

若不想改 PATH 指向 WinGet 目录，可把 `rg.exe` 拷到固定目录再加 PATH：

```powershell
# 1) 找到 winget 安装目录里的 rg.exe
$rg = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter rg.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
$rg.FullName

# 2) 拷贝到用户 bin 目录
$bin = "$env:USERPROFILE\bin"
if (-not (Test-Path $bin)) { New-Item -ItemType Directory -Path $bin | Out-Null }
Copy-Item -Force $rg.FullName (Join-Path $bin "rg.exe")

# 3) 将用户 bin 加入 PATH（永久生效）
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not $userPath) { $newPath = $bin }
elseif ($userPath.Split(";") -notcontains $bin) { $newPath = $userPath + ";" + $bin }
else { $newPath = $userPath }
if ($newPath -ne $userPath) { [Environment]::SetEnvironmentVariable("Path", $newPath, "User") }

# 4) 重新打开终端后验证
# where.exe rg
# rg --version
```

#### 5.3 刷新环境变量（仅当前会话）

若已修改用户 PATH 但当前终端仍找不到 `rg`，可在当前 PowerShell 中临时刷新 PATH 再验证（新开的终端会自动读取新 PATH，无需此步）：

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
rg --version
```

---

## 重要：Windows 下启动方式影响终端是否可用

`cursor-cli-agent` 使用 node-pty，需要有 **控制台窗口** 的进程环境。  
如果用后台方式启动（例如 PowerShell `Start-Process` 且不保留控制台），终端可能无法使用。

**推荐启动方式：**

```powershell
cd /d E:\phpstudy_pro\WWW\vibe-go
pnpm dev
```

如果需要单独启动后端，请在独立控制台运行：

```powershell
cd /d E:\phpstudy_pro\WWW\vibe-go
pnpm --filter @vibego/server dev
```

---

## Cursor Chat 模式无输出（Windows）

**现象：**  
终端有输出，但网页 Chat 面板没有显示内容。

**原因：**  
Windows 下 `agent` 进程如果以 `detached` 方式启动，会导致 stdout/stderr 管道丢失，网页轮询只拿到 `result`，中间内容不会出现。

**修复：**  
已在后端修复（Windows 禁用 `detached`，并设置 `windowsHide`）。

如果你需要自查是否已修复，可检查文件：

- `apps/server/src/cursorAgent.ts`  
  `spawn(..., { detached: process.platform !== "win32", windowsHide: true })`

### 6. 安装 Codex CLI（可选）

如果需要使用 Codex 功能：

```powershell
npm i -g @openai/codex
```

验证安装：

```powershell
codex --version
```

---

## 配置说明

### 代码修改

项目已针对 Windows 进行了以下代码修改：

#### 1. `apps/server/src/cursorAgent.ts`
- 添加 Windows 特定的 agent 路径查找
- 使用 `where.exe` 替代 `which` 命令
- 支持 `%LOCALAPPDATA%\cursor-agent\agent.cmd` 路径

#### 2. `apps/server/src/term/cursorCliManager.ts`
- 添加 Windows 特定的 agent 路径查找
- 优化 PATH 构建，包含 WinGet Packages 路径
- 直接查找 ripgrep 路径并添加到 PATH 最前面

#### 3. `apps/server/src/term/codexManager.ts` 和 `ptyCodexManager.ts`
- 添加 Windows 特定的 codex 路径查找
- 使用 `where.exe` 替代 `which` 命令
- 支持 `%APPDATA%\npm\codex.cmd` 路径

#### 4. `apps/server/src/term/ptyCodexManager.ts`
- 移除了不支持的 `--no-alt-screen` 参数

---

## 常见问题解决

### 问题 1: 500 Internal Server Error

**症状：** 浏览器控制台显示 API 请求返回 500 错误

**解决方案：**
1. 检查服务器是否运行：`netstat -ano | findstr ":3990"`
2. 重启服务器：
   ```powershell
   cd E:\phpstudy_pro\WWW\vibe-go
   pnpm --filter @vibego/server dev
   ```

### 问题 2: Cannot find "agent" CLI

**症状：** 终端显示找不到 agent 命令

**解决方案：**
1. 确认 agent 已安装：`agent --version`
2. 检查路径：`where.exe agent`
3. 如果路径是 `C:\Users\<用户名>\AppData\Local\cursor-agent\agent.cmd`，代码会自动找到
4. 重启服务器以应用代码更改

### 问题 3: Could not find ripgrep (rg) binary

**症状：** Cursor CLI 提示 “Could not find ripgrep (rg) binary. Please install ripgrep.”

**解决方案：**
1. 确认 ripgrep 已安装：`winget list BurntSushi.ripgrep.MSVC` 或执行 `winget install --id BurntSushi.ripgrep.MSVC -e` 安装。
2. 若已安装但命令行仍找不到 `rg`，多半是 PATH 未包含 ripgrep 的**子目录**（winget 安装到嵌套路径）。请按上文 **[5.2.1 已安装但仍提示找不到 rg（更新环境变量 PATH）](#521-已安装但仍提示找不到-rg更新环境变量-path)** 将包含 `rg.exe` 的目录加入用户 PATH。
3. 修改 PATH 后**关闭并重新打开终端**，再执行 `rg --version` 和 `agent`。

### 问题 4: Cannot find "codex"

**症状：** Codex 模式提示找不到 codex 命令

**解决方案：**
1. 确认 codex 已安装：`codex --version`
2. 检查路径：`where.exe codex`
3. 如果路径是 `C:\Users\<用户名>\AppData\Roaming\npm\codex.cmd`，代码会自动找到
4. 重启服务器以应用代码更改

### 问题 5: codex 参数错误

**症状：** `error: unexpected argument '--no-alt-screen' found`

**解决方案：**
- 已修复：代码已移除不支持的参数
- 重启服务器以应用更改

---

## 验证安装

### 1. 启动项目

```powershell
cd E:\phpstudy_pro\WWW\vibe-go
pnpm dev
```

这会同时启动：
- `@vibego/protocol` - 协议包（开发模式）
- `@vibego/server` - 后端服务器（端口 3990）
- `@vibego/web` - 前端应用（端口 3989）

### 2. 检查服务状态

```powershell
# 检查端口
netstat -ano | findstr "LISTENING" | findstr ":3990 :3989"

# 检查服务器健康状态
Invoke-WebRequest -Uri "http://localhost:3990/healthz" -UseBasicParsing

# 检查 API
Invoke-WebRequest -Uri "http://localhost:3990/api/roots" -UseBasicParsing
```

### 3. 访问 Web 界面

在浏览器中打开：`http://localhost:3989`

### 4. 测试功能

- **文件浏览**：检查目录树是否正常显示
- **文件编辑**：尝试打开和编辑文件
- **终端**：测试 Restricted 终端模式
- **Cursor CLI**：测试 Cursor CLI (agent) 模式
- **Codex**：测试 Codex 模式（如果已安装）

---

## 项目结构

```
vibe-go/
├── apps/
│   ├── control/      # 控制应用
│   ├── server/       # 后端服务器
│   └── web/          # Web 前端
├── packages/
│   └── protocol/     # 协议包
├── config/
│   └── config.json   # 配置文件
└── docs/             # 文档
```

---

## 开发命令

```powershell
# 开发模式（启动所有服务）
pnpm dev

# 仅启动服务器
pnpm --filter @vibego/server dev

# 仅启动前端
pnpm --filter @vibego/web dev

# 构建项目
pnpm build

# 启动生产服务器
pnpm start
```

---

## 环境变量（可选）

如果需要自定义路径，可以设置以下环境变量：

```powershell
# Cursor CLI 路径
$env:AGENT_BIN = "C:\Users\<用户名>\AppData\Local\cursor-agent\agent.cmd"

# Codex CLI 路径
$env:CODEX_BIN = "C:\Users\<用户名>\AppData\Roaming\npm\codex.cmd"

# 配置文件路径
$env:CONFIG_PATH = "E:\phpstudy_pro\WWW\vibe-go\config\config.json"
```

---

## 故障排除

### 服务器无法启动

1. 检查端口是否被占用：
   ```powershell
   netstat -ano | findstr ":3990"
   ```

2. 检查配置文件是否正确：
   ```powershell
   Get-Content config\config.json | ConvertFrom-Json
   ```

3. 查看服务器日志（在新窗口中运行）：
   ```powershell
   cd E:\phpstudy_pro\WWW\vibe-go
   pnpm --filter @vibego/server dev
   ```

### 工具找不到

1. 确认工具已安装并可用：
   ```powershell
   agent --version
   rg --version
   codex --version  # 如果安装了
   ```

2. 检查 PATH 环境变量：
   ```powershell
   $env:Path -split ';' | Select-String -Pattern "cursor|ripgrep|codex"
   ```

3. 重启服务器以应用代码更改

---

## 总结

### 已完成的配置

✅ 项目依赖安装  
✅ 配置文件设置（Windows 路径格式）  
✅ Cursor CLI (agent) 安装和配置  
✅ Ripgrep 安装和配置  
✅ Codex CLI 安装和配置（可选）  
✅ Windows 特定代码修改  
✅ PATH 环境变量优化  

### 关键文件修改

- `apps/server/src/cursorAgent.ts` - Windows agent 支持
- `apps/server/src/term/cursorCliManager.ts` - Windows agent 和 ripgrep PATH 支持
- `apps/server/src/term/codexManager.ts` - Windows codex 支持
- `apps/server/src/term/ptyCodexManager.ts` - Windows codex 支持，移除不支持的参数
- `config/config.json` - Windows 路径配置

### 访问地址

- **Web 前端**：http://localhost:3989
- **服务器 API**：http://localhost:3990
- **健康检查**：http://localhost:3990/healthz

---

## 参考文档

- [Cursor CLI 使用指南](docs/cursor-cli-guide%20origin.md)
- [Codex CLI 安装指南](docs/codex-cli-installation.md)
- [项目 README](README.md)

---

**最后更新：** 2026-02-07  
**适用系统：** Windows 10/11  
**Node.js 版本：** 推荐 v18+
