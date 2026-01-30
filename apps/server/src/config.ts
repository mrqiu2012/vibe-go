import fs from "node:fs/promises";
import path from "node:path";

export type CommandSpec = { title?: string };

export type AppConfig = {
  server?: { port?: number };
  roots: string[];
  // Legacy: if non-empty, acts as an allowlist (restricted mode).
  commandWhitelist?: Record<string, CommandSpec>;
  // Preferred: blacklist in restricted mode (everything else allowed).
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

export async function loadConfig(configPath: string): Promise<AppConfig> {
  const raw = await fs.readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as AppConfig;
  if (!parsed || !Array.isArray(parsed.roots) || parsed.roots.length === 0) {
    throw new Error("Invalid config: roots must be a non-empty array");
  }
  if (parsed.commandWhitelist && typeof parsed.commandWhitelist !== "object") parsed.commandWhitelist = {};
  if (!Array.isArray(parsed.dangerousCommandDenylist)) parsed.dangerousCommandDenylist = [];
  return parsed;
}

