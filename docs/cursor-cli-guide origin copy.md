功能
Cursor CLI
借助 Cursor CLI，你可以直接在终端与 AI 代理交互，以编写、审阅和修改代码。无论你偏好交互式终端界面，还是为脚本与 CI 流水线进行输出式自动化，CLI 都能在你的工作环境中提供强大的编码协助。

快速入门

# Install (macOS, Linux, WSL)
curl https://cursor.com/install -fsS | bash
# 安装 (Windows PowerShell)
irm 'https://cursor.com/install?win32=true' | iex
# Run interactive session
agent
交互模式
与代理开启对话会话，用于阐述你的目标、审阅建议的更改并批准命令：


# 启动交互式会话
agent
# 使用初始提示启动
agent "重构认证模块以使用 JWT 令牌"
模式
命令行界面支持与编辑器相同的模式。可通过斜杠命令、键盘快捷键或 --mode 参数在不同模式之间切换。

模式	描述	快捷键
Agent	完整访问所有工具，用于处理复杂编码任务	默认
Plan	在编写代码前，通过澄清性提问设计你的实现方案	
Shift+Tab
, /plan, --mode=plan
Ask	只读探索，不对代码做任何修改	/ask, --mode=ask
有关每种模式的详细信息，请参见 Agent 模式。

非交互模式
在脚本、CI 流水线或自动化等非交互场景下使用打印模式：


# Run with specific prompt and model
agent -p "find and fix performance issues" --model "gpt-5.2"
# 包含 git 变更以供审查
agent -p "review these changes for security issues" --output-format text
交由 Cloud Agent 接管
将你的对话推送到 Cloud Agent，让其在你离开时继续运行。在任意消息前加上 & 即可：


# 向 Cloud Agent 发送任务
& refactor the auth module and add comprehensive tests
在网页或移动端访问 cursor.com/agents，继续处理你的 Cloud Agent 任务。

会话
继续之前的对话，在多次交互中保持上下文：


# List all previous chats
agent ls
# Resume latest conversation
agent resume
# 恢复指定对话
agent --resume="chat-id-here"
沙箱控制
使用 /sandbox 配置命令执行设置。通过交互式菜单开启或关闭沙箱模式，并控制网络访问。设置将在不同会话之间保留。

Max 模式
在支持该功能的模型上，可使用 /max-mode [on|off] 开启或关闭 Max 模式。

Sudo 密码输入提示
无需离开命令行界面即可运行需要提升权限的命令。当命令需要 sudo 时，Cursor 会显示一个安全、已遮罩的密码输入提示。你的密码会通过安全的 IPC 通道直接传递给 sudo，AI 模型永远不会接触到它。

安装
安装
macOS、Linux 和 Windows（WSL）
使用一条命令安装 Cursor 命令行界面（CLI）：


curl https://cursor.com/install -fsS | bash
Windows（原生）
使用 PowerShell 在 Windows 上安装 Cursor 命令行界面（CLI）：


irm 'https://cursor.com/install?win32=true' | iex
验证
安装完成后，验证 Cursor 命令行界面（Cursor CLI）是否正常工作：


agent --version
安装后设置
将 ~/.local/bin 添加到 PATH：

适用于 bash：


echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
适用于 zsh：


echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
开始使用 Cursor Agent：


agent
更新
Cursor 命令行界面（CLI）默认会尝试自动更新，确保你始终使用最新版本。

手动将 Cursor 命令行界面（CLI）更新到最新版本：


agent update
# 或
agent upgrade
这两个命令都会将 Cursor Agent 更新到最新版本。


功能
在命令行界面中使用 Agent
模式
命令行界面支持与编辑器相同的模式。使用斜杠命令或 --mode 参数来切换模式。

Plan 模式
使用 Plan 模式在编写代码前规划你的方案。Agent 会提出澄清问题来完善你的计划。

按下 
Shift+Tab
 切换到 Plan 模式
