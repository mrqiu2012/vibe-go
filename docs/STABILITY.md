# 应用稳定性优化指南

## 已实施的优化

### 1. 文件监听优化
- **tsx watch** 已配置忽略不必要的目录：
  - `node_modules/**`
  - `dist/**`
  - `.git/**`
  - `data/**`
- 避免监听临时文件和构建产物，减少不必要的重启

### 2. Vite HMR 优化
- 配置了文件监听忽略规则
- 优化了 HMR 连接，减少频繁重载
- 添加了错误覆盖层

### 3. 错误处理
- 添加了优雅关闭（SIGTERM/SIGINT）
- 处理未捕获的异常和 Promise 拒绝
- 添加了启动日志，方便排查问题

### 4. 进程管理
- 使用 `concurrently` 管理多个进程
- 配置了 `--kill-others-on-fail=false` 避免一个进程失败导致全部退出

## 运行建议

### 开发模式
```bash
pnpm dev
```

访问：
- **前端**: http://localhost:3989/
- **后端 API**: http://localhost:3990/api/*
- **WebSocket**: ws://localhost:3990/ws/term

### 生产模式
```bash
pnpm build
pnpm start
```

## 守护进程（更稳定的常驻方式）

若希望服务在后台常驻、崩溃自动重启、关掉终端也不退出，可用以下方式之一。

### 方式一：PM2（推荐）

[PM2](https://pm2.keymetrics.io/) 是常用的 Node 进程管理器，支持自动重启、日志、开机自启。

1. **安装 PM2**（全局，一次即可）：
   ```bash
   pnpm add -g pm2
   # 或: npm i -g pm2
   ```

2. **构建并用 PM2 启动**：
   ```bash
   pnpm build
   pm2 start ecosystem.config.cjs
   ```

3. **常用命令**：
   - `pm2 status` — 查看状态
   - `pm2 logs vibego-server` — 看日志
   - `pm2 restart vibego-server` — 重启
   - `pm2 stop vibego-server` — 停止
   - `pm2 delete vibego-server` — 从 PM2 中移除

4. **开机自启**（可选）：
   ```bash
   pm2 save
   pm2 startup
   ```
   按终端提示执行生成的命令即可。

项目根目录的 `ecosystem.config.cjs` 已配置好：单实例、崩溃自动重启、日志输出到 `logs/`。

### 方式二：macOS launchd

不装 PM2 时，可用系统自带的 launchd 守护。

1. 在项目根目录执行 `pnpm build`，确认 `apps/server/dist/index.js` 存在。
2. 创建 plist（将 `YOUR_USER` 和 `/path/to/web-ide-local` 换成你的用户名和项目绝对路径）：
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
     <key>Label</key>
     <string>local.vibego.server</string>
     <key>ProgramArguments</key>
     <array>
       <string>/usr/bin/env</string>
       <string>node</string>
       <string>/path/to/web-ide-local/apps/server/dist/index.js</string>
     </array>
     <key>WorkingDirectory</key>
     <string>/path/to/web-ide-local/apps/server</string>
     <key>RunAtLoad</key>
     <true/>
     <key>KeepAlive</key>
     <true/>
     <key>StandardOutPath</key>
     <string>/path/to/web-ide-local/logs/vibego-stdout.log</string>
     <key>StandardErrorPath</key>
     <string>/path/to/web-ide-local/logs/vibego-stderr.log</string>
   </dict>
   </plist>
   ```
3. 保存为 `~/Library/LaunchAgents/local.vibego.server.plist`。
4. 加载并启动：
   ```bash
   mkdir -p /path/to/web-ide-local/logs
   launchctl load ~/Library/LaunchAgents/local.vibego.server.plist
   ```
5. 停止/卸载：`launchctl unload ~/Library/LaunchAgents/local.vibego.server.plist`。

`KeepAlive` 为 `true` 时，进程退出会被自动拉起。

## 排查问题

### 如果页面不断刷新
1. 检查浏览器控制台是否有错误
2. 检查终端日志，看是否有进程不断重启
3. 确认端口 3989 和 3990 没有被其他程序占用

### 如果服务器频繁重启
1. 检查是否有文件在频繁变化（如日志文件）
2. 确认 `.gitignore` 已正确配置
3. 检查 `data/agent-buffers/` 目录是否有大量文件变化

### 如果 WebSocket 连接不稳定
1. 检查网络连接
2. 查看服务器日志中的 WebSocket 错误
3. 确认防火墙设置

## 监控和日志

服务器启动后会显示：
```
✅ Server running on http://localhost:3990/
   API: http://localhost:3990/api/*
   WebSocket: ws://localhost:3990/ws/term
```

如果看到这些日志，说明服务器已正常启动。
