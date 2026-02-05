# Cursor CLI 使用指南

## 概述

Cursor CLI 是一个强大的命令行工具，让你可以直接在终端与 AI 代理交互，用于编写、审阅和修改代码。它支持两种使用方式：

- **交互式终端界面**：适合日常开发，可以与 AI 对话、审阅变更
- **非交互模式**：适合脚本、CI 流水线和自动化场景

---

## 快速入门

### 安装命令

**macOS、Linux、WSL：**
```bash
curl https://cursor.com/install -fsS | bash
```

**Windows PowerShell：**
```powershell
irm 'https://cursor.com/install?win32=true' | iex
```

### 验证安装

```bash
agent --version
```

### 启动交互式会话

```bash
# 直接启动
agent

# 带初始提示启动
agent "重构认证模块以使用 JWT 令牌"
```

---

## 安装详解

### macOS、Linux 和 Windows（WSL）

```bash
curl https://cursor.com/install -fsS | bash
```

### Windows（原生）

使用 PowerShell：

```powershell
irm 'https://cursor.com/install?win32=true' | iex
```

### 安装后配置

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

Cursor CLI 默认会自动更新。手动更新命令：

```bash
agent update
# 或
agent upgrade
```

---

## 核心功能

### 1. 工作模式

Cursor CLI 支持三种工作模式，可通过斜杠命令、快捷键或 `--mode` 参数切换：

| 模式 | 描述 | 切换方式 |
|------|------|---------|
| **Agent** | 完整访问所有工具，处理复杂编码任务 | 默认模式 |
| **Plan** | 在编码前通过澄清问题设计实现方案 | `Shift+Tab` / `/plan` / `--mode=plan` |
| **Ask** | 只读探索，不修改代码 | `/ask` / `--mode=ask` |

#### Plan 模式

用于在编写代码前规划方案，Agent 会提出澄清问题来完善计划。

```bash
# 启动时使用 Plan 模式
agent --mode=plan

# 在会话中切换
/plan
```

#### Ask 模式

用于探索代码库而不做修改，Agent 会搜索并提供答案。

```bash
# 启动时使用 Ask 模式
agent --mode=ask

# 在会话中切换
/ask
```

### 2. 交互式操作

#### 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `↑` (ArrowUp) | 查看上一条消息 |
| `Shift+Tab` | 在模式间切换 (Agent/Plan/Ask) |
| `Shift+Enter` | 插入换行（不提交） |
| `Ctrl+D` | 退出 CLI（需连按两次） |
| `Ctrl+J` 或 `⌘+Enter` | 插入换行（通用） |
| `Ctrl+R` | 审阅更改 |
| `i` | 在审阅时添加后续说明 |
| `↑/↓` | 滚动审阅内容 |
| `←/→` | 切换审阅文件 |

**注意：** `Shift+Enter` 在 iTerm2、Ghostty、Kitty、Warp 和 Zed 中有效。对于 Apple Terminal、Alacritty 或 VS Code，运行 `/setup-terminal` 自动配置 `Option+Enter`。

#### 上下文选择

使用 `@` 符号选择要纳入上下文的文件和文件夹：

```bash
# 示例
@src/auth.ts 重构这个文件的错误处理
@src/components/ 审阅所有组件的可访问性
```

运行 `/compress` 以压缩上下文，腾出窗口空间。

#### 审阅变更

使用 `Ctrl+R` 进入审阅模式：
- 查看建议的代码变更
- 按 `i` 添加修改意见
- 使用方向键浏览和切换文件

### 3. 非交互模式

适用于脚本、CI 流水线或自动化场景：

```bash
# 基本用法
agent -p "find and fix performance issues" --model "gpt-5.2"

# 审阅 git 变更
agent -p "review these changes for security issues" --output-format text

# 结构化输出（JSON）
agent -p "analyze code coverage" --output-format json
```

**输出格式选项：**
- `--output-format text`：纯文本输出
- `--output-format json`：结构化 JSON 输出（便于脚本解析）

### 4. Cloud Agent 接管

将对话转交给 Cloud Agent，让它在你离开时继续运行。在消息前加 `&` 即可：

```bash
# 发送任务到云端
& refactor the auth module and add comprehensive tests
```

然后在 Web 或移动端的 `cursor.com/agents` 上继续查看。

### 5. 会话历史

```bash
# 继续最近的对话
agent resume
# 或在会话中
/resume

# 从特定线程继续
agent --resume [thread id]

# 查看历史对话列表
agent ls
```

### 6. 命令确认

在运行终端命令前，CLI 会提示确认：
- 按 `y` 确认执行
- 按 `n` 拒绝执行

---

## 高级功能

### MCP（模型上下文协议）

Agent 支持 MCP 用于扩展功能和集成。CLI 会自动检测并使用你的 `mcp.json` 配置文件，启用与编辑器相同的 MCP 服务器和工具。

### 规则系统

CLI Agent 支持与编辑器相同的规则系统：

- 在 `.cursor/rules` 目录中创建规则
- 规则会自动加载并生效
- CLI 还会读取项目根目录的 `AGENTS.md` 和 `CLAUDE.md`（如存在）

