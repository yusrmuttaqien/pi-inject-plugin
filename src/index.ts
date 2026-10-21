/**
 * index.ts — entry point for pi-inject-plugin.
 *
 * Registers slash commands and hooks:
 *
 *   Codeword injection (patches pi's compaction prompt):
 *     /inject-codeword "codeword"   inject a codeword (replaces any previous)
 *     /inject-codeword-remove       remove the injection
 *     /inject-codeword-status       show the current injection
 *
 *   File injection (verbatim into the system prompt, per session):
 *     /inject-file "path"           inject a markdown file
 *     /inject-file-remove           remove the file injection
 *     /inject-file-status           show the current file injection
 *
 *   Also wires a session_compact_failed hook that auto-fires /pi-vcc when
 *   auto-compaction fails and the command exists.
 */

import fs from "fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { inject, revert, status } from "./codeword.js";
import {
  INJECT_FILE_CUSTOM_TYPE,
  INJECT_FILE_SECTION,
  expandPath,
  findLastInjectFileEntry,
} from "./file.js";

export default function (pi: ExtensionAPI) {
  const doRemove = async (ctx: ExtensionCommandContext) => {
    const result = revert();
    ctx.ui.notify(result.message, result.ok ? "info" : "error");
  };

  pi.registerCommand("inject-codeword", {
    description: 'Inject a codeword into pi\'s compaction prompt: /inject-codeword "codeword" (replaces previous)',
    handler: async (args, ctx) => {
      const raw = args.trim();
      if (raw === "") {
        ctx.ui.notify('Usage: /inject-codeword "codeword"  ·  /inject-codeword-remove  ·  /inject-codeword-status', "info");
        return;
      }
      // Strip surrounding double quotes if present.
      let arg = raw;
      if (arg.length >= 2 && arg.startsWith('"') && arg.endsWith('"')) {
        arg = arg.slice(1, -1);
      }

      if (arg === "") {
        ctx.ui.notify("Empty codeword — nothing to inject.", "warning");
        return;
      }

      const result = inject(arg);
      ctx.ui.notify(result.message, result.ok ? "info" : "error");
      if (result.ok && (result.message.startsWith("Injected") || result.message.startsWith("Replaced"))) {
        ctx.ui.notify(
          "Takes effect on the next pi start — the running process already loaded compaction.js.",
          "info",
        );
      }
    },
  });

  pi.registerCommand("inject-codeword-remove", {
    description: "Remove the codeword injected into pi's compaction prompt",
    handler: async (_args, ctx) => {
      await doRemove(ctx);
    },
  });

  pi.registerCommand("inject-codeword-status", {
    description: "Show whether a codeword is injected into pi's compaction prompt, and which one",
    handler: async (_args, ctx) => {
      const result = status();
      ctx.ui.notify(result.message, result.ok ? "info" : "error");
    },
  });

  // Hook: when auto compaction fails (threshold or overflow, not manual),
  // dispatch /pi-vcc if it exists. No LLM call — the command handler runs
  // directly, so no model request is made.
  pi.on("session_compact_failed", async (event, ctx) => {
    if (event.reason === "manual") return;
    const commands = pi.getCommands();
    if (!commands.some((c) => c.name === "pi-vcc")) return;
    await pi.sendUserMessage("/pi-vcc", { expandPromptTemplates: true });
  });

  pi.registerCommand("inject-file", {
    description:
      'Inject a markdown file verbatim into the system prompt (per session): /inject-file "path/to/file.md"',
    handler: async (args, ctx) => {
      const raw = args.trim();
      if (raw === "") {
        ctx.ui.notify(
          'Usage: /inject-file "path/to/file.md"  ·  /inject-file-remove  ·  /inject-file-status',
          "info",
        );
        return;
      }
      let arg = raw;
      if (arg.length >= 2 && arg.startsWith('"') && arg.endsWith('"')) {
        arg = arg.slice(1, -1);
      }
      if (arg === "") {
        ctx.ui.notify("Empty path — nothing to inject.", "warning");
        return;
      }
      const resolved = expandPath(arg, ctx.cwd);
      let content: string;
      try {
        content = fs.readFileSync(resolved, "utf8");
      } catch (e) {
        ctx.ui.notify(`Cannot read ${resolved}: ${String(e)}`, "error");
        return;
      }
      if (content.trim() === "") {
        ctx.ui.notify(`File is empty: ${resolved}`, "warning");
        return;
      }
      pi.appendEntry(INJECT_FILE_CUSTOM_TYPE, { path: resolved, removed: false });
      ctx.ui.notify(`Injected ${resolved} into the system prompt (per session).`, "info");
      ctx.ui.notify("Takes effect on the next agent run; persists across compaction.", "info");
    },
  });

  pi.registerCommand("inject-file-remove", {
    description: "Remove the file injected into the system prompt",
    handler: async (_args, ctx) => {
      pi.appendEntry(INJECT_FILE_CUSTOM_TYPE, { path: null, removed: true });
      ctx.ui.notify("Removed file injection from the system prompt.", "info");
      ctx.ui.notify("Takes effect on the next agent run.", "info");
    },
  });

  pi.registerCommand("inject-file-status", {
    description: "Show which file (if any) is injected into the system prompt",
    handler: async (_args, ctx) => {
      const entry = findLastInjectFileEntry(ctx.sessionManager);
      if (!entry) {
        ctx.ui.notify("No file injected into the system prompt.", "info");
        return;
      }
      if (entry.removed || !entry.path) {
        ctx.ui.notify("No file injected (removed).", "info");
        return;
      }
      ctx.ui.notify(`Injected: ${entry.path}`, "info");
    },
  });

  // Re-assert the injected file into the system prompt before every run.
  // Fires on the original run and on every run after compaction (native or
  // pi-vcc), so the section survives compaction. Reads the file fresh each
  // run so edits to the file are picked up; drops the section if the file
  // is gone or the injection was removed.
  pi.on("before_agent_start", (event, ctx) => {
    const entry = findLastInjectFileEntry(ctx.sessionManager);
    if (entry && !entry.removed && entry.path) {
      try {
        event.systemPromptOptions.sections[INJECT_FILE_SECTION] = fs.readFileSync(
          entry.path,
          "utf8",
        );
        return;
      } catch {
        // fall through to delete
      }
    }
    delete event.systemPromptOptions.sections[INJECT_FILE_SECTION];
  });
}
