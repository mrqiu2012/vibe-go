import fs from "node:fs/promises";
import path from "node:path";

export type CommandSpec = { title?: string };

export type AppConfig = {
  server?: { port?: number };
  roots: string[];
  /** 任务输出缓冲目录，默认 repo/data/agent-buffers */
  bufferDir?: string;
  commandWhitelist?: Record<string, CommandSpec>;
  dangerousCommandDenylist?: string[];
  limits?: {
    timeoutSec?: number;
    maxOutputKB?: number;
    maxSessions?: number;
  };
};

export function defaultConfigPath() {
  // apps/server/dist -> apps/server -> apps -> repoRoot
  const repoRoot = path.resolve(process.cwd());
  return path.join(repoRoot, "config", "config.json");
}

function localConfigPath(configPath: string) {
  const dir = path.dirname(configPath);
  return path.join(dir, "config.local.json");
}

export function rootsOverridePath(configPath: string) {
  const env = process.env.VIBEGO_ROOTS_FILE;
  if (env && env.trim()) return env.trim();
  const dir = path.dirname(configPath);
  return path.join(dir, "roots.local.json");
}

async function readJsonIfExists(filePath: string) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as Partial<AppConfig>;
  } catch (err: any) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) return null;
    throw err;
  }
}

export async function readRootsOverride(filePath: string): Promise<string[] | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw) as unknown;
    if (Array.isArray(data)) {
      const roots = data.filter((v) => typeof v === "string" && v.trim()) as string[];
      return roots.length ? roots : null;
    }
    if (data && typeof data === "object" && Array.isArray((data as any).roots)) {
      const roots = (data as any).roots.filter((v: unknown) => typeof v === "string" && v.trim()) as string[];
      return roots.length ? roots : null;
    }
    throw new Error("roots.local.json must be a JSON array of strings or { roots: string[] }");
  } catch (err: any) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) return null;
    throw err;
  }
}

function applyEnvOverrides(config: AppConfig): AppConfig {
  const rootsEnv = process.env.VIBEGO_ROOTS;
  if (!rootsEnv) return config;
  try {
    const parsed = JSON.parse(rootsEnv);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("VIBEGO_ROOTS must be a non-empty JSON array");
    }
    return { ...config, roots: parsed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid VIBEGO_ROOTS: ${msg}`);
  }
}

export async function loadConfig(configPath: string): Promise<AppConfig> {
  const base =
    (await readJsonIfExists(configPath)) ??
    (await readJsonIfExists(path.join(path.dirname(configPath), "config.example.json")));
  if (!base) {
    throw new Error("Config not found: config.json or config.example.json");
  }

  const local = await readJsonIfExists(localConfigPath(configPath));
  const parsed = { ...base, ...(local ?? {}) } as AppConfig;

  const rootsOverride = await readRootsOverride(rootsOverridePath(configPath));
  if (rootsOverride && rootsOverride.length > 0) {
    parsed.roots = rootsOverride;
  }

  if (!parsed || !Array.isArray(parsed.roots)) parsed.roots = [];
  if (parsed.commandWhitelist && typeof parsed.commandWhitelist !== "object") parsed.commandWhitelist = {};
  if (!Array.isArray(parsed.dangerousCommandDenylist)) parsed.dangerousCommandDenylist = [];
  return applyEnvOverrides(parsed);
}
