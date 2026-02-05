# VibeGo

VibeGo 本机两段式 Web IDE：目录树 + 文件编辑器 + 受限终端。

## 开发

```bash
pnpm install
pnpm dev
```

- web dev：`http://localhost:5173`
- server：`http://localhost:3005`

## 配置

编辑 `config/config.json`：

- `roots`: 允许访问的目录列表
- `commandWhitelist`: 允许在“受限终端”执行的命令
- `limits`: 超时、输出大小、会话数量等