规则用于：
- 为 Agent 提供项目上下文
- 为不同部分或文件类型自定义 Agent 行为
- 设置编码规范和最佳实践

---

## 提示编写最佳实践

1. **清晰表达意图**：明确说明你想要什么
2. **使用"不要编写任何代码"**：当你只想规划而不执行时
3. **指定范围**：使用 `@` 引用具体文件或目录
4. **分步骤**：复杂任务可以分解成多个步骤

**示例：**

```bash
# 好的提示
"重构 src/auth.ts 中的登录函数，使用 async/await 替代回调，并添加错误处理"

# 一般的提示
"改进认证代码"
```

---

## 常见使用场景

### 代码重构

```bash
agent "重构 @src/api/users.ts，提取重复的验证逻辑到单独的工具函数"
```

### 代码审阅

```bash
# 切换到 Ask 模式
/ask
# 然后提问
"审阅最近的提交，检查潜在的安全问题"
```

### 性能优化

```bash
agent -p "分析 @src/components/ 中的性能瓶颈并提出优化建议" --mode=plan
```

### CI 集成

```bash
# 在 CI 流水线中
agent -p "run tests and report failures" --output-format json > test-results.json
```

---

## 工具能力

Agent 配备了以下工具：

- **文件操作**：读取、编辑、创建、删除文件
- **搜索**：在代码库中搜索模式和符号
- **Shell 命令**：执行终端命令（需确认）
- **网络访问**：查询在线资源和文档

---

## 故障排除

### PATH 未找到

如果安装后提示 `agent` 命令未找到：

```bash
# 检查安装目录
ls ~/.local/bin/agent

# 手动添加到 PATH
export PATH="$HOME/.local/bin:$PATH"
```

### 快捷键不工作

如果 `Shift+Enter` 等快捷键不生效：

```bash
# 在 Agent 会话中运行
/setup-terminal
```

### 更新失败

```bash
# 手动下载最新版本
curl https://cursor.com/install -fsS | bash
```

---

## 总结

Cursor CLI 提供了在终端中使用 AI 辅助编码的完整体验：

✅ 交互式对话与代码审阅  
✅ 多种工作模式（Agent/Plan/Ask）  
✅ 非交互模式支持自动化  
✅ Cloud Agent 接管长任务  
✅ 完整的历史和上下文管理  
✅ MCP 和规则系统扩展  

立即开始使用：

```bash
curl https://cursor.com/install -fsS | bash
agent
```

---
斜杠命令
命令	说明
/plan	切换到 Plan 模式，在编码前规划实现思路
/ask	切换到 Ask 模式，用于只读探索
/model <model>	设置或列出模型
/auto-run [state]	切换自动运行（默认）或设置为 [on|off|status]
/new-chat	开启新聊天会话
/vim	切换 Vim 按键
/help [command]	显示帮助（/help [cmd]）
/feedback <message>	向团队提交反馈
/resume <chat>	按文件夹名称恢复先前聊天
/usage	查看 Cursor 连续使用记录和使用统计
/about	显示环境和命令行界面（CLI）配置详情
/copy-req-id	复制上一条请求 ID
/logout	退出 Cursor 账号
/quit	退出
/setup-terminal	自动配置终端按键绑定
/mcp list	浏览、启用并配置 MCP 服务器
/mcp enable <name>	启用 MCP 服务器
/mcp disable <name>	禁用 MCP 服务器
/rules	创建新规则或编辑现有规则
/commands	创建新命令或编辑现有命令
/compress	总结对话以释放上下文空间
*更多信息请访问：https://cursor.com*
使用 Headless CLI
在脚本和自动化工作流中使用 Cursor CLI，进行代码分析、生成和重构。

工作原理
将 print 模式（-p, --print）用于非交互式脚本和自动化。

在脚本中修改文件
在脚本中将 --print 与 --force 结合使用来修改文件：


# 在打印模式下启用文件修改
agent -p --force "将此代码重构为现代 ES6+ 语法"
# 不使用 --force 时,仅提议更改而不应用
agent -p "为此文件添加 JSDoc 注释"  # 不会修改文件
# 批量处理并实际修改文件
find src/ -name "*.js" | while read file; do
  agent -p --force "为 $file 添加完整 JSDoc 注释"
done
--force 标志允许代理在无需确认的情况下直接修改文件

设置
完整的设置说明请参阅 安装 和 身份验证。


# Install Cursor CLI (macOS, Linux, WSL)
curl https://cursor.com/install -fsS | bash
# 安装 Cursor 命令行界面(Windows PowerShell)
irm 'https://cursor.com/install?win32=true' | iex
# Set API key for scripts
export CURSOR_API_KEY=your_api_key_here
agent -p "Analyze this code"
示例脚本
可根据不同脚本需求选择不同的输出格式。详情参见 输出格式。

搜索代码库
默认情况下，--print 使用 text 格式，返回仅包含最终答案的简洁输出：


