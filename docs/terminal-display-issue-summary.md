# Codex / Restricted 模式终端不显示 - 问题总结（用于提问）

## 现象

- **终端面板**有三种模式：**Cursor**（聊天）、**Codex**（PTY）、**Restricted**（受限 Shell）。
- 切换布局：Cursor 时显示聊天面板，Codex/Restricted 时显示 **xterm.js** 终端。
- **问题**：在 Codex 或 Restricted 模式下，**终端区域不显示**（空白或高度为 0）。
- 部分情况：**第一次**从 Cursor 切到 Codex 能显示，**再次**从 Cursor 切回 Codex/Restricted 后又不显示。

## 技术栈

- 前端：React + Vite，**xterm.js 5.3** + **xterm-addon-fit**
- 终端容器：一个 `div`，在 Cursor 时 `display: none`，在 Codex/Restricted 时 `display: flex; flex: 1`
- 后端：WebSocket，按模式开 PTY（Codex）或受限 Shell（Restricted）

## 已做过的尝试（均未彻底解决）

1. **延后创建终端**：只在 Codex/Restricted/cursor-cli 下才 `new Terminal()` 并 `term.open(el)`，避免在 Cursor 下在隐藏容器里初始化 → 第一次切换可显示，再次切换仍不显示。
2. **多次延迟 fit**：切换回 Codex/Restricted 后用 rAF + 150/400/700/1200/1800 ms 多次调用 `FitAddon.fit()`。
3. **强制 reflow**：fit 前读 `el.offsetHeight`，再调用 `safeFitTerm()`。
4. **放宽 safeFitTerm**：容器宽高为 0 时也 try/catch 调用一次 `fit.fit()`；无 renderer dimensions 时也尝试 fit。
5. **布局**：用 `termAreaWrap` 包住聊天和终端，保证终端区域 `flex: 1; minHeight: 0`，Codex/Restricted 下给终端 div 设 `minHeight: 80/120`。
6. **ResizeObserver**：在终端容器上挂了 ResizeObserver，在回调里 fit + 通知后端 resize。
7. **布局改为正常流**：移除 `.termPane` 绝对定位叠放（`position:absolute; inset:0`），改为 `flex:1` 的正常流布局；用 `display:none/flex` 在 `.termPaneHidden/.termPaneActive` 之间切换，避免 `visibility`/`opacity` 隐藏导致 xterm 尺寸/渲染失效。
8. **恢复叠放 + 不再 display:none**：`.termPane` 恢复为 `position:absolute; inset:0`，切换时只改 `opacity` + `pointer-events`，不使用 `display:none`，让 xterm 始终有尺寸，避免隐藏→显示后 canvas 不重绘。

## 可能原因（待验证）

- xterm 在 **display:none → display:flex** 切换后，内部 canvas/renderer 未正确拿到尺寸或未重绘。
- 首次在可见容器内 open 正常，再次隐藏再显示后，**FitAddon 或 xterm 内部状态**未随容器尺寸更新。
- React 状态/重绘时机导致 **fit 执行时 DOM 尚未完成布局**（即便多次延迟 + reflow）。
- 与 **Monaco Editor** 同页时，布局变化触发的 Monaco 异步取消（Canceled）是否间接触发异常或影响布局（已在前端忽略该 promise，但终端仍不显示）。

## 关键代码位置（便于别人看）

- 终端初始化（仅非 Cursor 时创建）：`apps/web/src/ui/App.tsx` 中 `// Terminal init` 的 `useEffect`，依赖 `[safeFitTerm, terminalVisible, termMode]`。
- 切换模式后的 fit：同文件内 `// When switching to Codex/Restricted` 的 `useEffect`，依赖 `[terminalVisible, termMode, safeFitTerm]`。
- `safeFitTerm`：同文件，内部分别检查 `termDivRef.current`、`fitRef.current`、`termRef.current`，以及 `el.clientWidth/Height`、renderer dimensions，再 `fit.fit()`。
- 终端 DOM：`TerminalPanel` 内 `termAreaWrap` → `term` div，`ref={termDivRef}`，Codex/Restricted 时 `display: 'flex', flex: 1, minHeight: 80|120`。
- 样式切换：`apps/web/src/styles.css` 内 `.termPane/.termPaneHidden/.termPaneActive`，从绝对定位叠放改为正常流 + `display` 切换。

## 期望

- 在 Codex 或 Restricted 模式下，终端区域**稳定显示**，可输入且与后端 PTY/Shell 正常交互。
- 在 Cursor ↔ Codex/Restricted 之间**多次切换**后，终端仍能正常显示。

## 环境

- 本地 Web IDE 项目，Monorepo（apps/web + apps/server）。
- 浏览器：常规现代浏览器；移动端也有同类现象。

---

**提问时可附上**：上述现象描述 + “已尝试 1–6” + “关键代码位置” + 若可提供，一张「Codex 模式下终端区域空白」的截图或录屏。
