import fs from "node:fs/promises";
import path from "node:path";

export function normalizeRoot(p: string) {
  const abs = path.resolve(p);
  // Strip trailing slash for consistent prefix checks.
  return abs.replace(/\/+$/, "") || "/";
}

export async function normalizeRoots(roots: string[]) {
  const out: string[] = [];
  for (const r of roots) {
    const abs = normalizeRoot(r);
    try {
      const st = await fs.stat(abs);
      if (st.isDirectory()) out.push(abs);
    } catch {
      // ignore invalid roots
    }
  }
  if (out.length === 0) throw new Error("No valid roots");
  // prefer longer roots first (more specific)
  out.sort((a, b) => b.length - a.length);
  return out;
}

export async function realpathSafe(p: string) {
  // If path doesn't exist yet (e.g. write new file), resolve parent.
  try {
    return await fs.realpath(p);
  } catch {
    const parent = path.dirname(p);
    const realParent = await fs.realpath(parent);
    return path.join(realParent, path.basename(p));
  }
}

export async function validatePathInRoots(inputPath: string, roots: string[]) {
  if (typeof inputPath !== "string" || inputPath.length === 0) throw new Error("Missing path");
  const abs = path.resolve(inputPath);
  const real = await realpathSafe(abs);
  for (const r of roots) {
    if (real === r) return real;
    if (real.startsWith(r + path.sep)) return real;
  }
  throw new Error("Path is outside configured roots");
}

