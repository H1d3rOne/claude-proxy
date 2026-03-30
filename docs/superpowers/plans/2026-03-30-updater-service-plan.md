---
title: Updater Service Implementation Plan
date: 2026-03-30
tags: [updater, services, testing]
---

# Updater Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the dedicated updater service (detect mode, git/npm flows, runUpdate) plus deterministic tests that capture the desired commands and failure modes.

**Architecture:** The service exposes four async helpers (`detectInstallMode`, `updateFromGit`, `updateFromNpm`, `runUpdate`) centered around a shared command runner that always reuses inherited `stdio`. Tests mock the filesystem and `child_process.spawnSync` to assert command arguments, order, and error branching.

**Tech Stack:** Node.js 18+ built-in modules (`node:test`, `node:assert/strict`, `node:fs/promises`, `node:child_process`, `node:path`); rely on `node --test` runner.

---

### Task 1: Add updater tests

**Files:**
- Create: `tests/updater.test.js`

- [ ] **Step 1: Write the failing tests**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

function makeFsMock(hasGit) {
  return {
    stat: async (target) => {
      if (target.endsWith(".git") && hasGit) {
        return {};
      }
      const error = new Error("ENOENT");
      error.code = "ENOENT";
      throw error;
    }
  };
}

function createSpawnRecorder(responseFactory) {
  const calls = [];
  return {
    get calls() {
      return calls;
    },
    spawnSync(command, args, options) {
      calls.push({ command, args, options });
      return responseFactory({ command, args, options });
    }
  };
}

test("detectInstallMode returns git when .git is present", async () => {
  const fsMock = makeFsMock(true);
  const updater = test.mock("../src/services/updater", {
    "fs/promises": fsMock
  });
  const mode = await updater.detectInstallMode(projectRoot);
  assert.equal(mode, "git");
});

test("detectInstallMode returns npm when .git is absent", async () => {
  const fsMock = makeFsMock(false);
  const updater = test.mock("../src/services/updater", {
    "fs/promises": fsMock
  });
  const mode = await updater.detectInstallMode(projectRoot);
  assert.equal(mode, "npm");
});

test("updateFromGit aborts before running pull/install/link when working tree is dirty", async () => {
  const spawn = createSpawnRecorder(({ args }) => {
    if (args[0] === "status") {
      return { status: 0, stdout: " M dirty-file\n" };
    }
    return { status: 0, stdout: "" };
  });
  const updater = test.mock("../src/services/updater", {
    "fs/promises": makeFsMock(true),
    "child_process": { spawnSync: spawn.spawnSync }
  });

  await assert.rejects(
    updater.updateFromGit(projectRoot),
    { message: "Update aborted: git working tree has uncommitted changes" }
  );
  assert.equal(spawn.calls.length, 1);
  assert.deepEqual(spawn.calls[0].args, ["status", "--porcelain"]);
});

test("updateFromGit runs git pull, npm install, and npm link in order when clean", async () => {
  const commands = [];
  const spawn = createSpawnRecorder((ctx) => {
    commands.push(ctx.args.join(" "));
    return { status: 0, stdout: "" };
  });
  const updater = test.mock("../src/services/updater", {
    "fs/promises": makeFsMock(true),
    "child_process": { spawnSync: spawn.spawnSync }
  });

  await updater.updateFromGit(projectRoot);
  assert.deepEqual(commands, [
    "status --porcelain",
    "pull --ff-only",
    "install",
    "link"
  ]);
});

test("updateFromNpm installs the latest scoped package globally", async () => {
  const commands = [];
  const spawn = createSpawnRecorder((ctx) => {
    commands.push(ctx.args.join(" "));
    return { status: 0, stdout: "" };
  });
  const updater = test.mock("../src/services/updater", {
    "child_process": { spawnSync: spawn.spawnSync }
  });

  await updater.updateFromNpm();
  assert.deepEqual(commands, ["install", "-g", "@h1d3rone/claude-proxy@latest"]);
});

