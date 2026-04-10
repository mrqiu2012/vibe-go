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
