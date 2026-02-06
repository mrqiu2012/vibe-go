# 文件树「跟随终端 cwd 展开」与「用户折叠」冲突问题

## 背景

- **技术栈**：React，左侧是文件树（TreeView），右侧是编辑器和终端。
- **业务需求**：文件树要「跟随终端当前目录」：终端 cwd 变化时，树自动展开到该路径并滚动到对应行（`explorerTargetPath` 来自 `projectCwd` / `terminalCwd`）。
- **用户操作**：用户可点击树节点前的 ▸/▾ 手动展开/折叠任意目录（包括项目根目录）。

## 问题现象

1. **折叠被覆盖**  
   用户点击项目根目录（如 `web-ide-local`）的 ▾ 想折叠，树会马上又展开，看起来「只能展开、不能折叠」。  
   只有点击的目录和「当前项目/当前 cwd」一致时，折叠才偶尔正常。

2. **初次打开异常**  
   在尝试修复上述问题时，又出现：打开页面后，目录不自动展开到终端 cwd，列表滚动位置也不对。

## 根因简述

- 有一个 `useEffect` 负责「把树展开到 `explorerTargetPath`」（并滚动到该行），依赖数组里包含 **`tree`**。
- 用户点击折叠 → `toggleDir` 更新 `tree`（某节点 `expanded: false`）→ 该 effect 再次执行 → 内部调用 `expandToPath()`，把整条路径重新展开 → 用户看到的折叠被立刻覆盖。
- 若为了「用户折叠后不再自动展开」而加「已同步」判断（例如用 ref 记 `lastSyncedRoot` / `lastSyncedPath`，相同则跳过展开），又容易在**初次加载**或**树异步加载子节点**时误判为「已同步」，导致不执行 `expandToPath()`，出现「打开页面不展开、位置不对」。

也就是说：**「跟随 cwd 的自动展开」和「尊重用户的手动折叠」共用同一份 `tree` 和同一个 effect，在依赖里带上 `tree` 就会在用户折叠后再次触发展开；不带 `tree` 或加「已同步」跳过逻辑，又容易破坏初次展开和滚动。**

## 相关代码位置（apps/web/src/ui/App.tsx）

- `explorerTargetPath`：由 `projectCwd`（或 `terminalCwd`）等算出，表示「要展开并滚动到的路径」（约 814–821 行）。
- `useEffect`：在 `activeRoot` / `explorerTargetPath` / `tree` 等变化时执行，内部调用 `expandToPath()` 展开到 `explorerTargetPath` 并 `scrollToTerminalCwd()`（约 859–941 行）。
- `toggleDir`：用户点击树节点时折叠/展开，通过 `setTree` + `updateNode` 改对应节点的 `expanded`（约 972–1006 行）。
- `treeRef`：与 state `tree` 同步，供 `expandToPath` 里读当前树；`expandToPath` 为 async，会多次 `setTree`（展开节点、加载子目录）。

## 已尝试过的思路（均未彻底解决）

1. **用 ref 记「上次已同步的 root + path」**  
   - 若 `activeRoot` 和 `explorerTargetPath` 与上次相同则不再执行 `expandToPath`，避免用户折叠后再次展开。  
   - 结果：初次打开或树异步加载子节点时，effect 会因 `tree` 变化多次执行，被误判为「已同步」而跳过，导致不展开、位置不对。

2. **只在 `expandToPath` 的 `finally` 里写「已同步」ref**  
   - 意图：只有完整展开到目标路径后才算「已同步」，避免初次加载被误跳过。  
   - 结果：问题仍存在（用户反馈「没有解决」），可能仍有时序/多次 effect 执行导致误跳过或重复展开。

3. **`expandingTreeRef`**  
   - 在 `expandToPath` 执行期间置 true，effect 开头若为 true 则 return，避免重复进入。  
   - 能减轻重复执行，但无法单独区分「这次 tree 变化是用户折叠」还是「加载子节点导致的更新」，治标不治本。

## 期望行为（可照抄给别人）

- **初次进入 / 切换项目**：根据当前 `explorerTargetPath` 自动展开文件树到该路径，并滚动到对应行。
- **终端 cwd 变化**：树自动展开到新 cwd 路径并滚动到位。
- **用户手动折叠某目录（含项目根）**：折叠状态应保留，不会被自动展开逻辑再次打开。
- **用户手动展开某目录**：行为保持现状即可。

## 需要别人帮忙的点

在**不破坏「初次打开 / 切换项目 / cwd 变化时自动展开并滚动」**的前提下，如何设计或改写逻辑，使得**用户的手动折叠不会被「跟随 cwd 的 effect」再次展开**？  

例如是否应该：

- 把「自动展开到 cwd」和「用户折叠」在状态或逻辑上解耦（例如单独记「用户最近折叠的 path」或「是否本次由用户操作引起的 tree 变化」），让 effect 在「仅因用户折叠导致的 tree 变化」时不执行展开；或  
- 用别的数据流/状态结构（如 reducer、显式「同步中」状态）区分「程序触发的展开」和「用户触发的折叠」，避免依赖 `tree` 触发 effect 导致的一展开一折叠互相覆盖；或  
- 有更合适的 React 模式（effect 依赖设计、ref 使用方式等）适合这种「自动同步 + 用户覆盖」的场景。

当前实现集中在 `apps/web/src/ui/App.tsx` 的上述 effect 和 `toggleDir` 附近，便于别人直接看代码给建议。
