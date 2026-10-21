# AGENTS.md — working conventions for pi-inject-plugin

Every change has a model/user-facing surface (the slash commands and their notifications), and code. Keep all in sync; this file is the update matrix.

## Layout (one job per file)

```
src/index.ts        entry point: registers commands + hooks (before_agent_start, session_compact_failed)
src/codeword.ts     compaction.js file patching: findPiRoot, inject, revert, status, buildInjection, escape/unescape
src/file.ts         file-injection state: expandPath, findLastInjectFileEntry, INJECT_FILE_* constants
test/codeword.test.ts  unit tests for the pure helpers (escape/unescape/buildInjection/expandPath)
```

Dependency DAG: `index → {codeword, file}`. No cycles. `codeword.ts` and `file.ts` are independent of each other.

## Update matrix — change type ⇒ files to touch

| Change | Must update |
| --- | --- |
| New slash command | `src/index.ts` (registerCommand + handler); README command table row. |
| Codeword injection behavior (marker, signature, patch shape) | `src/codeword.ts`; README "How it works" + "Finding the pi install" sections; `test/codeword.test.ts` if a pure helper changed. |
| pi-install discovery order | `src/codeword.ts` `findPiRoot`; README "Finding the pi install" numbered list (must match the code's order exactly). |
| File-injection state (custom type, section key, persistence) | `src/file.ts`; README "File injection" section. |
| pi-vcc hook trigger condition | `src/index.ts` `session_compact_failed` handler; README "pi-vcc hook" section. |

**Catch-all:** if a change matches no row, list every surface that describes the changed behavior — the command/notification text the user sees and the code that implements it — plus any test that pins the behavior.

## Canonical facts that must agree everywhere

- `MARKER = "pi-inject-patch"`: single source in `src/codeword.ts`. The injected lines in `compaction.js` carry it; `revert`/`status` key off it.
- `INJECT_FILE_CUSTOM_TYPE = "pi-inject-file"` and `INJECT_FILE_SECTION = "pi-inject-file"`: single source in `src/file.ts`. The custom entry type and the system-prompt section key are intentionally identical.
- `SIG` (the `completeSummarization()` signature string) is a single source in `src/codeword.ts`. If pi changes that signature, `inject` fails with "pi may have changed its internals" — update `SIG` and bump the version.
- Command names: the `/inject-codeword*` and `/inject-file*` names in `src/index.ts` must match the README command tables exactly.

## After every change — checklist

```bash
npm install            # when deps change → package-lock.json lands in same/next commit
npm run build          # tsc → dist/ (pi loads src/index.ts directly; dist is for typecheck + tests)
npm test               # node:test — pure helpers only
npm run typecheck
git add -A && git commit -m "feat|fix|docs|chore: ..."   # conventional commits, push origin main
```

## Design constraints

No runtime dependencies: the only import from pi is a **type** import (`import type { ExtensionAPI, ... }`), so `@earendil-works/pi-coding-agent` is a devDependency, not a runtime dep. All other imports are Node built-ins (`fs`, `os`, `path`, `child_process`).

The codeword injection is a **file patch** to pi's install, not an in-process hook — it necessarily takes effect on the next pi start. Do not add logic that assumes the running process sees the patch.

## Git & PR flow

Commits land on `main`. Conventional commits: new features ship as `feat:`, fixes as `fix:`, docs-only follow-ups as `docs:`, lockfile refreshes as `chore:`.
