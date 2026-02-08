import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

// Types
export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

export type ChatSession = {
  id: string;
  cwd: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
};

export type Workspace = {
  id: string;
  cwd: string;
  name: string;
  isActive: boolean;
  createdAt: number;
};

// Database singleton
let db: Database.Database | null = null;

function getDbPath(): string {
  // Store database in user's home directory (os.homedir() is more reliable than env)
  const homeDir = typeof os.homedir === "function" ? os.homedir() : process.env.HOME || process.env.USERPROFILE || ".";
  const dataDir = path.join(homeDir, ".vibego");

  // Ensure directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  return path.join(dataDir, "chat_history.db");
}

export function getDb(): Database.Database {
  if (!db) {
    try {
      const dbPath = getDbPath();
      db = new Database(dbPath);

      // Enable WAL mode for better performance
      db.pragma("journal_mode = WAL");

      // Initialize schema
      initSchema(db);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Database init failed: ${msg}`);
    }
  }
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      cwd TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'New Chat',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      cwd TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS editor_state (
      root TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_cwd ON chat_sessions(cwd);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  `);
}

// CRUD Operations

export function getAllSessions(cwd: string): ChatSession[] {
  const db = getDb();
  
  const sessions = db.prepare(`
    SELECT id, cwd, title, created_at as createdAt, updated_at as updatedAt
    FROM chat_sessions
    WHERE cwd = ?
    ORDER BY updated_at DESC
  `).all(cwd) as Array<Omit<ChatSession, "messages">>;
  
  // Fetch messages for each session
  const getMessages = db.prepare(`
    SELECT id, role, content, timestamp
    FROM messages
    WHERE session_id = ?
    ORDER BY timestamp ASC
  `);
  
  return sessions.map((session) => ({
    ...session,
    messages: getMessages.all(session.id) as Message[],
  }));
}

export function getSession(sessionId: string): ChatSession | null {
  const db = getDb();
  
  const session = db.prepare(`
    SELECT id, cwd, title, created_at as createdAt, updated_at as updatedAt
    FROM chat_sessions
    WHERE id = ?
  `).get(sessionId) as Omit<ChatSession, "messages"> | undefined;
  
  if (!session) return null;
  
  const messages = db.prepare(`
    SELECT id, role, content, timestamp
    FROM messages
    WHERE session_id = ?
    ORDER BY timestamp ASC
  `).all(sessionId) as Message[];
  
  return { ...session, messages };
}

export function createSession(session: ChatSession): ChatSession {
  const db = getDb();
  
  const insertSession = db.prepare(`
    INSERT INTO chat_sessions (id, cwd, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  const insertMessage = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  const transaction = db.transaction(() => {
    insertSession.run(
      session.id,
      session.cwd,
      session.title,
      session.createdAt,
      session.updatedAt
    );
    
    for (const msg of session.messages) {
      insertMessage.run(msg.id, session.id, msg.role, msg.content, msg.timestamp);
    }
  });
  
  transaction();
  return session;
}

export function updateSession(session: ChatSession): ChatSession {
  const db = getDb();
  
  const updateSessionStmt = db.prepare(`
    UPDATE chat_sessions
    SET title = ?, updated_at = ?
    WHERE id = ?
  `);
  
  const deleteMessages = db.prepare(`
    DELETE FROM messages WHERE session_id = ?
  `);
  
  const insertMessage = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  const transaction = db.transaction(() => {
    updateSessionStmt.run(session.title, session.updatedAt, session.id);
    
    // Replace all messages (simpler than diffing)
    deleteMessages.run(session.id);
    for (const msg of session.messages) {
      insertMessage.run(msg.id, session.id, msg.role, msg.content, msg.timestamp);
    }
  });
  
  transaction();
  return session;
}

export function deleteSession(sessionId: string): boolean {
  const db = getDb();
  
  // Messages will be deleted automatically due to CASCADE
  const result = db.prepare(`
    DELETE FROM chat_sessions WHERE id = ?
  `).run(sessionId);
  
  return result.changes > 0;
}

export function addMessage(sessionId: string, message: Message): void {
  const db = getDb();
  
  // Update session's updated_at timestamp
  const updateSession = db.prepare(`
    UPDATE chat_sessions SET updated_at = ? WHERE id = ?
  `);
  
  const insertMessage = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  const transaction = db.transaction(() => {
    insertMessage.run(message.id, sessionId, message.role, message.content, message.timestamp);
    updateSession.run(Date.now(), sessionId);
  });
  
  transaction();
}

export function updateMessage(messageId: string, content: string): void {
  const db = getDb();
  
  db.prepare(`
    UPDATE messages SET content = ? WHERE id = ?
  `).run(content, messageId);
}

// ==================== Workspace Operations ====================

export function getAllWorkspaces(): Workspace[] {
  const db = getDb();
  
  const rows = db.prepare(`
    SELECT id, cwd, name, is_active as isActive, created_at as createdAt
    FROM workspaces
    ORDER BY created_at ASC
  `).all() as Array<{ id: string; cwd: string; name: string; isActive: number; createdAt: number }>;
  
  return rows.map((row) => ({
    ...row,
    isActive: row.isActive === 1,
  }));
}

export function getActiveWorkspace(): Workspace | null {
  const db = getDb();
  
  const row = db.prepare(`
    SELECT id, cwd, name, is_active as isActive, created_at as createdAt
    FROM workspaces
    WHERE is_active = 1
    LIMIT 1
  `).get() as { id: string; cwd: string; name: string; isActive: number; createdAt: number } | undefined;
  
  if (!row) return null;
  
  return {
    ...row,
    isActive: row.isActive === 1,
  };
}

export function createWorkspace(workspace: Omit<Workspace, "isActive"> & { isActive?: boolean }): Workspace {
  const db = getDb();
  
  const insertWorkspace = db.prepare(`
    INSERT INTO workspaces (id, cwd, name, is_active, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  const ws: Workspace = {
    id: workspace.id,
    cwd: workspace.cwd,
    name: workspace.name,
    isActive: workspace.isActive ?? false,
    createdAt: workspace.createdAt,
  };
  
  insertWorkspace.run(ws.id, ws.cwd, ws.name, ws.isActive ? 1 : 0, ws.createdAt);
  
  return ws;
}

export function setActiveWorkspace(workspaceId: string): void {
  const db = getDb();
  
  const transaction = db.transaction(() => {
    // Clear all active flags
    db.prepare(`UPDATE workspaces SET is_active = 0`).run();
    // Set the specified workspace as active
    db.prepare(`UPDATE workspaces SET is_active = 1 WHERE id = ?`).run(workspaceId);
  });
  
  transaction();
}

export function deleteWorkspace(workspaceId: string): boolean {
  const db = getDb();
  
  const result = db.prepare(`
    DELETE FROM workspaces WHERE id = ?
  `).run(workspaceId);
  
  return result.changes > 0;
}

export function getWorkspaceByCwd(cwd: string): Workspace | null {
  const db = getDb();
  
  const row = db.prepare(`
    SELECT id, cwd, name, is_active as isActive, created_at as createdAt
    FROM workspaces
    WHERE cwd = ?
  `).get(cwd) as { id: string; cwd: string; name: string; isActive: number; createdAt: number } | undefined;
  
  if (!row) return null;
  
  return {
    ...row,
    isActive: row.isActive === 1,
  };
}

// ==================== Editor state (last opened file per root) ====================

export function getLastOpenedFile(root: string): string | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT file_path FROM editor_state WHERE root = ?
  `).get(root) as { file_path: string } | undefined;
  return row?.file_path ?? null;
}

export function setLastOpenedFile(root: string, filePath: string): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(`
    INSERT INTO editor_state (root, file_path, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(root) DO UPDATE SET file_path = excluded.file_path, updated_at = excluded.updated_at
  `).run(root, filePath, now);
}

// ==================== App state (key/value) ====================

export function getAppState(key: string): string | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT value FROM app_state WHERE key = ?
  `).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setAppState(key: string, value: string): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(`
    INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, now);
}

export function getActiveRoot(): string | null {
  return getAppState("activeRoot");
}

export function setActiveRoot(root: string): void {
  setAppState("activeRoot", root);
}

// Cleanup on process exit
process.on("exit", () => {
  if (db) {
    try {
      db.close();
    } catch {}
  }
});
