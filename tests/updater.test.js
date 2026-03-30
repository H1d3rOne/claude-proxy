const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const childProcess = require("node:child_process");
const fsPromises = require("node:fs/promises");

const projectRoot = path.resolve(__dirname, "..");
const updaterPath = require.resolve("../src/services/updater");

function makeFsStat(hasGit) {
  return async (target) => {
    if (target.endsWith(".git") && hasGit) {
      return {};
    }
    const error = new Error("ENOENT");
    error.code = "ENOENT";
    throw error;
  };
}

function createSpawnRecorder(responseFactory) {
  const calls = [];
  return {
    get calls() {
      return calls;
    },
    spawnSync(command, args, options) {
      calls.push({
        command,
        args: [...args],
        options: options ? { ...options } : {}
      });
      return responseFactory({ command, args, options });
    }
  };
}

async function withMocks({ fsStat, spawnSync }, callback) {
  const originalSpawn = childProcess.spawnSync;
  const originalStat = fsPromises.stat;
  if (spawnSync) {
    childProcess.spawnSync = spawnSync;
  }
  if (fsStat) {
    fsPromises.stat = fsStat;
  }
  delete require.cache[updaterPath];
  try {
    const updater = require(updaterPath);
    await callback(updater);
  } finally {
    childProcess.spawnSync = originalSpawn;
    fsPromises.stat = originalStat;
    delete require.cache[updaterPath];
  }
}

test("detectInstallMode returns git when .git is present", async () => {
  await withMocks({ fsStat: makeFsStat(true) }, async (updater) => {
    const mode = await updater.detectInstallMode(projectRoot);
    assert.equal(mode, "git");
  });
});

test("detectInstallMode returns npm when .git is absent", async () => {
  await withMocks({ fsStat: makeFsStat(false) }, async (updater) => {
    const mode = await updater.detectInstallMode(projectRoot);
    assert.equal(mode, "npm");
  });
});

test("updateFromGit aborts when git status reports uncommitted changes", async () => {
  const spawn = createSpawnRecorder(({ args }) => {
    if (args[0] === "status") {
      return { status: 0, stdout: " M dirty-file\n" };
    }
    return { status: 0, stdout: "" };
  });
  await withMocks(
    {
      fsStat: makeFsStat(true),
      spawnSync: spawn.spawnSync
    },
    async (updater) => {
      await assert.rejects(
        updater.updateFromGit(projectRoot),
        { message: "Update aborted: git working tree has uncommitted changes" }
      );
      assert.equal(spawn.calls.length, 1);
      assert.deepEqual(spawn.calls[0].args, ["status", "--porcelain"]);
      assert.equal(spawn.calls[0].options.cwd, projectRoot);
    }
  );
});

test("updateFromGit runs git pull, npm install, and npm link in order when clean", async () => {
  const spawn = createSpawnRecorder(() => ({ status: 0, stdout: "" }));
  await withMocks(
    {
      fsStat: makeFsStat(true),
      spawnSync: spawn.spawnSync
    },
    async (updater) => {
      await updater.updateFromGit(projectRoot);
      const recorded = spawn.calls;
      assert.deepEqual(recorded.map((call) => call.args), [
        ["status", "--porcelain"],
        ["pull", "--ff-only"],
        ["install"],
        ["link"]
      ]);
      assert.deepEqual(recorded.map((call) => call.command), ["git", "git", "npm", "npm"]);
      for (const call of recorded) {
        assert.equal(call.options.cwd, projectRoot);
      }
    }
  );
});

test("updateFromNpm installs the latest scoped package globally", async () => {
  const spawn = createSpawnRecorder(() => ({ status: 0, stdout: "" }));
  await withMocks(
    { spawnSync: spawn.spawnSync },
    async (updater) => {
      await updater.updateFromNpm();
      const recorded = spawn.calls;
      assert.deepEqual(recorded.map((call) => call.args), [["install", "-g", "@h1d3rone/claude-proxy@latest"]]);
      assert.deepEqual(recorded.map((call) => call.command), ["npm"]);
      assert.equal(recorded[0].options.cwd, undefined);
    }
  );
});

test("runUpdate dispatches to git when .git exists and to npm otherwise", async () => {
  const gitSpawn = createSpawnRecorder(() => ({ status: 0, stdout: "" }));
  await withMocks(
    {
      fsStat: makeFsStat(true),
      spawnSync: gitSpawn.spawnSync
    },
    async (updater) => {
      await updater.runUpdate(projectRoot);
      const recorded = gitSpawn.calls;
      assert.deepEqual(recorded.map((call) => call.args), [
        ["status", "--porcelain"],
        ["pull", "--ff-only"],
        ["install"],
        ["link"]
      ]);
      assert.deepEqual(recorded.map((call) => call.command), ["git", "git", "npm", "npm"]);
      assert.equal(recorded[0].options.cwd, projectRoot);
    }
  );

  const npmSpawn = createSpawnRecorder(() => ({ status: 0, stdout: "" }));
  await withMocks(
    {
      fsStat: makeFsStat(false),
      spawnSync: npmSpawn.spawnSync
    },
    async (updater) => {
      await updater.runUpdate(projectRoot);
      const recorded = npmSpawn.calls;
      assert.deepEqual(recorded.map((call) => call.args), [["install", "-g", "@h1d3rone/claude-proxy@latest"]]);
      assert.deepEqual(recorded.map((call) => call.command), ["npm"]);
      assert.equal(recorded[0].options.cwd, undefined);
    }
  );
});
