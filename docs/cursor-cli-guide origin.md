# Cursor CLI 使用指南

借助 Cursor CLI，你可以直接在终端与 AI 代理交互，以编写、审阅和修改代码。无论你偏好交互式终端界面，还是为脚本与 CI 流水线进行输出式自动化，CLI 都能在你的工作环境中提供强大的编码协助。

---

## 目录

1. [快速入门](#1-快速入门)
2. [安装详解](#2-安装详解)
3. [交互模式](#3-交互模式)
4. [非交互模式与脚本](#4-非交互模式与脚本)
5. [Cloud Agent](#5-cloud-agent)
6. [会话管理](#6-会话管理)
7. [沙箱与 Shell 执行](#7-沙箱与-shell-执行)
8. [规则与 MCP](#8-规则与-mcp)
9. [Headless 与脚本示例](#9-headless-与脚本示例)
10. [处理图像与媒体](#10-处理图像与媒体)
11. [常见问题与疑难解答](#11-常见问题与疑难解答)

---

## 1. 快速入门

**安装**

```bash
# macOS、Linux、WSL
curl https://cursor.com/install -fsS | bash

# Windows（PowerShell）
irm 'https://cursor.com/install?win32=true' | iex
```

**运行交互式会话**

```bash
# 启动交互式会话
agent

# 使用初始提示启动
agent "重构认证模块以使用 JWT 令牌"
```

**验证安装**

```bash
agent --version
```

---

## 2. 安装详解

### macOS、Linux 和 WSL

```bash
curl https://cursor.com/install -fsS | bash
```

### Windows（原生）

在 PowerShell 中执行：

```powershell
irm 'https://cursor.com/install?win32=true' | iex
```

### 安装后设置（PATH）

将 `~/.local/bin` 添加到 PATH：

**Bash：**

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

**Zsh：**

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### 更新

CLI 默认会尝试自动更新。手动更新：

```bash
agent update
# 或
agent upgrade
```

---

## 3. 交互模式

### 模式切换

CLI 支持与编辑器相同的模式，可通过斜杠命令、键盘快捷键或 `--mode` 参数切换。

| 模式 | 描述 | 快捷键 / 命令 |
|------|------|----------------|
| Agent | 完整访问所有工具，用于复杂编码任务 | 默认 |
| Plan | 在编写代码前通过澄清性提问设计实现方案 | `Shift+Tab`、`/plan`、`--mode=plan` |
| Ask | 只读探索，不对代码做任何修改 | `/ask`、`--mode=ask` |

- **Plan 模式**：在编写代码前规划方案，Agent 会提出澄清问题。
- **Ask 模式**：在不修改代码的情况下探索代码库，Agent 会搜索并回答，但不会编辑文件。

### 快捷键与操作

**导航与输入**

- `ArrowUp` / `ArrowDown`：查看上一条/下一条消息
- `Shift+Tab`：在 Agent、Plan、Ask 之间切换
- `Shift+Enter`：插入换行而不提交（多行提示）
- `Ctrl+J` 或 `Ctrl+Enter`：插入换行（通用；tmux 用户建议用 `Ctrl+J`）
- `Ctrl+D`：退出 CLI（标准 shell 行为，通常需按两次）

**审阅与上下文**

- `Ctrl+R`：审阅更改；按 `i` 添加后续说明
- `ArrowUp` / `ArrowDown`：滚动；`ArrowLeft` / `ArrowRight`：切换文件
- `@`：选择要纳入上下文的文件或文件夹
- `/compress`：压缩上下文以腾出窗口空间

**其他**

- **命令确认**：运行终端命令前，CLI 会提示确认（`y`）或拒绝（`n`）

### 提示编写建议

为获得更好效果，建议清晰表达意图。例如使用「不要编写任何代码」可在实施前进行任务规划。代理具备文件操作、搜索、运行 Shell 命令及访问网络等工具。

### Max 模式

在支持该功能的模型上，可使用 `/max-mode [on|off]` 开启或关闭 Max 模式。

---

## 4. 非交互模式与脚本

在脚本、CI 流水线或自动化场景下，使用 **print 模式**（`-p` / `--print`）将响应输出到控制台。

**基本用法**

```bash
# 指定提示与模型
agent -p "find and fix performance issues" --model "gpt-5.2"

# 包含 git 变更以供审查
agent -p "review these changes for security issues" --output-format text
```

**输出格式**

- `--output-format text`：Agent 最终回复的纯文本
- `--output-format json`：便于脚本解析的结构化输出
- `--output-format stream-json`：消息级进度跟踪；可搭配 `--stream-partial-output` 增量流式输出

在非交互模式下，Cursor 具有完全写入权限；使用 `--force` 可在无需确认的情况下直接修改文件（见 [Headless 与脚本示例](#9-headless-与脚本示例)）。

---

## 5. Cloud Agent

将对话交给 Cloud Agent，在你离开时继续运行。在**任意消息前加上 `&`** 即可发送到云端：

```bash
& refactor the auth module and add comprehensive tests
```

在网页或移动端访问 **cursor.com/agents** 继续处理 Cloud Agent 任务。

---

## 6. 会话管理

继续之前的对话以保持上下文：

```bash
# 列出以往对话
agent ls

# 恢复最近一次对话
agent resume

# 恢复指定对话
agent --resume="chat-id-here"
```

交互模式下也可使用 `/resume` 斜杠命令恢复最近对话。

---

## 7. 沙箱与 Shell 执行

### 沙箱控制

使用 `/sandbox` 配置命令执行环境：通过交互式菜单开启或关闭沙箱模式，并控制网络访问。设置在不同会话之间保留。

### Sudo 密码输入

当命令需要 sudo 时，Cursor 会显示安全、已遮罩的密码输入提示。密码通过安全的 IPC 通道直接传给 sudo，AI 模型不会接触。

### Shell 模式

在 CLI 中直接运行 shell 命令，无需退出当前对话。适用于快速、非交互式命令，具备安全检查，输出显示在对话中。

**执行与限制**

- 命令在你的登录 shell（`$SHELL`）中运行，沿用 CLI 的工作目录和环境
- 命令**独立执行**：若需在其他目录运行，请使用 `cd <dir> && ...`
- **超时**：命令在 30 秒后超时，不可配置
- 不支持长时间运行的进程、服务器或交互式提示

**权限**

执行前会根据你的权限和团队设置检查命令。管理员策略可能阻止某些命令；带重定向的命令无法仅通过内联白名单放行。

**使用建议**

- 适用：状态检查、快速构建、文件操作、环境查看
- 避免：长时间驻留的服务器、交互式应用、需要输入的命令

**Shell 模式常见问题**

| 问题 | 处理方式 |
|------|----------|
| 命令卡住 | 按 `Ctrl+C` 取消，并添加非交互式参数 |
| 权限请求 | 临时批准一次，或按 `Tab` 加入允许列表 |
| 输出被截断 | 按 `Ctrl+O` 展开 |
| 需在不同目录运行 | 使用 `cd <dir> && ...` |
| 退出 Shell 模式 | 输入为空时按 `Escape`，或空输入时按 `Backspace`/`Delete`，或 `Ctrl+C` 清空并退出 |

---

## 8. 规则与 MCP

### 规则

CLI 代理支持与编辑器相同的规则系统：

- 在 **`.cursor/rules`** 中创建规则，为代理提供上下文与指引
- 规则会根据配置自动加载
- CLI 还会读取项目根目录的 **AGENTS.md** 和 **CLAUDE.md**（若存在），与 `.cursor/rules` 一并作为规则应用

### MCP（Model Context Protocol）

CLI 支持 MCP 服务器，可将外部工具和数据源连接到 agent。CLI 与编辑器共用同一套配置（如 `mcp.json`），在编辑器中配置的 MCP 服务器在 CLI 中也可用。

**CLI 命令**

```bash
# 列出已配置的 MCP 服务器
agent mcp list

# 查看某服务器提供的工具
agent mcp list-tools <标识符>

# 登录 MCP 服务器（使用 mcp.json 中的配置）
agent mcp login <identifier>

# 启用 / 禁用 MCP 服务器
agent mcp enable <identifier>
agent mcp disable <identifier>
```

交互模式下可使用 `/mcp list`、`/mcp enable <name>`、`/mcp disable <name>`。在所有 `/mcp` 命令中都支持带空格的 MCP 名称。

**使用方式**

完成 MCP 配置后，agent 会在与请求相关时自动发现并使用可用工具。配置优先级与编辑器一致：项目 → 全局 → 嵌套级。

```bash
agent mcp list
agent mcp list-tools playwright
agent -p "导航到 google.com 并截取搜索页面的屏幕截图"
```

---

## 9. Headless 与脚本示例

在脚本和自动化工作流中使用 **print 模式**（`-p` / `--print`）进行代码分析、生成和重构。

### 在脚本中修改文件

使用 `--force` 允许代理在无需确认的情况下直接修改文件：

```bash
# 启用文件修改
agent -p --force "将此代码重构为现代 ES6+ 语法"

# 不使用时仅提议而不应用
agent -p "为此文件添加 JSDoc 注释"

# 批量处理
find src/ -name "*.js" | while read file; do
  agent -p --force "为 $file 添加完整 JSDoc 注释"
done
```

### 设置与 API Key

```bash
# 安装（见 安装详解）
curl https://cursor.com/install -fsS | bash   # macOS, Linux, WSL
irm 'https://cursor.com/install?win32=true' | iex   # Windows PowerShell

# 为脚本设置 API Key
export CURSOR_API_KEY=your_api_key_here
agent -p "Analyze this code"
```

### 示例：代码库搜索

```bash
#!/bin/bash
agent -p "What does this codebase do?"
```

### 示例：自动化代码审查

```bash
#!/bin/bash
echo "开始代码审查..."
agent -p --force --output-format text \
  "审查最近的代码更改并提供以下反馈：
  - 代码质量和可读性
  - 潜在的 bug 或问题
  - 安全性考虑
  - 最佳实践合规性
  提供具体的改进建议并写入 review.txt"
if [ $? -eq 0 ]; then
  echo "✅ 代码审查已完成"
else
  echo "❌ 代码审查失败"
  exit 1
fi
```

### 示例：实时进度（stream-json）

使用 `--output-format stream-json` 和 `--stream-partial-output` 进行消息级进度跟踪。每行输出为 JSON，可解析 `type`（如 `system`、`assistant`、`tool_call`、`result`）、`subtype`（如 `init`、`started`、`completed`）等字段，实现实时进度显示、工具调用统计和耗时统计。

---

## 10. 处理图像与媒体

在提示中**包含文件路径**即可让 Agent 读取图像、媒体或其他二进制数据。Agent 通过工具调用自动读取这些文件。

**示例**

```bash
# 分析单张图像
agent -p "Analyze this image and describe what you see: ./screenshot.png"

# 多文件对比
agent -p "Compare these two images and identify differences: ./before.png ./after.png"

# 结合代码与设计稿
agent -p "查看 src/app.ts 中的代码和 designs/homepage.png 中的设计稿，提出改进建议以匹配设计。"
```

**说明**

- 可使用相对路径或绝对路径
- Agent 通过工具调用读取文件，请确保文件存在且从当前工作目录可访问

**批量处理示例**

```bash
for image in images/*.png; do
  echo "正在处理 $image..."
  agent -p --output-format text "描述图像内容: $image" > "${image%.png}.description.txt"
done
```

---

## 11. 常见问题与疑难解答

**`cd` 会在不同次运行之间保留吗？**  
不会。每条命令独立执行，需在不同目录运行时使用 `cd <dir> && ...`。

**可以更改 Shell 命令超时时间吗？**  
不可以。命令限时 30 秒，且不可配置。

**在哪里配置权限？**  
权限由 CLI 和团队配置管理；可通过决策横幅将命令加入允许列表。

**如何退出 Shell 模式？**  
输入为空时按 `Escape`，或在空输入时按 `Backspace`/`Delete`，或按 `Ctrl+C` 清空并退出。

**终端与多行输入**  
`Shift+Enter` 在 iTerm2、Ghostty、Kitty、Warp 和 Zed 中有效。tmux 用户请改用 `Ctrl+J`。更多配置与故障排查请参见 Terminal Setup 文档。
