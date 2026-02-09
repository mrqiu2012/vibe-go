/** 开发时前端 3989、后端 3990，直接请求后端；生产可为同源或空 */
export const API_BASE =
  typeof import.meta !== "undefined" && import.meta.env?.DEV
    ? "http://localhost:3990"
    : "";

export function apiUrl(path: string): string {
  const base = API_BASE.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return base + p;
}

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

/** 后端可能晚几秒就绪，对初始请求做重试，避免 500 / ECONNREFUSED */
async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  maxAttempts = 6,
  delayMs = 1500
): Promise<Response> {
  let lastErr: unknown;
  for (let n = 0; n < maxAttempts; n++) {
    try {
      const res = await fetch(apiUrl(url), options);
      if (res.ok || res.status < 500) return res;
      lastErr = new Error(`${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    if (n < maxAttempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  throw lastErr;
}

export async function apiRoots() {
  return j<{ ok: true; roots: string[] }>(await fetchWithRetry("/api/roots"));
}

export async function apiGetActiveRoot() {
  return j<{ ok: true; root: string | null }>(await fetch(apiUrl("/api/app/active-root")));
}

export async function apiSetActiveRoot(root: string) {
  return j<{ ok: true }>(
    await fetch(apiUrl("/api/app/active-root"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root }),
    })
  );
}

export async function apiList(path: string) {
  return j<{ ok: true; path: string; entries: FsEntry[] }>(await fetch(apiUrl(`/api/list?path=${encodeURIComponent(path)}`)));
}

export async function apiRead(path: string) {
  return j<{ ok: true; path: string; text: string; size: number; mtimeMs: number }>(
    await fetch(apiUrl(`/api/read?path=${encodeURIComponent(path)}`)),
  );
}

export async function apiWrite(path: string, text: string) {
  return j<{ ok: true; path: string; size: number; mtimeMs: number }>(
    await fetch(apiUrl("/api/write"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, text }),
    }),
  );
}

export async function apiMkdir(path: string) {
  return j<{ ok: true; path: string; mtimeMs: number }>(
    await fetch(apiUrl("/api/mkdir"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    }),
  );
}

// Workspace types and APIs
export type Workspace = {
  id: string;
  cwd: string;
  name: string;
  isActive: boolean;
  createdAt: number;
};

export async function apiGetWorkspaces() {
  return j<{ ok: true; workspaces: Workspace[]; activeId: string | null }>(
    await fetchWithRetry("/api/workspaces")
  );
}

export async function apiCreateWorkspace(workspace: { id: string; cwd: string; name: string; isActive?: boolean }) {
  return j<{ ok: true; workspace: Workspace }>(
    await fetch(apiUrl("/api/workspaces"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(workspace),
    })
  );
}

export async function apiSetActiveWorkspace(id: string) {
  return j<{ ok: true }>(
    await fetch(apiUrl(`/api/workspaces/${id}/active`), {
      method: "PUT",
    })
  );
}

export async function apiDeleteWorkspace(id: string) {
  return j<{ ok: true }>(
    await fetch(apiUrl(`/api/workspaces/${id}`), {
      method: "DELETE",
    })
  );
}

// Editor last opened file
export async function apiGetLastOpenedFile(root: string) {
  return j<{ ok: true; filePath: string | null }>(
    await fetch(apiUrl(`/api/editor/last?root=${encodeURIComponent(root)}`))
  );
}

export async function apiSetLastOpenedFile(root: string, filePath: string) {
  return j<{ ok: true }>(
    await fetch(apiUrl("/api/editor/last"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root, filePath }),
    })
  );
}
