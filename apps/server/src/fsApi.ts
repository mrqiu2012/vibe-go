import fs from "node:fs/promises";
import path from "node:path";
import type { FsEntry } from "@vibego/protocol";
import { validatePathInRoots } from "./pathGuard.js";

export async function listDir(roots: string[], dirPath: string): Promise<{ path: string; entries: FsEntry[] }> {
  const realDir = await validatePathInRoots(dirPath, roots);
  const st = await fs.stat(realDir);
  if (!st.isDirectory()) throw new Error("Not a directory");

  const names = await fs.readdir(realDir);
  const entries: FsEntry[] = [];
  for (const name of names) {
    const full = path.join(realDir, name);
    try {
      const s = await fs.lstat(full);
      const type = s.isDirectory() ? "dir" : s.isFile() ? "file" : "other";
      entries.push({ name, type, size: s.size, mtimeMs: s.mtimeMs });
    } catch {
      // ignore broken entries
    }
  }
  // dirs first, then files
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  return { path: realDir, entries };
}

export async function readTextFile(
  roots: string[],
  filePath: string,
  maxBytes: number,
): Promise<{ path: string; text: string; size: number; mtimeMs: number }> {
  const real = await validatePathInRoots(filePath, roots);
  const st = await fs.stat(real);
  if (!st.isFile()) throw new Error("Not a file");
  if (st.size > maxBytes) throw new Error(`File too large (${st.size} bytes > ${maxBytes})`);
  const text = await fs.readFile(real, "utf8");
  return { path: real, text, size: st.size, mtimeMs: st.mtimeMs };
}

export async function writeTextFile(
  roots: string[],
  filePath: string,
  text: string,
): Promise<{ path: string; size: number; mtimeMs: number }> {
  const real = await validatePathInRoots(filePath, roots);
  await fs.mkdir(path.dirname(real), { recursive: true });
  await fs.writeFile(real, text, "utf8");
  const st = await fs.stat(real);
  return { path: real, size: st.size, mtimeMs: st.mtimeMs };
}

