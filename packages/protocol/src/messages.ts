export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export type OkResp<T extends string, Extra extends object = object> = { t: `${T}.resp`; reqId: string; ok: true } & Extra;
export type ErrResp<T extends string> = { t: `${T}.resp`; reqId: string; ok: false; error: string };

export type FsEntry = {
  name: string;
  type: "file" | "dir" | "other";
  size: number;
  mtimeMs: number;
};

export type TermOpenReq = { 
  t: "term.open"; 
  reqId: string; 
  cwd: string; 
  cols?: number; 
  rows?: number;
  mode?: "restricted" | "native" | "codex" | "claude" | "opencode" | "agent" | "plan" | "ask" | "cursor-cli-agent" | "cursor-cli-plan" | "cursor-cli-ask";
  options?: {
    prompt?: string;
    resume?: string;
  };
};
export type TermOpenResp = OkResp<"term.open", { 
  sessionId: string; 
  cwd: string;
  mode?: string;
  threadId?: string;
}> | ErrResp<"term.open">;

export type TermStdinReq = { t: "term.stdin"; reqId: string; sessionId: string; data: string };
export type TermStdinResp = OkResp<"term.stdin"> | ErrResp<"term.stdin">;

export type TermResizeReq = { t: "term.resize"; reqId: string; sessionId: string; cols: number; rows: number };
export type TermResizeResp = OkResp<"term.resize"> | ErrResp<"term.resize">;

export type TermCloseReq = { t: "term.close"; reqId: string; sessionId: string };
export type TermCloseResp = OkResp<"term.close"> | ErrResp<"term.close">;

export type TermDataEvt = { t: "term.data"; sessionId: string; data: string };
export type TermExitEvt = { t: "term.exit"; sessionId: string; code?: number };

export type TermClientMsg = TermOpenReq | TermStdinReq | TermResizeReq | TermCloseReq;
export type TermServerMsg = TermOpenResp | TermStdinResp | TermResizeResp | TermCloseResp | TermDataEvt | TermExitEvt;
