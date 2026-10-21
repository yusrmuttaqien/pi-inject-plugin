# pi-inject-plugin

Pi extension that injects content into pi's prompts. Two independent features:

1. **Codeword injection** — prepend a codeword to the compaction/summarization prompt, so it leads every summarization LLM call.
2. **File injection** — inject a markdown file verbatim into the system prompt, per session.

Plus a hook that auto-fires `/pi-vcc` when auto-compaction fails.

## Codeword injection

The codeword is **prepended to the first line of the summarization user message** inside `completeSummarization()` — the single choke point for ALL pi summarization LLM calls (manual `/compact`, auto threshold/overflow compaction, split-turn prefix summary, and `/tree` branch summarization). All default prompt text is left untouched; the codeword simply leads it.

Re-running `/inject-codeword` with a new codeword **replaces** the previous one (the marker identifies the injected lines, which are removed before re-inserting).

| Command | Effect |
|---|---|
| `/inject-codeword "codeword"` | Inject a codeword (replaces any previous injection) |
| `/inject-codeword-remove` | Remove the injection |
| `/inject-codeword-status` | Show the current injection |

### How it works

The extension patches `dist/core/compaction/compaction.js` in the running pi install. It locates the `completeSummarization()` signature, removes any existing marker lines, and inserts two new lines (a comment and the injection code) right after the signature. Both lines carry the `pi-inject-patch` marker so re-injection is a clean replace. A `node --check` sanity gate confirms the file still parses.

### Finding the pi install

The patch targets the **running** pi binary first (`process.argv[1]`), so in a managed install it patches the active release, not an arbitrary one. Fallbacks, in order:

1. Running binary (`process.argv[1]`, realpath'd)
2. `PI_MANAGED_INSTALL_ROOT` (set by the managed-install launcher)
3. `npm root -g`
4. Managed releases scan (`~/.pi/agent/install/releases`, current version first)
5. nvm scan (last resort)

Works with both pi installation modes: `npm -g` and the managed bash-script install.

### Takes effect on next start

The codeword injection is a **file patch**, so the running process (which already loaded `compaction.js`) is unaffected — it takes effect on the **next pi start**.

## File injection

A markdown file is injected **verbatim** into the system prompt via the `before_agent_start` hook, which fires before EVERY agent run — the original run and every run after compaction (native or pi-vcc). The system message is not part of the summarized messages, so the section survives compaction; the hook re-asserts it on each run.

The selected path is persisted **per session** via a custom entry (`appendEntry`), which survives session resume. The last such entry wins (a tombstone removes the injection). Custom entries are not sent to the LLM, so no context bloat.

| Command | Effect |
|---|---|
| `/inject-file "path/to/file.md"` | Inject a markdown file verbatim (per session) |
| `/inject-file-remove` | Remove the file injection |
| `/inject-file-status` | Show the current file injection |

The file is read fresh on every run, so edits to the file are picked up. If the file is deleted or the injection is removed, the section is dropped.

## pi-vcc hook

When auto-compaction fails (threshold or overflow, not a manual `/compact`), the `session_compact_failed` hook dispatches `/pi-vcc` if that command exists. No LLM call is made — the command handler runs directly.

## Install

```bash
pi install git:https://github.com/yusrmuttaqien/pi-inject-plugin
```

## Development

```bash
npm install
npm run build
npm test
npm run typecheck
```
