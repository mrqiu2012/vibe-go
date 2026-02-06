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



复制示例配置并按需修改：

```bash
cp config/config.example.json config/config.json
```

编辑 `config/config.json`：

- `roots`: 允许访问的目录列表（勿提交含本机路径的配置到公开仓库）
- `commandWhitelist`: 允许在“受限终端”执行的命令（可选）
- `dangerousCommandDenylist`: 禁止的危险命令
- `limits`: 超时、输出大小、会话数量等

## 守护运行（后台常驻、崩溃自启）

需要服务在后台常驻、关掉终端也不退出时，可用 [PM2](https://pm2.keymetrics.io/)：

```bash
pnpm add -g pm2
pnpm pm2:start
```

更多方式（含 macOS launchd）见 [docs/STABILITY.md](docs/STABILITY.md#守护进程更稳定的常驻方式)。

## 许可证

MIT License，见 [LICENSE](LICENSE)。
