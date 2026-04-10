// AI 工具手动安装指南
// 此文件作为 Skill 文档，用于辅助用户手动安装各种 AI CLI 工具

export type AiToolInfo = {
  id: string;
  name: string;
  description: string;
  installCommands: {
    macos?: string;
    linux?: string;
    windows?: string;
    npm?: string;
  };
  verifyCommand: string;
  docsUrl?: string;
};

export const AI_INSTALL_GUIDES: AiToolInfo[] = [
  {
    id: "cursor",
    name: "Cursor Chat",
    description: "Cursor 编辑器的 AI 聊天功能（非交互模式）",
    installCommands: {
      macos: "curl https://cursor.com/install -fsS | bash",
      linux: "curl https://cursor.com/install -fsS | bash",
      windows: "irm 'https://cursor.com/install?win32=true' | iex",
    },
    verifyCommand: "agent --version",
    docsUrl: "https://cursor.com/docs",
  },
  {
    id: "codex",
    name: "Codex",
    description: "OpenAI 官方 CLI 工具",
    installCommands: {
      npm: "npm i -g @openai/codex",
    },
    verifyCommand: "codex --version",
    docsUrl: "https://github.com/openai/codex",
  },
  {
    id: "claude",
    name: "Claude",
    description: "Anthropic Claude Code CLI",
    installCommands: {
      macos: "curl -fsSL https://claude.ai/install.sh | bash",
      linux: "curl -fsSL https://claude.ai/install.sh | bash",
      windows: "irm https://claude.ai/install.ps1 | iex",
    },
    verifyCommand: "claude --version",
    docsUrl: "https://docs.anthropic.com/en/docs/agents-and-tools/claude-code",
  },
  {
    id: "opencode",
    name: "OpenCode",
    description: "开源 AI 代码助手",
    installCommands: {
      macos: "curl -fsSL https://opencode.ai/install | bash",
      linux: "curl -fsSL https://opencode.ai/install | bash",
      npm: "npm install -g opencode-ai",
    },
    verifyCommand: "opencode --version",
    docsUrl: "https://opencode.ai",
  },
  {
    id: "kimi",
    name: "Kimi",
    description: "Kimi Code CLI",
    installCommands: {
      macos: "curl -LsSf https://code.kimi.com/install.sh | bash",
      linux: "curl -LsSf https://code.kimi.com/install.sh | bash",
      windows: "Invoke-RestMethod https://code.kimi.com/install.ps1 | Invoke-Expression",
    },
    verifyCommand: "kimi --version",
    docsUrl: "https://kimi.com",
  },
  {
    id: "cursor-cli",
    name: "Cursor CLI",
    description: "Cursor 命令行工具（agent/plan/ask 模式）",
    installCommands: {
      macos: "curl https://cursor.com/install -fsS | bash",
      linux: "curl https://cursor.com/install -fsS | bash",
      windows: "irm 'https://cursor.com/install?win32=true' | iex",
    },
    verifyCommand: "cursor --version",
    docsUrl: "https://cursor.com/docs",
  },
];

// 获取平台特定的安装命令
export function getInstallCommand(tool: AiToolInfo, platform: "macos" | "linux" | "windows"): string | undefined {
  if (platform === "windows" && tool.installCommands.windows) {
    return tool.installCommands.windows;
  }
  if (platform === "macos" && tool.installCommands.macos) {
    return tool.installCommands.macos;
  }
  if (platform === "linux" && tool.installCommands.linux) {
    return tool.installCommands.linux;
  }
  // 回退到 npm
  return tool.installCommands.npm;
}

// 检测当前平台
export function detectPlatform(): "macos" | "linux" | "windows" {
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes("win")) return "windows";
  if (userAgent.includes("mac")) return "macos";
  return "linux";
}

// 新平台 CLI 通用安装说明
// 用于未列出的新 AI CLI 工具，提供通用安装方式参考
export type GenericInstallMethod = {
  name: string;
  command: string;
  description?: string;
  color?: string;
};

export const GENERIC_CLI_INSTALL_METHODS: GenericInstallMethod[] = [
  {
    name: "npm",
    command: "npm install -g <cli-name>",
    description: "Node.js 包管理器全局安装",
    color: "#8b5cf6",
  },
  {
    name: "npx",
    command: "npx <cli-name>",
    description: "无需安装直接运行",
    color: "#8b5cf6",
  },
  {
    name: "Homebrew",
    command: "brew install <cli-name>",
    description: "macOS 包管理器",
    color: "#f59e0b",
  },
  {
    name: "curl",
    command: "curl -fsSL <install-url> | bash",
    description: "通过脚本安装（常见方式）",
    color: "#3b82f6",
  },
  {
    name: "pip",
    command: "pip install <cli-name>",
    description: "Python 包管理器安装",
    color: "#10b981",
  },
];

export const GENERIC_CLI_NOTE =
  '将 <cli-name> 替换为实际的 CLI 工具名称。建议先查看官方文档获取准确的安装命令。';

// Tailscale 安装与配置信息
export type TailscaleInstallInfo = {
  officialUrl: string;
  derpDocPath: string;
  listenConfig: {
    description: string;
    defaultHost: string;
    tailscaleHost: string;
    note: string;
  };
};

export const TAILSCALE_INFO: TailscaleInstallInfo = {
  officialUrl: "https://tailscale.com/download",
  derpDocPath: "/docs/tailscale-derp.md",
  listenConfig: {
    description: "本项目需要监听 0.0.0.0 才能通过 Tailscale 内网 IP 访问",
    defaultHost: "localhost",
    tailscaleHost: "0.0.0.0",
    note: "修改后重启服务生效。访问地址：http://<tailscale-ip>:<port>",
  },
};

// 自建 DERP 简要说明
export const DERP_QUICK_GUIDE = `
## 自建 DERP 服务器（简要步骤）

⚠️ **以下操作在服务器上执行**

### 1. 安装 derper
\`\`\`bash
# 在服务器上从源码编译
git clone https://github.com/tailscale/tailscale.git
cd tailscale/cmd/derper
go build
\`\`\`

### 2. 启动 derper（在服务器上执行，推荐直接监听 443）
\`\`\`bash
sudo ./derper -hostname derp.yourdomain.com -certdir=/path/to/cert -stun-port 3478
\`\`\`

### 3. Tailscale ACL 配置
在 Tailscale 后台 → Access controls 中添加：
\`\`\`json
"derpMap": {
  "OmitDefaultRegions": true,
  "Regions": {
    "900": {
      "RegionID": 900,
      "RegionCode": "custom",
      "RegionName": "Custom",
      "Nodes": [{
        "Name": "1",
        "RegionID": 900,
        "HostName": "derp.yourdomain.com",
        "IPv4": "your-server-ip"
      }]
    }
  }
}
\`\`\`

### 4. 验证
\`\`\`bash
tailscale netcheck  # 查看 DERP 延迟
tailscale status    # 查看连接方式
\`\`\`

详细文档请参考项目 docs/tailscale-derp.md
`;
