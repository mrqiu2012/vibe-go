export type FsEntry = {
  name: string;
  type: "file" | "dir" | "other";
  size: number;
  mtimeMs: number;
};

async function j<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok || (data && typeof data === "object" && (data as any).ok === false)) {
    const msg = (data as any)?.error ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export async function apiRoots() {
  return j<{ ok: true; roots: string[] }>(await fetch("/api/roots"));
}

export async function apiList(path: string) {
  return j<{ ok: true; path: string; entries: FsEntry[] }>(await fetch(`/api/list?path=${encodeURIComponent(path)}`));
}

export async function apiRead(path: string) {
  return j<{ ok: true; path: string; text: string; size: number; mtimeMs: number }>(
    await fetch(`/api/read?path=${encodeURIComponent(path)}`),
  );
}

export async function apiWrite(path: string, text: string) {
  return j<{ ok: true; path: string; size: number; mtimeMs: number }>(
    await fetch(`/api/write`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, text }),
    }),
  );
}

