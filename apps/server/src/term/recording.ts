import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function initSessionRecording(sessionId: string): string {
  const controlDir = path.join(os.homedir(), ".vibego", "term", sessionId);
  fs.mkdirSync(controlDir, { recursive: true });
  const stdoutPath = path.join(controlDir, "stdout");
  if (!fs.existsSync(stdoutPath)) {
    fs.writeFileSync(stdoutPath, "");
  }
  return stdoutPath;
}

export function appendRecording(stdoutPath: string, data: string): void {
  try {
    fs.appendFileSync(stdoutPath, data);
  } catch {}
}
