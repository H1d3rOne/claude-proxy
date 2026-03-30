# `claude-proxy update` Design

## Goal

Add an explicit `claude-proxy update` command that updates the installed project without attaching any update behavior to normal commands like `start`, `config`, `clean`, or Claude hooks.

## Scope

This design only covers a new manual update command.

Out of scope:
- automatic update on startup
- background update checks
- update notifications during normal command execution
- configuration-driven update policies

## User-Facing Behavior

### Command

```bash
claude-proxy update
```

### Install Mode Detection

The command detects install mode from the CLI project root, not from the current shell working directory.

- If `PROJECT_ROOT/.git` exists, treat the installation as a git/source installation.
- Otherwise, treat the installation as an npm global installation.

### Git/Source Mode

When the project root is a git repository, `claude-proxy update` runs these steps in order:

1. Check that the git working tree is clean using `git status --porcelain`.
2. If the working tree is not clean, abort immediately.
3. Run `git pull --ff-only`.
4. If pull fails, abort immediately.
5. Run `npm install`.
6. Run `npm link`.

If all steps succeed, print a final success message.

### npm Global Mode

When the project root is not a git repository, `claude-proxy update` runs:

```bash
npm install -g @h1d3rone/claude-proxy@latest
```

If the command succeeds, print a final success message.

## Error Handling

### Git Working Tree Dirty

If `git status --porcelain` returns any output, abort with a clear error:

```text
Update aborted: git working tree has uncommitted changes
```

Do not continue with `git pull`, `npm install`, or `npm link`.

### Pull Failure

If `git pull --ff-only` fails, exit non-zero and let the command output explain the failure. Do not continue to later steps.

### npm Failure

If `npm install`, `npm link`, or `npm install -g ...` fails, exit non-zero and stop immediately.

No skip-and-continue behavior is allowed for `update`.

## CLI Output

The command should emit concise progress messages before each major step.

Expected high-level messages:

- `Detected install mode: git`
- `Detected install mode: npm`
- `Running git status --porcelain`
- `Running git pull --ff-only`
- `Running npm install`
- `Running npm link`
- `Running npm install -g @h1d3rone/claude-proxy@latest`
- `Update completed via git`
- `Update completed via npm`

External command output from `git` and `npm` should stream directly to the terminal so users can see native tool output in real time.

## Architecture

Create a dedicated updater service instead of embedding update logic inside the CLI command handlers.

Recommended module:

- `src/services/updater.js`

Recommended exported functions:

- `detectInstallMode(projectRoot)`
- `updateFromGit(projectRoot)`
- `updateFromNpm()`
- `runUpdate(projectRoot)`

Responsibilities:

- CLI layer: parse `update` and call the updater service.
- Updater service: detect install mode, run the appropriate commands, and surface clear failures.

## Command Execution Model

Updater shell commands should run with inherited stdio so that:

- `git pull` output is visible
- `npm install` output is visible
- `npm link` output is visible
- global npm update output is visible

This keeps behavior transparent and avoids reformatting subprocess output in the CLI.

## Tests

Add tests that cover:

1. CLI help shows `update`.
2. Install mode detection returns `git` when `.git` exists at project root.
3. Install mode detection returns `npm` when `.git` does not exist.
4. Dirty git worktree aborts before `git pull`.
5. Git mode runs commands in this exact order:
   - `git status --porcelain`
   - `git pull --ff-only`
   - `npm install`
   - `npm link`
6. npm mode runs:
   - `npm install -g @h1d3rone/claude-proxy@latest`

Tests should avoid running real `git pull` or real npm installs by stubbing the command runner behind the updater service.

## Documentation

Update publish-facing README files to include the new command:

- `README.md`
- `README.en.md`

Update the detailed local README:

- `docs/README.local.md`

The new command description should stay brief and reflect the exact behavior:

- source install: `git pull --ff-only && npm install && npm link`
- npm install: `npm install -g @h1d3rone/claude-proxy@latest`

## Non-Goals

This command will not:

- update automatically during `claude-proxy start`
- update automatically during Claude `SessionStart`
- detect or manage multiple installation locations
- self-reexec the current command after updating
- support a fallback from git mode to npm mode
