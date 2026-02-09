# VibeGo

VibeGo 本机两段式 Web IDE：目录树 + 文件编辑器 + 受限终端。

## 开发

```bash
pnpm install
pnpm dev
```

- **前端**：http://localhost:3989/
- **后端 API**：http://localhost:3990/api/*
- **WebSocket**：ws://localhost:3990/ws/term

`pnpm dev` 会先启动后端（等 3990 就绪）再启动前端，避免前端先请求时后端未就绪导致 500。若端口被占用，可执行 `pnpm dev:fresh`（会先释放 3989/3990 再启动）。分终端启动时：终端 1 运行 `pnpm dev:server`，终端 2 运行 `pnpm dev:web`。更多说明见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

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