使用 /plan 切换到 Plan 模式
使用 --mode=plan 标志启动
Ask 模式
使用 Ask 模式在不修改代码的情况下探索代码。Agent 会搜索你的代码库并提供答案，但不会编辑文件。

使用 /ask 切换到 Ask 模式
在启动命令中添加 --mode=ask 选项
提示编写
为获得更佳效果，建议清晰表达意图。例如，你可以使用提示“不要编写任何代码”，以确保代理不会编辑任何文件。这在实施前进行任务规划时通常很有帮助。

代理配备了文件操作、搜索、运行 Shell 命令以及访问网络的工具。

MCP
Agent 支持 MCP（Model Context Protocol，模型上下文协议），用于扩展功能和集成。CLI 会自动检测并遵循你的 mcp.json 配置文件，从而启用你在编辑器中配置的同一套 MCP 服务器和工具。

规则
CLI 代理支持与编辑器相同的rules system。你可以在 .cursor/rules 目录中创建规则，为代理提供上下文和指引。这些规则会根据其配置自动加载并生效，使你能够为项目的不同部分或特定文件类型自定义代理行为。

CLI 还会读取项目根目录中的 AGENTS.md 和 CLAUDE.md（如果存在），并与 .cursor/rules 一并作为规则应用。

使用代理
导航
按向上箭头（
ArrowUp
）可以查看上一条消息，并继续逐条翻阅。

输入快捷键
Shift+Tab
 — 在各模式之间切换（Agent、Plan、Ask）。
Shift+Enter
 — 插入换行而不提交，便于编写多行提示内容。
Ctrl+D
 — 退出命令行界面（CLI）。遵循标准 shell 行为，需要连续按两次才会退出。
Ctrl+J
 或 
+Enter
 — 在所有终端中通用的插入换行替代快捷键。
Shift+Enter
 在 iTerm2、Ghostty、Kitty、Warp 和 Zed 中有效。对于 tmux 用户，请改用 
Ctrl+J
。配置选项和故障排查请参见 Terminal Setup。

审阅
使用 
Ctrl+R
 审阅更改。按 
i
 添加后续说明。使用 
ArrowUp
/
ArrowDown
 滚动，使用 
ArrowLeft
/
ArrowRight
 切换文件。

选择上下文
使用 
@
 选择要纳入上下文的文件和文件夹。运行 /compress 以腾出上下文窗口空间。详见摘要。

Cloud Agent 接管
将你的对话转交给 Cloud Agent，让它在你离开时继续运行。在任意消息前加上 & 即可将其发送到云端，然后在 Web 或移动端的 cursor.com/agents 上继续进行。


# 向 Cloud Agent 发送任务
& refactor the auth module and add comprehensive tests
历史
使用 --resume [thread id] 从现有线程继续，以加载之前的上下文。

要继续最近的一次对话，使用 agent resume 或 /resume 斜杠命令。

你也可以运行 agent ls 查看以往对话的列表。

命令确认
在运行终端命令之前，命令行界面（CLI）会提示你确认（
y
）或拒绝（
n
）执行。

非交互模式
使用 -p 或 --print 以非交互模式运行 Agent。它会将响应输出到控制台。

在非交互模式下，你可以非交互地调用 Agent，便于将其集成到脚本、CI 流水线等场景。

可搭配 --output-format 控制输出格式。例如，使用 --output-format json 获取便于脚本解析的结构化输出，或使用 --output-format text 获取 Agent 最终回复的纯文本输出。

在非交互模式下，Cursor 具有完全写入权限。

功能
Shell 模式
Shell 模式可在 CLI 中直接运行 shell 命令，无需退出当前对话。适用于快速、非交互式命令，具备安全检查，输出将显示在对话中。

命令执行
命令会在你的登录 shell（$SHELL）中运行，并沿用 CLI 的工作目录和环境。可通过串联命令在其他目录中运行：


cd subdir && npm test
输出
为保证性能，大体量输出会自动截断，长时运行的进程会超时。

