import { useState, useEffect, useCallback } from "react";
import { apiUrl } from "../api";

type ToolStatus = { ok: true; path: string | null; version: string | null; error: null } | { ok: false; path: string | null; version: null; error: string | null };

type InstallHintsByPlatform = { darwin: string; win32: string; linux: string };

type SetupCheck = {
  ok: boolean;
  platform?: string;
  roots?: string[];
  tools?: { agent: ToolStatus; codex: ToolStatus; claude: ToolStatus; opencode: ToolStatus; kimi: ToolStatus; cursor: ToolStatus; rg: ToolStatus };
  installHints?: { agent: InstallHintsByPlatform; rg: InstallHintsByPlatform; codex: InstallHintsByPlatform; claude: InstallHintsByPlatform; opencode: InstallHintsByPlatform; kimi: InstallHintsByPlatform };
};

const STEPS = [
  { id: 1, title: "安装 Cursor / Kimi / Codex / Claude / OpenCode（手动）" },
] as const;

export function SetupPage() {
  const [currentStep] = useState<1>(1);
  const [setupData, setSetupData] = useState<SetupCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  const fetchCheck = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(apiUrl("/api/setup/check"));
      const data = await r.json();
      if (data?.ok) {
        setSetupData(data);
      } else {
        setError(data?.error ?? `HTTP ${r.status}`);
        setSetupData(null);
      }
    } catch (e: any) {
      setError(e?.message ?? "无法连接后端，请确认服务已启动（如 pnpm dev）");
      setSetupData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCheck();
  }, [fetchCheck]);

  if (loading && !setupData) {
    return (
      <div className="setupPage">
        <div className="setupLoading">
          <p>正在检测环境…</p>
        </div>
      </div>
    );
  }

  const tools = setupData?.tools;
  const hints = setupData?.installHints;

  return (
    <div className="setupPage">
      <header className="setupHeader">
        <h1 className="setupTitle">配置与安装</h1>
        <div className="setupStepper">
          {STEPS.map((s) => (
            <span
              key={s.id}
              className={"setupStepperDot" + (currentStep === s.id ? " setupStepperDotActive" : "") + (currentStep > s.id ? " setupStepperDotDone" : "")}
              title={s.title}
            >
              {s.id}
            </span>
          ))}
          <span className="setupStepperLabel">{STEPS[currentStep - 1].title}</span>
        </div>
      </header>

      <main className="setupMain">
        {error && (
          <section className="setupSection setupError">
            <p>无法连接后端：{error}</p>
            <button type="button" className="setupSecondaryBtn" onClick={fetchCheck}>
              重试
            </button>
          </section>
        )}

        {setupData && !error && (
          <section className="setupSection setupStepBody">
            <h2>工具安装（可选）</h2>
            <p>以下工具用于 Cursor Chat、Kimi、Codex/Claude/OpenCode 终端等功能。请根据当前检测状态，在终端中按下方说明手动安装。未安装也可跳过，但相关功能将无法使用。</p>
            <div className="setupToolGrid">
              {tools?.agent !== undefined && (
                <div className="setupToolCard">
                  <div className="setupToolRow">
                    <span className="setupToolName">Cursor CLI（agent）</span>
                    {tools.agent.ok ? (
                      <span className="setupToolStatus setupStatusOk">✓ 已安装{tools.agent.version ? ` ${tools.agent.version}` : null}</span>
                    ) : (
                      <span className="setupToolStatus setupStatusFail">✗ 未安装</span>
                    )}
                  </div>
                  {!tools.agent.ok && hints?.agent && (
                    <div className="setupToolStatusBody">
                      <div className="setupManualBlock">
                        <span className="setupManualLabel">安装方法</span>
                        <ul className="setupPlatformHints">
                          <li><span className="setupPlatformLabel">macOS</span><code className="setupToolHint">{hints.agent.darwin}</code></li>
                          <li><span className="setupPlatformLabel">Windows</span><code className="setupToolHint">{hints.agent.win32}</code></li>
                          <li><span className="setupPlatformLabel">Linux</span><code className="setupToolHint">{hints.agent.linux}</code></li>
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {tools?.kimi !== undefined && (
                <div className="setupToolCard">
                  <div className="setupToolRow">
                    <span className="setupToolName">Kimi</span>
                    {tools.kimi.ok ? (
                      <span className="setupToolStatus setupStatusOk">✓ 已安装{tools.kimi.version ? ` ${tools.kimi.version}` : null}</span>
                    ) : (
                      <span className="setupToolStatus setupStatusFail">✗ 未安装</span>
                    )}
                  </div>
                  {!tools.kimi.ok && hints?.kimi && (
                    <div className="setupToolStatusBody">
                      <div className="setupManualBlock">
                        <span className="setupManualLabel">安装方法</span>
                        <ul className="setupPlatformHints">
                          <li><span className="setupPlatformLabel">macOS</span><code className="setupToolHint">{hints.kimi.darwin}</code></li>
                          <li><span className="setupPlatformLabel">Windows</span><code className="setupToolHint">{hints.kimi.win32}</code></li>
                          <li><span className="setupPlatformLabel">Linux</span><code className="setupToolHint">{hints.kimi.linux}</code></li>
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {tools?.codex !== undefined && (
                <div className="setupToolCard">
                  <div className="setupToolRow">
                    <span className="setupToolName">Codex</span>
                    {tools.codex.ok ? (
                      <span className="setupToolStatus setupStatusOk">✓ 已安装{tools.codex.version ? ` ${tools.codex.version}` : null}</span>
                    ) : (
                      <span className="setupToolStatus setupStatusFail">✗ 未安装</span>
                    )}
                  </div>
                  {!tools.codex.ok && hints?.codex && (
                    <div className="setupToolStatusBody">
                      <div className="setupManualBlock">
                        <span className="setupManualLabel">安装方法</span>
                        <ul className="setupPlatformHints">
                          <li><span className="setupPlatformLabel">macOS</span><code className="setupToolHint">{hints.codex.darwin}</code></li>
                          <li><span className="setupPlatformLabel">Windows</span><code className="setupToolHint">{hints.codex.win32}</code></li>
                          <li><span className="setupPlatformLabel">Linux</span><code className="setupToolHint">{hints.codex.linux}</code></li>
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {tools?.claude !== undefined && (
                <div className="setupToolCard">
                  <div className="setupToolRow">
                    <span className="setupToolName">Claude Code</span>
                    {tools.claude.ok ? (
                      <span className="setupToolStatus setupStatusOk">✓ 已安装{tools.claude.version ? ` ${tools.claude.version}` : null}</span>
                    ) : (
                      <span className="setupToolStatus setupStatusFail">✗ 未安装</span>
                    )}
                  </div>
                  {!tools.claude.ok && hints?.claude && (
                    <div className="setupToolStatusBody">
                      <div className="setupManualBlock">
                        <span className="setupManualLabel">安装方法</span>
                        <ul className="setupPlatformHints">
                          <li><span className="setupPlatformLabel">macOS</span><code className="setupToolHint">{hints.claude.darwin}</code></li>
                          <li><span className="setupPlatformLabel">Windows</span><code className="setupToolHint">{hints.claude.win32}</code></li>
                          <li><span className="setupPlatformLabel">Linux</span><code className="setupToolHint">{hints.claude.linux}</code></li>
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {tools?.opencode !== undefined && (
                <div className="setupToolCard">
                  <div className="setupToolRow">
                    <span className="setupToolName">OpenCode</span>
                    {tools.opencode.ok ? (
                      <span className="setupToolStatus setupStatusOk">✓ 已安装{tools.opencode.version ? ` ${tools.opencode.version}` : null}</span>
                    ) : (
                      <span className="setupToolStatus setupStatusFail">✗ 未安装</span>
                    )}
                  </div>
                  {!tools.opencode.ok && hints?.opencode && (
                    <div className="setupToolStatusBody">
                      <div className="setupManualBlock">
                        <span className="setupManualLabel">安装方法</span>
                        <ul className="setupPlatformHints">
                          <li><span className="setupPlatformLabel">macOS</span><code className="setupToolHint">{hints.opencode.darwin}</code></li>
                          <li><span className="setupPlatformLabel">Windows</span><code className="setupToolHint">{hints.opencode.win32}</code></li>
                          <li><span className="setupPlatformLabel">Linux</span><code className="setupToolHint">{hints.opencode.linux}</code></li>
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {tools?.rg !== undefined && (
                <div className="setupToolCard">
                  <div className="setupToolRow">
                    <span className="setupToolName">Ripgrep（rg）</span>
                    {tools.rg.ok ? (
                      <span className="setupToolStatus setupStatusOk">✓ 已安装{tools.rg.version ? ` ${tools.rg.version}` : null}</span>
                    ) : (
                      <span className="setupToolStatus setupStatusFail">✗ 未安装</span>
                    )}
                  </div>
                  {!tools.rg.ok && hints?.rg && (
                    <div className="setupToolStatusBody">
                      <div className="setupManualBlock">
                        <span className="setupManualLabel">安装方法</span>
                        <ul className="setupPlatformHints">
                          <li><span className="setupPlatformLabel">macOS</span><code className="setupToolHint">{hints.rg.darwin}</code></li>
                          <li><span className="setupPlatformLabel">Windows</span><code className="setupToolHint">{hints.rg.win32}</code></li>
                          <li><span className="setupPlatformLabel">Linux</span><code className="setupToolHint">{hints.rg.linux}</code></li>
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="setupRow setupSkipRow">
              <button type="button" className="setupPrimaryBtn" onClick={() => { window.location.hash = "#/"; }}>
                返回主页
              </button>
              <span className="setupSkipHint">这些工具未安装时，仅对应功能不可用，不影响数据库自动初始化。</span>
            </div>

            {/* 底部：上一步 / 下一步 */}
            <div className="setupStepActions">
              <div style={{ flex: 1 }} />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
