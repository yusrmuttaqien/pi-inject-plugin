/**
 * codeword.ts — codeword injection into pi's compaction prompt.
 *
 * Prepend a codeword to the first line of the summarization user message
 * inside completeSummarization() — the single choke point for ALL pi
 * summarization LLM calls (manual /compact, auto threshold/overflow
 * compaction, split-turn prefix summary, and /tree branch summarization).
 *
 * Works by patching dist/core/compaction/compaction.js in the running pi
 * install. The marker identifies the injected lines; re-injection removes
 * them before inserting the new codeword (a replace).
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";

export const PKG = "@earendil-works/pi-coding-agent";
const TARGET_REL = "dist/core/compaction/compaction.js";
export const MARKER = "pi-inject-patch";
const SIG =
  "export async function completeSummarization(model, context, options, streamFn, retry, callbacks) {";

function isPiRoot(dir: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return pkg.name === PKG && fs.existsSync(path.join(dir, TARGET_REL));
  } catch {
    return false;
  }
}

/** Walk up from a file path until we find the pi package root. */
export function walkUp(from: string): string | null {
  let dir = path.dirname(from);
  for (let i = 0; i < 12; i++) {
    if (isPiRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Find the pi package root of the *running* pi, supporting both install modes. */
export function findPiRoot(): string | null {
  // 1. The running binary. Works for npm -g and managed installs; in a managed
  //    install the realpath lands inside the active release directory.
  const argv1 = process.argv[1];
  if (argv1) {
    let real: string;
    try {
      real = fs.realpathSync(argv1);
    } catch {
      real = argv1;
    }
    const root = walkUp(real);
    if (root) return root;
  }

  // 2. Managed install (bash script): PI_MANAGED_INSTALL_ROOT is set by the launcher.
  const managedRoot = process.env.PI_MANAGED_INSTALL_ROOT;
  if (managedRoot) {
    try {
      const version = fs.readFileSync(path.join(managedRoot, "current-version"), "utf8").trim();
      const root = path.join(managedRoot, "releases", version, "node_modules", PKG);
      if (isPiRoot(root)) return root;
    } catch {
      /* fall through */
    }
  }

  // 3. npm -g
  try {
    const npmRoot = execSync("npm root -g", { stdio: "pipe" }).toString().trim();
    const root = path.join(npmRoot, PKG);
    if (isPiRoot(root)) return root;
  } catch {
    /* fall through */
  }

  // 4. Managed install scan (no env var, e.g. pi launched via node directly).
  const installDir = path.join(os.homedir(), ".pi", "agent", "install");
  let versions: string[] = [];
  try {
    versions = fs.readdirSync(path.join(installDir, "releases"));
  } catch {
    /* no managed install */
  }
  let current: string | null = null;
  try {
    const v = fs.readFileSync(path.join(installDir, "current-version"), "utf8").trim();
    if (v) current = v;
  } catch {
    /* no current-version file */
  }
  const ordered = current ? [current, ...versions.filter((v) => v !== current)] : versions;
  for (const v of ordered) {
    const root = path.join(installDir, "releases", v, "node_modules", PKG);
    if (isPiRoot(root)) return root;
  }

  // 5. nvm scan (last resort).
  const nvmDir = path.join(os.homedir(), ".nvm", "versions", "node");
  try {
    for (const version of fs.readdirSync(nvmDir)) {
      const root = path.join(nvmDir, version, "lib", "node_modules", PKG);
      if (isPiRoot(root)) return root;
    }
  } catch {
    /* no nvm */
  }

  return null;
}

/** Escape a codeword for safe embedding in a double-quoted JS string literal. */
export function escapeCodeword(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Build the two injected lines (comment + code) for a given codeword. */
export function buildInjection(codeword: string): { comment: string; code: string } {
  const escaped = escapeCodeword(codeword);
  return {
    comment: `    // ${MARKER}: prepend codeword to summarization prompt`,
    code:
      `    { const __m = context.messages[context.messages.length - 1]; ` +
      `__m.content[__m.content.length - 1].text = "${escaped}\\n\\n" + __m.content[__m.content.length - 1].text; } // ${MARKER}`,
  };
}

export function inject(codeword: string): { ok: boolean; message: string } {
  const root = findPiRoot();
  if (!root) {
    return {
      ok: false,
      message: "Could not find the pi installation (tried running binary, PI_MANAGED_INSTALL_ROOT, npm -g, managed releases, nvm).",
    };
  }
  const file = path.join(root, TARGET_REL);

  let src: string;
  try {
    src = fs.readFileSync(file, "utf8");
  } catch (e) {
    return { ok: false, message: `Cannot read ${file}: ${String(e)}` };
  }

  const i = src.indexOf(SIG);
  if (i === -1) {
    return {
      ok: false,
      message: `completeSummarization() signature not found in ${file} — pi may have changed its internals. Inspect the file and update this extension.`,
    };
  }

  const { comment, code } = buildInjection(codeword);
  const already = src.includes(code);
  const hadPrevious = src.includes(MARKER);

  // Remove any existing injection (both lines carry the marker), then insert
  // the new one right after the signature. This makes re-injection a replace.
  const lines = src.split("\n").filter((l) => !l.includes(MARKER));
  const base = lines.join("\n");
  const j = base.indexOf(SIG);
  const next = base.slice(0, j + SIG.length + 1) + comment + "\n" + code + "\n" + base.slice(j + SIG.length + 1);

  fs.writeFileSync(file, next);

  // Sanity check: file must still parse.
  try {
    execSync(`node --check ${JSON.stringify(file)}`, { stdio: "pipe" });
  } catch (e) {
    return { ok: false, message: `Injected, but syntax check failed: ${String(e)}` };
  }

  let verb: string;
  if (already) verb = "Already injected";
  else if (hadPrevious) verb = `Replaced previous injection with`;
  else verb = "Injected";

  return { ok: true, message: `${verb} "${codeword}" → ${file}` };
}

export function revert(): { ok: boolean; message: string } {
  const root = findPiRoot();
  if (!root) {
    return {
      ok: false,
      message: "Could not find the pi installation (tried running binary, PI_MANAGED_INSTALL_ROOT, npm -g, managed releases, nvm).",
    };
  }
  const file = path.join(root, TARGET_REL);

  let src: string;
  try {
    src = fs.readFileSync(file, "utf8");
  } catch (e) {
    return { ok: false, message: `Cannot read ${file}: ${String(e)}` };
  }

  if (!src.includes(MARKER)) {
    return { ok: true, message: "Not injected — nothing to revert." };
  }

  const lines = src.split("\n").filter((l) => !l.includes(MARKER));
  fs.writeFileSync(file, lines.join("\n"));
  return { ok: true, message: `Reverted: ${file}` };
}

/** Unescape a codeword as stored in the JS string literal (\\ → \, \" → "). */
export function unescapeCodeword(s: string): string {
  return s.replace(/\\(.)/g, "$1");
}

export function status(): { ok: boolean; message: string } {
  const root = findPiRoot();
  if (!root) {
    return {
      ok: false,
      message: "Could not find the pi installation (tried running binary, PI_MANAGED_INSTALL_ROOT, npm -g, managed releases, nvm).",
    };
  }
  const file = path.join(root, TARGET_REL);

  let src: string;
  try {
    src = fs.readFileSync(file, "utf8");
  } catch (e) {
    return { ok: false, message: `Cannot read ${file}: ${String(e)}` };
  }

  if (!src.includes(MARKER)) {
    return { ok: true, message: "Not injected." };
  }

  const line = src.split("\n").find((l) => l.includes(MARKER) && l.includes("text = "));
  if (!line) {
    return { ok: true, message: "Injected (could not read codeword)." };
  }
  const m = line.match(/text = "((?:[^"\\]|\\.)*)\\n\\n"/);
  if (!m) {
    return { ok: true, message: "Injected (could not parse codeword)." };
  }
  const codeword = unescapeCodeword(m[1]);
  return { ok: true, message: `Injected: "${codeword}"` };
}
