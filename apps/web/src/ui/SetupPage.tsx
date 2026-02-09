import { useState, useEffect, useCallback } from "react";
import { apiUrl } from "../api";

type ToolStatus = { ok: true; path: string | null; version: string | null; error: null } | { ok: false; path: string | null; version: null; error: string | null };

type InstallHintsByPlatform = { darwin: string; win32: string; linux: string };

type SetupCheck = {
  ok: boolean;
  platform?: string;
  roots?: string[];
  tools?: { agent: ToolStatus; codex: ToolStatus; cursor: ToolStatus; rg: ToolStatus };
  installHints?: { agent: InstallHintsByPlatform; rg: InstallHintsByPlatform; codex: InstallHintsByPlatform };
};

const STEPS = [
  { id: 1, title: "选择根目录" },
  { id: 2, title: "安装 Cursor / Codex（手动）" },
  { id: 3, title: "初始化数据库" },
] as const;

export function SetupPage() {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [setupData, setSetupData] = useState<SetupCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [rootsInput, setRootsInput] = useState("");
  const [addRootLoading, setAddRootLoading] = useState(false);
  const [installResult, setInstallResult] = useState<{ tool: string; ok: boolean; msg?: string } | null>(null);
  const [step2Skipped, setStep2Skipped] = useState(false);
  const [dbInitLoading, setDbInitLoading] = useState(false);
  const [dbInitDone, setDbInitDone] = useState(false);
  const [completeLoading, setCompleteLoading] = useState(false);

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

  const roots = setupData?.roots ?? [];
  const step1Done = roots.length > 0;

  const handleAddRoots = async () => {
    const lines = rootsInput
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    setAddRootLoading(true);
    setInstallResult(null);
    const added: string[] = [];
    const failed: string[] = [];
    try {
      for (let i = 0; i < lines.length; i++) {
        const path = lines[i];
        const setActive = i === lines.length - 1;
        try {
          const r = await fetch(apiUrl("/api/setup/add-root"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ root: path, setActive }),
          });
          const data = await r.json();
          if (data?.ok) {
            setSetupData((prev) => (prev ? { ...prev, roots: data.roots } : null));
            added.push(path);
          } else {
            failed.push(`${path}: ${data?.error ?? "添加失败"}`);
          }
        } catch (e: any) {
          failed.push(`${path}: ${e?.message ?? "请求失败"}`);
        }
      }
      if (failed.length === 0) {
        setRootsInput("");
        setInstallResult({ tool: "root", ok: true, msg: `已添加 ${added.length} 个根目录` });
      } else if (added.length > 0) {
        setInstallResult({
          tool: "root",
          ok: false,
          msg: `已添加 ${added.length} 个，失败 ${failed.length} 个：${failed.join("；")}`,
        });
      } else {
        setInstallResult({ tool: "root", ok: false, msg: failed.join("；") });
      }
    } finally {
      setAddRootLoading(false);
    }
  };

  const handleInitDb = async () => {
    setDbInitLoading(true);
    setInstallResult(null);
    try {
      const r = await fetch(apiUrl("/api/setup/ensure-db"));
      const data = await r.json();
      if (data?.ok) {
        setDbInitDone(true);
      } else {
        setInstallResult({ tool: "db", ok: false, msg: data?.error ?? "初始化失败" });
      }
    } catch (e: any) {
      setInstallResult({ tool: "db", ok: false, msg: e?.message ?? "请求失败" });
    } finally {
      setDbInitLoading(false);
    }
  };

  const handleComplete = async () => {
    setCompleteLoading(true);
    try {
      const r = await fetch(apiUrl("/api/setup/complete"), { method: "POST", headers: { "Content-Type": "application/json" } });
      const data = await r.json();
      if (data?.ok) {
        window.location.hash = "#/";
      } else {
        setInstallResult({ tool: "complete", ok: false, msg: data?.error ?? "完成失败" });
      }
    } catch (e: any) {
      setInstallResult({ tool: "complete", ok: false, msg: e?.message ?? "请求失败" });
    } finally {
      setCompleteLoading(false);
    }
  };

  const goNext = () => {
    if (currentStep === 1 && step1Done) setCurrentStep(2);
    if (currentStep === 2) setCurrentStep(3);
  };

  const goPrev = () => {
    if (currentStep === 2) setCurrentStep(1);
    if (currentStep === 3) setCurrentStep(2);
  };

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
  const platform = setupData?.platform ?? "";
  const isMac = platform === "darwin";
  const isWin = platform === "win32";

  const rootsHint =
    isMac
      ? "每行一个绝对路径，如 /Users/你的用户名/项目 或 /Users/你的用户名/Desktop"
      : isWin
        ? "每行一个绝对路径，如 C:\\Users\\你的用户名\\项目 或 D:\\workspace（反斜杠写一条或两条均可）"
        : "每行一个绝对路径，如 /home/你的用户名/project";
  const rootsPlaceholder =
    isMac
      ? "/Users/你的用户名/project\n/Users/你的用户名/Desktop"
      : isWin
        ? "C:\\Users\\你的用户名\\project\nD:\\workspace"
        : "/home/你的用户名/project";

  const canGoNextStep1 = step1Done;
  const canGoNextStep2 = true;
  const showPrev = currentStep > 1;

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
            {/* 第一步：选择根目录 */}
            {currentStep === 1 && (
              <>
                <h2>第一步：选择根目录</h2>
                <p>添加允许在 VibeGo 中访问的工作区目录（至少一个）。每行一个路径，可一次添加多个。</p>
                {roots.length > 0 && (
                  <ul className="setupRootList">
                    {roots.map((r) => (
                      <li key={r} className="setupRootItem">
                        <code>{r}</code>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="setupHint">{rootsHint}</p>
                <textarea
                  className="setupTextarea"
                  placeholder={rootsPlaceholder}
                  value={rootsInput}
                  onChange={(e) => setRootsInput(e.target.value)}
                  disabled={addRootLoading}
                  rows={4}
                />
                <div className="setupRow">
                  <button
                    type="button"
                    className="setupSecondaryBtn"
                    onClick={handleAddRoots}
                    disabled={!rootsInput.trim() || addRootLoading}
                  >
                    {addRootLoading ? "添加中…" : "添加"}
                  </button>
                </div>
                {installResult?.tool === "root" && (
                  <p className={installResult.ok ? "setupStatus setupStatusOk" : "setupStatus setupStatusFail"}>
                    {installResult.ok ? "✓ " : "✗ "}{installResult.msg}
                  </p>
                )}
              </>
            )}

            {/* 第二步：安装 Cursor / Codex（仅手动安装说明） */}
            {currentStep === 2 && (
              <>
                <h2>第二步：安装 Cursor / Codex（手动安装）</h2>
                <p>以下工具用于 Cursor Chat、Codex 终端等功能。请根据当前检测状态，在终端中按下方说明手动安装。未安装也可跳过，但相关功能将无法使用。</p>
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
                  <button type="button" className="setupSkipBtn" onClick={() => setStep2Skipped(true)}>
                    跳过此步
                  </button>
                  <span className="setupSkipHint">跳过则无法正常使用 Cursor Chat、Codex 终端等功能。</span>
                </div>
              </>
            )}

            {/* 第三步：初始化数据库 */}
            {currentStep === 3 && (
              <>
                <h2>第三步：初始化数据库</h2>
                <p>初始化本地数据库，用于保存聊天记录、工作区等。</p>
                {!dbInitDone ? (
                  <>
                    <div className="setupRow">
                      <button
                        type="button"
                        className="setupPrimaryBtn"
                        onClick={handleInitDb}
                        disabled={dbInitLoading}
                      >
                        {dbInitLoading ? "初始化中…" : "初始化数据库"}
                      </button>
                     
                    </div>
                    {installResult?.tool === "db" && !installResult?.ok && (
                      <p className="setupStatus setupStatusFail">✗ {installResult.msg}</p>
                    )}
                    {installResult?.tool === "complete" && !installResult?.ok && (
                      <p className="setupStatus setupStatusFail">✗ {installResult.msg}</p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="setupStatus setupStatusOk">✓ 数据库已初始化</p>
                    <button
                      type="button"
                      className="setupPrimaryBtn"
                      onClick={handleComplete}
                      disabled={completeLoading}
                    >
                      {completeLoading ? "处理中…" : "完成安装，进入 VibeGo"}
                    </button>
                    {installResult?.tool === "complete" && !installResult?.ok && (
                      <p className="setupStatus setupStatusFail">✗ {installResult.msg}</p>
                    )}
                  </>
                )}
              </>
            )}

            {/* 底部：上一步 / 下一步 */}
            <div className="setupStepActions">
              {showPrev && (
                <button type="button" className="setupSecondaryBtn" onClick={goPrev}>
                  上一步
                </button>
              )}
              <div style={{ flex: 1 }} />
              {currentStep === 1 && (
                <button
                  type="button"
                  className="setupPrimaryBtn"
                  onClick={goNext}
                  disabled={!canGoNextStep1}
                  title={!canGoNextStep1 ? "请先添加至少一个根目录" : undefined}
                >
                  下一步
                </button>
              )}
              {currentStep === 2 && (
                <button type="button" className="setupPrimaryBtn" onClick={goNext}>
                  下一步
                </button>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
