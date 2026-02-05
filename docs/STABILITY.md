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