#!/bin/bash
# 简单的代码库问题 - 默认使用文本格式
agent -p "What does this codebase do?"
自动化代码审查
使用 --output-format json 进行结构化分析：


#!/bin/bash
# simple-code-review.sh - 基础代码审查脚本
echo "开始代码审查..."
# 审查最近的更改
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
实时进度跟踪
使用 --output-format stream-json 进行消息级别进度跟踪，或添加 --stream-partial-output 以增量流式传输变更内容：


#!/bin/bash
# stream-progress.sh - 实时跟踪进度
echo "🚀 开始流式处理..."
# 实时跟踪进度
accumulated_text=""
tool_count=0
start_time=$(date +%s)
agent -p --force --output-format stream-json --stream-partial-output \
  "分析项目结构并在 analysis.txt 中生成摘要报告" | \
  while IFS= read -r line; do
    
    type=$(echo "$line" | jq -r '.type // empty')
    subtype=$(echo "$line" | jq -r '.subtype // empty')
    
    case "$type" in
      "system")
        if [ "$subtype" = "init" ]; then
          model=$(echo "$line" | jq -r '.model // "unknown"')
          echo "🤖 使用模型: $model"
        fi
        ;;
        
      "assistant")
        # 累积增量文本以实现流畅的进度显示
        content=$(echo "$line" | jq -r '.message.content[0].text // empty')
        accumulated_text="$accumulated_text$content"
        
        # 显示实时进度(每次字符增量时更新)
        printf "\r📝 生成中: %d 字符" ${#accumulated_text}
        ;;
      "tool_call")
        if [ "$subtype" = "started" ]; then
          tool_count=$((tool_count + 1))
          # 提取工具信息
          if echo "$line" | jq -e '.tool_call.writeToolCall' > /dev/null 2>&1; then
            path=$(echo "$line" | jq -r '.tool_call.writeToolCall.args.path // "unknown"')
            echo -e "\n🔧 工具 #$tool_count: 创建 $path"
          elif echo "$line" | jq -e '.tool_call.readToolCall' > /dev/null 2>&1; then
            path=$(echo "$line" | jq -r '.tool_call.readToolCall.args.path // "unknown"')
            echo -e "\n📖 工具 #$tool_count: 读取 $path"
          fi
        elif [ "$subtype" = "completed" ]; then
          # 提取并显示工具结果
          if echo "$line" | jq -e '.tool_call.writeToolCall.result.success' > /dev/null 2>&1; then
            lines=$(echo "$line" | jq -r '.tool_call.writeToolCall.result.success.linesCreated // 0')
            size=$(echo "$line" | jq -r '.tool_call.writeToolCall.result.success.fileSize // 0')
            echo "   ✅ 已创建 $lines 行 ($size 字节)"
          elif echo "$line" | jq -e '.tool_call.readToolCall.result.success' > /dev/null 2>&1; then
            lines=$(echo "$line" | jq -r '.tool_call.readToolCall.result.success.totalLines // 0')
            echo "   ✅ 已读取 $lines 行"
          fi
        fi
        ;;
      "result")
        duration=$(echo "$line" | jq -r '.duration_ms // 0')
        end_time=$(date +%s)
        total_time=$((end_time - start_time))
        echo -e "\n\n🎯 完成,耗时 ${duration}ms (总计 ${total_time}s)"
        echo "📊 最终统计: $tool_count 个工具,生成 ${#accumulated_text} 字符"
        ;;
    esac
  done
处理图像
要向 agent 发送图像、媒体文件或其他二进制数据，请在提示词中包含文件路径。agent 可以通过工具调用读取任意文件，包括图像、视频等各种格式。

在提示中包含文件路径
只需在你的提示中引用文件路径。Agent 会在需要时自动读取这些文件：


# Analyze an image
agent -p "Analyze this image and describe what you see: ./screenshot.png"
# Process multiple media files
agent -p "Compare these two images and identify differences: ./before.png ./after.png"
# 结合文件路径与文本指令
agent -p "查看 src/app.ts 中的代码和 designs/homepage.png 中的设计稿，提出改进建议以匹配设计。"
工作原理
当你在提示中包含文件路径时：

Agent 会接收包含这些文件路径引用的提示
Agent 通过工具调用自动读取这些文件
图像会被自动处理
你可以使用相对路径或绝对路径来引用文件
示例：图像分析脚本

#!/bin/bash
# analyze-image.sh - 使用无头 CLI 分析图像
IMAGE_PATH="./screenshots/ui-mockup.png"
agent -p --output-format json \
  "分析此图像并提供详细说明: $IMAGE_PATH" | \
  jq -r '.result'
示例：批量处理媒体

#!/bin/bash
# process-media.sh - 批量处理媒体文件
for image in images/*.png; do
  echo "正在处理 $image..."
  agent -p --output-format text \
    "描述图像内容: $image" > "${image%.png}.description.txt"
done
文件路径可以是相对于当前工作目录的相对路径，也可以是绝对路径。 Agent 会通过工具调用来读取文件，因此请确保这些文件存在， 并且可以在你运行命令的位置访问到它们。