test("runUpdate dispatches to git when .git exists and to npm otherwise", async () => {
  const gitCalls = [];
  const gitSpawn = createSpawnRecorder(({ args }) => {
    gitCalls.push(args.join(" "));
    return { status: 0, stdout: "" };
  });
  const gitUpdater = test.mock("../src/services/updater", {
    "fs/promises": makeFsMock(true),
    "child_process": { spawnSync: gitSpawn.spawnSync }
  });
  await gitUpdater.runUpdate(projectRoot);
  assert.match(gitCalls[0], /^status/);

  const npmCalls = [];
  const npmSpawn = createSpawnRecorder(({ args }) => {
    npmCalls.push(args.join(" "));
    return { status: 0, stdout: "" };
  });
  const npmUpdater = test.mock("../src/services/updater", {
    "fs/promises": makeFsMock(false),
    "child_process": { spawnSync: npmSpawn.spawnSync }
  });
  await npmUpdater.runUpdate(projectRoot);
  assert.deepEqual(npmCalls, ["install", "-g", "@h1d3rone/claude-proxy@latest"]);
});
```

- [ ] **Step 2: Run the failing test suite**

```
node --test tests/updater.test.js
```

**Expected:** FAILURE because `src/services/updater.js` does not exist yet, so Node reports `Cannot find module '../src/services/updater'`.

- [ ] **Step 3: Observe and document the failure**

```
# optionally capture the error for future debugging
node --test tests/updater.test.js 2>&1 | tee /tmp/updater-test-failure.log
```

**Expected:** The log contains the `Cannot find module` stack and the planned test assertions (dirty tree message) have not been reached; this confirms the new tests exercise the desired paths.

### Task 2: Implement the updater service

**Files:**
- Create: `src/services/updater.js`

- [ ] **Step 1: Implement the service**

```js
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const latestPackage = "@h1d3rone/claude-proxy@latest";
const gitStatusArgs = ["status", "--porcelain"];
const gitPullArgs = ["pull", "--ff-only"];
const npmInstallArgs = ["install"];
const npmLinkArgs = ["link"];
const npmGlobalArgs = ["install", "-g", latestPackage];

function resolveGitDir(projectRoot) {
  return path.join(projectRoot, ".git");
}

async function detectInstallMode(projectRoot) {
  try {
    await fs.stat(resolveGitDir(projectRoot));
    return "git";
  } catch (error) {
    if (error.code === "ENOENT") {
      return "npm";
    }
    throw error;
  }
}

function runCommand(command, args, options = {}) {
  const spawnOptions = { stdio: "inherit", ...options };
  const result = spawnSync(command, args, spawnOptions);
  if (result.status !== 0) {
    const error = new Error(`Command failed: ${command} ${args.join(" ")}`);
    error.command = command;
    error.args = args;
    error.exitCode = result.status;
    throw error;
  }
  return result;
}

function runCommandWithOutput(command, args) {
  const result = runCommand(command, args, { stdio: ["ignore", "pipe", "inherit"] });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  return result;
}

async function updateFromGit(projectRoot) {
  const statusResult = runCommandWithOutput("git", gitStatusArgs);
  const statusOutput = statusResult.stdout?.toString("utf8").trim();
  if (statusOutput) {
    throw new Error("Update aborted: git working tree has uncommitted changes");
  }
  runCommand("git", gitPullArgs);
  runCommand("npm", npmInstallArgs);
  runCommand("npm", npmLinkArgs);
}

function updateFromNpm() {
  runCommand("npm", npmGlobalArgs);
}

async function runUpdate(projectRoot) {
  const mode = await detectInstallMode(projectRoot);
  if (mode === "git") {
    return updateFromGit(projectRoot);
  }
  return updateFromNpm();
}

module.exports = {
  detectInstallMode,
  updateFromGit,
  updateFromNpm,
  runUpdate
};
```

The helper honors the streaming requirement via `stdio: "inherit"` for most commands and fakes streaming for the status check by piping, emitting the bytes back to the console, and still throwing if there are uncommitted changes.

- [ ] **Step 2: Run tests to confirm they pass**

```
node --test tests/updater.test.js
```

**Expected:** PASS once the git commands and global npm install flows are wired up.

- [ ] **Step 3: Run any required sweep (optional)**

```
node --test tests/updater.test.js
```

**Expected:** Passing output remains stable; record the command in case the maintainer wants wider coverage later.

### Task 3: Commit the changes

**Files:**
- Modify: `tests/updater.test.js`
- Modify: `src/services/updater.js`
- Modify: `docs/superpowers/plans/2026-03-30-updater-service-plan.md`
- Modify: `docs/superpowers/specs/2026-03-30-updater-service-design.md`

- [ ] **Step 1: Stage the task files**

```
git add tests/updater.test.js src/services/updater.js docs/superpowers/specs/2026-03-30-updater-service-design.md docs/superpowers/plans/2026-03-30-updater-service-plan.md
```

- [ ] **Step 2: Commit with the required message**

```
git commit -m "feat: add manual update service"
```
