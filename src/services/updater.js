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

function executeCommand(command, args, options = {}) {
  const spawnOptions = { stdio: "inherit", ...options };
  const result = spawnSync(command, args, spawnOptions);
  if (result.error) {
    const wrapped = new Error(`Command failed: ${command} ${args.join(" ")}`);
    wrapped.cause = result.error;
    throw wrapped;
  }
  if (result.status !== 0) {
    const wrapped = new Error(`Command failed: ${command} ${args.join(" ")}`);
    wrapped.exitCode = result.status;
    throw wrapped;
  }
  return result;
}

function runCommand(command, args, options = {}) {
  return executeCommand(command, args, options);
}

function runCommandWithOutput(command, args, options = {}) {
  const result = executeCommand(command, args, { ...options, stdio: ["ignore", "pipe", "inherit"] });
  if (result.stdout && result.stdout.length > 0) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr && result.stderr.length > 0) {
    process.stderr.write(result.stderr);
  }
  return result;
}

async function updateFromGit(projectRoot) {
  const statusResult = runCommandWithOutput("git", gitStatusArgs, { cwd: projectRoot });
  const rawStatus = statusResult.stdout ?? Buffer.alloc(0);
  const text = typeof rawStatus === "string" ? rawStatus : rawStatus.toString("utf8");
  if (text.trim()) {
    throw new Error("Update aborted: git working tree has uncommitted changes");
  }
  runCommand("git", gitPullArgs, { cwd: projectRoot });
  runCommand("npm", npmInstallArgs, { cwd: projectRoot });
  runCommand("npm", npmLinkArgs, { cwd: projectRoot });
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
