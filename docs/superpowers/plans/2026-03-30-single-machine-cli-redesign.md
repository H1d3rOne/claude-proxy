# Single-Machine CLI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the multi-host local/remote CLI with a local-only flat configuration and the public commands `config set`, `config get`, `clean`, `start`, and `stop`.

**Architecture:** Flatten configuration parsing into one normalized local runtime object, simplify CLI actions to single-machine flows, and keep Claude lifecycle management through hidden internal commands. Remove all remote-manager paths and update tests/docs to match the new behavior.

**Tech Stack:** Node.js, commander, @iarna/toml, node:test

---

### Task 1: Lock CLI surface with failing tests

**Files:**
- Modify: `tests/cli.test.js`

- [ ] **Step 1: Write failing tests for the new public commands and help text**

Add assertions that help output includes `start` and `stop`, excludes `serve`, excludes host-selection examples, and describes local-only behavior.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cli.test.js`
Expected: FAIL because CLI still exposes `serve` and remote-host help text.

- [ ] **Step 3: Update CLI implementation**

Rename the public command to `start`, add public `stop`, and remove public `--host` / `--include-disabled` options.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/cli.test.js`
Expected: PASS

### Task 2: Lock flat config parsing with failing tests

**Files:**
- Modify: `tests/config.test.js`
- Modify: `src/config.js`

- [ ] **Step 1: Write failing tests for top-level local config and legacy `[[hosts]]` rejection**

Add tests that load flat top-level config, synthesize a flat default config, prompt for missing top-level fields, and reject any `hosts` array.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/config.test.js`
Expected: FAIL because the loader still expects `[[hosts]]`.

- [ ] **Step 3: Implement the flat config loader**

Replace host-array normalization and selection with a single normalized local config object and clear migration errors for old host-based config.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/config.test.js`
Expected: PASS

### Task 3: Lock hook command behavior with failing tests

**Files:**
- Modify: `tests/configuration.test.js`
- Modify: `src/services/host-manager.js`

- [ ] **Step 1: Write failing tests for hostless internal hook commands**

Change hook assertions so managed commands reference `internal ensure-proxy` and `internal stop-proxy` without any `--host` argument, and make sure detached startup shells out to `start`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/configuration.test.js`
Expected: FAIL because hooks and detached start still include host-based command forms.

- [ ] **Step 3: Implement hostless hook commands**

Update command builders, detached start logic, and internal command handlers to work without host selection.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/configuration.test.js`
Expected: PASS

### Task 4: Make public `config` and `clean` match new behavior

**Files:**
- Modify: `src/cli.js`
- Modify: `src/services/client-config-manager.js`

- [ ] **Step 1: Write or extend tests around config/clean side effects**

Assert that `config` still patches local files but no longer restarts the proxy, and `clean` restores files without stopping the proxy.

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `node --test tests/client-config-manager.test.js tests/cli.test.js`
Expected: FAIL because CLI still restarts or stops the proxy in public config/clean flows.

- [ ] **Step 3: Implement the new public command behavior**

Remove restart from `config`, remove stop from `clean`, and keep backup/restore logic intact.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `node --test tests/client-config-manager.test.js tests/cli.test.js`
Expected: PASS

### Task 5: Remove remote code and refresh docs

**Files:**
- Delete: `src/services/remote-manager.js`
- Modify: `README.md`
- Modify: `config_example.toml`

- [ ] **Step 1: Remove dead remote references**

Delete the remote manager module and remove imports, command text, and docs that reference remote hosts or SSH sync.

- [ ] **Step 2: Run the full relevant test suite**

Run: `node --test tests/cli.test.js tests/config.test.js tests/configuration.test.js tests/client-config-manager.test.js tests/server.test.js`
Expected: PASS

- [ ] **Step 3: Manually review the example config and README**

Ensure all command examples and config examples use the new top-level local format and the `start`/`stop` command names.
