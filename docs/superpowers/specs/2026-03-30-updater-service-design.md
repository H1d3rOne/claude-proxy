---
title: Updater Service Design
date: 2026-03-30
tags: [updater, services, testing]
---

# Updater Service Design

## Goal

Create a standalone updater service that can pull the latest source (git) or install the published npm package depending on how the CLI is installed. The service will provide a small public API, encapsulate command sequencing, and be covered by deterministic unit tests.

## Requirements

- `detectInstallMode(projectRoot)` inspects `projectRoot/.git` and returns `"git"` when the directory exists, otherwise `"npm"`.
- `updateFromGit(projectRoot)` aborts immediately if `git status --porcelain` returns any text, then runs `git pull --ff-only`, `npm install`, and `npm link` in that order with streamed stdio.
- `updateFromNpm()` runs `npm install -g @h1d3rone/claude-proxy@latest` with streamed stdio.
- `runUpdate(projectRoot)` invokes the mode-specific updater and lets errors bubble up so callers can report failures.
- Provide a command-runner helper that executes subprocesses with inherited stdio and throws when the exit code is non-zero.

## Architecture

- **detectInstallMode:** Uses `fs.promises.stat` (or equivalent) to check for `.git` and returns the proper mode string. This avoids race windows by relying on `ENOENT` handling.
- **Command runner helper:** Wraps `child_process.spawnSync` (or `execFileSync`) with `stdio: "inherit"` and returns the complete result. When `status` is not `0`, throw an `Error` that includes the command arguments for easier debugging.
- **Git update flow:** Call the helper for `git status --porcelain`. If `stdout` has length, throw `Update aborted: git working tree has uncommitted changes`. Otherwise run `git pull --ff-only`, `npm install`, and `npm link` sequentially via the helper.
- **Npm update flow:** Call the helper once for `npm install -g @h1d3rone/claude-proxy@latest`.
- **runUpdate:** Delegate to `updateFromGit` or `updateFromNpm` based on the detected mode.

## Testing Strategy

- Unit tests will stub `fs.promises.stat` and the command-runner helper to simulate `.git` presence/absence, dirty working tree output, and execution order.
- `detectInstallMode` tests cover both git and npm modes.
- `updateFromGit` tests assert that `git status --porcelain` output causes the expected error and that the remaining commands run in order when clean.
- `updateFromNpm` test ensures the scoped package install command is invoked.
- `runUpdate` tests that the detected mode controls which updater runs.

## Error and Flow Guards

- The command runner throws when commands exit with non-zero status so that upstream callers (e.g., the CLI entrypoint) can wrap or log the failure. No additional error wrapping is planned at this layer.
- The git flow explicitly checks for dirty status and aborts with the required message before any more commands run.

## Self-review Checklist

- Placeholder audit: ensure there are no "TBD" tokens in the spec before committing.
- Scope check: this doc is limited to the updater service and associated tests; no unrelated features were introduced.
- Consistency check: the architecture section reflects every requirement listed above.
