# 开源到 GitHub 前的准备清单

## 已完成的准备

- **LICENSE**：已添加 MIT 许可证；如需改为其他协议或修改版权人，请编辑根目录 `LICENSE`。
- **配置脱敏**：`config/config.json` 已加入 `.gitignore`，并新增 `config/config.example.json` 作为模板；README 已说明复制示例再修改。
- **README**：已补充配置说明与许可证章节。

## 你需要手动完成的步骤

### 1. 停止跟踪本机配置文件（必做）

当前 `config/config.json` 如已被 git 跟踪，需要从版本库中移除（本地文件保留）：

```bash
git rm --cached config/config.json
git commit -m "chore: stop tracking local config, use config.example.json"
```

若该文件**从未推送到远程**，做完以上即可。若**已经推送到过 GitHub**，建议从历史中彻底删除该文件，避免泄露本机路径：

```bash
# 使用 git filter-repo 或 BFG 清理历史；或新建仓库再 push 以舍弃旧历史
```

### 2. 检查敏感信息

- 在仓库内全局搜索：API Key、密码、token、本机路径、邮箱等，确认未提交。
- 确认 `.env`、`.env.local` 等已在 `.gitignore` 中（当前已包含）。

### 3. 决定是否取消 private

根目录 `package.json` 中 `"private": true` 表示不发布到 npm。若只开源代码、不发布包，可保持 `true`；若计划发布到 npm，改为 `false` 并配置 `name`、`version` 等。

### 4. GitHub 仓库设置（在 GitHub 上操作）

- 创建新仓库后，在 **Settings → General** 中填写 Description、Website、Topics。
- 可选：在 **About** 里添加 LICENSE 的简短说明；在根目录或 README 中放徽章（build status、license 等）。

### 5. 可选增强

- **CONTRIBUTING.md**：说明如何提 Issue、PR 和代码风格。
- **SECURITY.md**：说明如何负责任地披露安全问题。
- **Code of Conduct**：社区行为准则（如 Contributor Covenant）。
- **英文 README**：若希望吸引国际贡献者，可加 `README.en.md` 或在 README 顶部做中英简要说明。

---

完成以上步骤后，即可将仓库推送到 GitHub 并设为 Public。
