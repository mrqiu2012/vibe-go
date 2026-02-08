#!/usr/bin/env node
/**
 * 生成初始化数据库文件（仅表结构，无本机记录数据）
 * 输出：项目根目录 data/chat_history.init.db
 * 使用：pnpm init-db（在项目根目录）或 pnpm run init-db（在 apps/server）
 */

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 从 apps/server/scripts 出发，定位到项目根目录
const serverDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(serverDir, "..", "..");
const dataDir = path.join(repoRoot, "data");
const schemaPath = path.join(dataDir, "schema.sql");
const outPath = path.join(dataDir, "chat_history.init.db");

if (!fs.existsSync(schemaPath)) {
  console.error("未找到 data/schema.sql，请先确保该文件存在。");
  process.exit(1);
}

const schemaSql = fs.readFileSync(schemaPath, "utf8");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 从 apps/server 的 node_modules 加载 better-sqlite3
const require = createRequire(path.join(serverDir, "package.json"));
const Database = require("better-sqlite3");
const db = new Database(outPath);

try {
  db.pragma("journal_mode = WAL");
  db.exec(schemaSql);
  console.log("已生成初始化数据库：", outPath);
} finally {
  db.close();
}
