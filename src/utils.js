const fs = require("fs/promises");
const fssync = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFile, spawn } = require("child_process");

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(targetPath, fallback = {}) {
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(targetPath, value) {
  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function backupFile(filePath, backupsDir) {
  if (!(await pathExists(filePath))) {
    return null;
  }

  await ensureDir(backupsDir);
  const backupPath = path.join(
    backupsDir,
    `${path.basename(filePath)}.before-claude-proxy-${nowStamp()}`
  );
  await fs.copyFile(filePath, backupPath);
  return backupPath;
}

async function readText(filePath, fallback = "") {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeText(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, "utf8");
}

async function copyFile(sourcePath, targetPath) {
  await ensureDir(path.dirname(targetPath));
  await fs.copyFile(sourcePath, targetPath);
}

async function readHookPayload() {
  if (process.stdin.isTTY) {
    return null;
  }

  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readSessionFile(sessionFile) {
  const content = await readText(sessionFile, "");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function writeSessionFile(sessionFile, sessions) {
  const unique = Array.from(new Set(sessions));
  if (unique.length === 0) {
    if (await pathExists(sessionFile)) {
      await fs.unlink(sessionFile);
    }
    return;
  }
  await writeText(sessionFile, `${unique.join("\n")}\n`);
}

function isProcessAlive(pid) {
  if (!pid || Number.isNaN(Number(pid))) {
    return false;
  }

  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function execFileWithFallbacks(files, args, options = {}) {
  const candidates = Array.from(new Set((Array.isArray(files) ? files : [files]).filter(Boolean)));
  let lastError = null;

  for (const file of candidates) {
    try {
      return await execFileAsync(file, args, options);
    } catch (error) {
      if (error.code === "ENOENT") {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  const error = new Error(`Command not found: ${candidates.join(", ")}`);
  error.code = "ENOENT";
  error.cause = lastError || null;
  throw error;
}

function quoteCommandArg(input, platform = process.platform) {
  const value = String(input);
  if (platform === "win32") {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return shellQuote(value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function spawnDetached(command, args, options = {}) {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    ...options
  });
  child.unref();
  return child;
}

function randomId() {
  return crypto.randomBytes(12).toString("hex");
}

function shellQuote(input) {
  return `'${String(input).replace(/'/g, `'\"'\"'`)}'`;
}

function openLogFile(logPath) {
  fssync.mkdirSync(path.dirname(logPath), { recursive: true });
  return fssync.openSync(logPath, "a");
}

module.exports = {
  backupFile,
  copyFile,
  ensureDir,
  execFileAsync,
  execFileWithFallbacks,
  isProcessAlive,
  nowStamp,
  openLogFile,
  pathExists,
  quoteCommandArg,
  randomId,
  readHookPayload,
  readJson,
  readSessionFile,
  readText,
  shellQuote,
  sleep,
  spawnDetached,
  writeJson,
  writeSessionFile,
  writeText
};