限制
命令将在 30 秒后超时
不支持长时间运行的进程、服务器或交互式提示
为获得最佳效果，请使用简短的非交互式命令
权限
在执行前，系统会根据你的权限和团队设置检查命令。有关详细配置，请参见权限。

管理员策略可能会阻止某些命令，且带有重定向的命令无法在内联白名单中放行。

使用指南
Shell 模式适用于状态检查、快速构建、文件操作和环境查看。

避免运行长时间驻留的服务器、交互式应用以及需要输入的命令。

每条命令都是独立执行的——在其他目录运行命令时，请使用 cd <dir> && ...。

疑难解答
命令卡住时，按 
Ctrl+C
 取消，并添加非交互式参数
出现权限请求时，可临时批准一次，或按 
Tab
 加入允许列表
输出被截断时，按 
Ctrl+O
 展开
需在不同目录运行时，由于更改不持久，请使用 cd <dir> && ...
Shell 模式会根据你的 $SHELL 变量支持 zsh 和 bash

常见问题

`cd` 会在不同次运行之间保留吗？
不会。每个命令都是独立执行的。使用 cd <dir> && ... 在不同目录中运行命令。


我可以更改超时时间吗？
不行。命令限时 30 秒，且不可配置。

在哪里配置权限？
权限由 CLI 和团队配置管理。使用决策横幅将命令加入允许列表。

如何退出 Shell 模式？
当输入为空时按 
Escape
，在空输入时按 
Backspace
/
Delete
，或按 
Ctrl+C
 清空并退出。

 功能
MCP
概览
Cursor 命令行界面（CLI）支持 Model Context Protocol（MCP） 服务器，可将外部工具和数据源连接到 agent。CLI 中的 MCP 与编辑器共用同一套配置——你配置的任何 MCP 服务器在二者中均可使用。

了解 MCP

第一次接触 MCP？阅读完整指南，了解配置、身份验证与 可用服务器

CLI 命令
使用 agent mcp 命令管理 MCP 服务器

列出已配置的服务器
查看所有已配置的 MCP 服务器及其当前状态：


agent mcp list
这会打开一个交互式菜单，你可以在其中一目了然地浏览、启用和配置 MCP 服务器。列表显示以下内容：

服务器名称与标识符
连接状态（已连接/未连接）
配置来源（项目或全局）
传输方式（stdio、HTTP、SSE）
你也可以在交互模式下使用斜杠命令 /mcp list 来访问相同的界面。

列出可用的工具
查看某个 MCP 服务器提供的工具：


agent mcp list-tools <标识符>
这将显示：

工具名称与描述
必填参数与可选参数
参数类型与约束
登录 MCP 服务器
使用在 mcp.json 中配置的 MCP 服务器进行身份验证：


agent mcp login <identifier>
命令行界面（CLI）使用精简的登录流程，并自动处理回调。登录完成后，agent 可立即访问已通过身份验证的 MCP。

启用 MCP 服务器
启用 MCP 服务器：


agent mcp enable <identifier>
你也可以在交互模式下使用 /mcp enable <name> 斜杠命令。

禁用 MCP 服务器
禁用 MCP 服务器：


agent mcp disable <identifier>
你也可以在交互模式下使用 /mcp disable <name> 斜杠命令。

在所有 /mcp 命令中都支持带空格的 MCP 服务器名称。

将 MCP 与 Agent 搭配使用
在完成 MCP 服务器配置后（设置说明见主 MCP 指南），agent 会在与你的请求相关时自动发现并使用可用工具。


# Check what MCP servers are available
agent mcp list
# See what tools a specific server provides
agent mcp list-tools playwright
# 使用 agent - 它会在有用时自动使用 MCP 工具
agent -p "导航到 google.com 并截取搜索页面的屏幕截图"
CLI 遵循与编辑器相同的配置优先级（项目 → 全局 → 嵌套级），并会自动从父目录中发现配置。

功能
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