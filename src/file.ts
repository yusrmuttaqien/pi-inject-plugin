/**
 * file.ts — system-prompt file injection (per session).
 *
 * A markdown file is injected VERBATIM into the system prompt via the
 * before_agent_start hook, which fires before EVERY agent run — the original
 * run and every run after compaction (native or pi-vcc). The system message
 * is not part of the summarized messages, so the section survives compaction;
 * the hook re-asserts it on each run.
 *
 * The selected path is persisted per session via a custom entry (appendEntry),
 * which survives session resume. The last such entry wins (a tombstone removes
 * the injection). Custom entries are not sent to the LLM, so no context bloat.
 */

import os from "os";
import path from "path";

export const INJECT_FILE_CUSTOM_TYPE = "pi-inject-file";
export const INJECT_FILE_SECTION = "pi-inject-file";

/** Resolve a user-supplied path: expand ~, resolve relative paths against cwd. */
export function expandPath(p: string, cwd: string): string {
  let s = p;
  if (s === "~") s = os.homedir();
  else if (s.startsWith("~/")) s = path.join(os.homedir(), s.slice(2));
  return path.isAbsolute(s) ? s : path.resolve(cwd, s);
}

/** Find the last pi-inject-file custom entry in the session (or null). */
export function findLastInjectFileEntry(sessionManager: any): {
  path: string | null;
  removed: boolean;
} | null {
  const entries = sessionManager.getEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type === "custom" && e.customType === INJECT_FILE_CUSTOM_TYPE) {
      return e.data as { path: string | null; removed: boolean };
    }
  }
  return null;
}
