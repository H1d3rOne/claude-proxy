const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { DEFAULT_CLIENT_API_KEY } = require("../config");
const {
  backupFile,
  execFileAsync,
  ensureDir,
  isProcessAlive,
  openLogFile,
  readHookPayload,
  readJson,
  readSessionFile,
  readText,
  sleep,
  writeJson,
  writeSessionFile,
  writeText
} = require("../utils");

const MANAGED_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_REASONING_MODEL"
];

const LEGACY_HOOK_TOKENS = {
  "ensure-proxy": ["ensure-claude-code-proxy.sh"],
  "stop-proxy": ["stop-claude-code-proxy.sh"]
};

function makeManagedCommand(action, configPath) {
  return ["claude-proxy", "internal", action, "--config", `'${String(configPath).replace(/'/g, "'\\''")}'`].join(" ");
}

function stripManagedHooks(groups, actionToken) {
  const legacyTokens = LEGACY_HOOK_TOKENS[actionToken] || [];
  if (!Array.isArray(groups)) {
    return [];
  }

  return groups
    .map((group) => ({
      ...group,
      hooks: Array.isArray(group.hooks)
        ? group.hooks.filter((hook) => {
            if (!hook || typeof hook.command !== "string") {
              return true;
            }
            if (hook.command.includes(`internal ${actionToken}`)) {
              return false;
            }
            return !legacyTokens.some((token) => hook.command.includes(token));
          })
        : []
    }))
    .filter((group) => group.hooks.length > 0);
}

async function patchClaudeSettings(config, host, options = {}) {
  const settings = await readJson(host.settings_path, {});
  await ensureDir(host.backups_dir);
  await ensureDir(host.runtime_dir);
  await ensureDir(host.state_dir);
  await ensureDir(host.logs_dir);
  await backupFile(host.settings_path, host.backups_dir);

  settings.env = settings.env || {};
  settings.hooks = settings.hooks || {};

  const clientApiKey = host.client_api_key || DEFAULT_CLIENT_API_KEY;
  const smallModel = host.small_model || config.small_model;
  const middleModel = host.middle_model || config.middle_model;
  const bigModel = host.big_model || config.big_model;
  const defaultClaudeModel = host.default_claude_model || config.default_claude_model;

  settings.env.ANTHROPIC_API_KEY = clientApiKey;
  settings.env.ANTHROPIC_BASE_URL = `http://localhost:${config.server_port}`;
  settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = smallModel;
  settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL = bigModel;
  settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL = middleModel;
  settings.env.ANTHROPIC_MODEL = bigModel;
  settings.env.ANTHROPIC_REASONING_MODEL = bigModel;
  settings.model = defaultClaudeModel;
  settings.includeCoAuthoredBy = false;

  const configPath = options.configPath || config.__configPath || host.config_path;

  const ensureCommand = makeManagedCommand("ensure-proxy", configPath);
  const stopCommand = makeManagedCommand("stop-proxy", configPath);

  const startGroups = stripManagedHooks(settings.hooks.SessionStart, "ensure-proxy");
  startGroups.push({
    hooks: [
      {
        type: "command",
        command: ensureCommand,
        timeout: 15,
        statusMessage: "Ensuring claude-proxy is running"
      }
    ]
  });
  settings.hooks.SessionStart = startGroups;

  const endGroups = stripManagedHooks(settings.hooks.SessionEnd, "stop-proxy");
  endGroups.push({
    hooks: [
      {
        type: "command",
        command: stopCommand,
        timeout: 15,
        statusMessage: "Stopping claude-proxy"
      }
    ]
  });
  settings.hooks.SessionEnd = endGroups;

  await writeJson(host.settings_path, settings);
}

async function cleanClaudeSettings(config, host) {
  const settings = await readJson(host.settings_path, {});
  await ensureDir(host.backups_dir);
  await backupFile(host.settings_path, host.backups_dir);

  if (settings.env && typeof settings.env === "object") {
    for (const key of MANAGED_ENV_KEYS) {
      delete settings.env[key];
    }
    if (Object.keys(settings.env).length === 0) {
      delete settings.env;
    }
  }

  if (settings.hooks && typeof settings.hooks === "object") {
    const startGroups = stripManagedHooks(settings.hooks.SessionStart, "ensure-proxy");
    const endGroups = stripManagedHooks(settings.hooks.SessionEnd, "stop-proxy");

    if (startGroups.length > 0) {
      settings.hooks.SessionStart = startGroups;
    } else {
      delete settings.hooks.SessionStart;
    }

    if (endGroups.length > 0) {
      settings.hooks.SessionEnd = endGroups;
    } else {
      delete settings.hooks.SessionEnd;
    }

    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }
  }

  const defaultClaudeModel = host.default_claude_model || config.default_claude_model;
  if (settings.model === defaultClaudeModel) {
    delete settings.model;
  }

  await writeJson(host.settings_path, settings);
}

async function registerSession(host, sessionId) {
  if (!sessionId) {
    return 0;
  }

  const sessions = await readSessionFile(host.sessions_file);
  sessions.push(sessionId);
  await ensureDir(host.state_dir);
  await writeSessionFile(host.sessions_file, sessions);
  return sessions.length;
}

async function unregisterSession(host, sessionId) {
  const sessions = await readSessionFile(host.sessions_file);
  const filtered = sessionId ? sessions.filter((item) => item !== sessionId) : sessions;
  await writeSessionFile(host.sessions_file, filtered);
  return filtered.length;
}

async function startDetachedProxy(host, configPath) {
  await ensureDir(host.logs_dir);
  await ensureDir(host.state_dir);
  const cliPath = path.join(host.project_root, "src", "cli.js");
  const logFd = openLogFile(host.server_log_file);

  const child = spawn(
    process.execPath,
    [cliPath, "start", "--config", configPath],
    {
      cwd: host.project_root,
      detached: true,
      stdio: ["ignore", logFd, logFd]
    }
  );

  child.unref();
  await writeText(host.pid_file, `${child.pid}\n`);
  return child.pid;
}

async function stopProxyProcess(host) {
  const pidRaw = await readText(host.pid_file, "");
  const pid = Number(pidRaw.trim());
  if (!isProcessAlive(pid)) {
    await fs.rm(host.pid_file, { force: true });
    return false;
  }

  process.kill(pid, "SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 1000));

  if (isProcessAlive(pid)) {
    process.kill(pid, "SIGKILL");
  }

  await fs.rm(host.pid_file, { force: true });
  return true;
}

async function findPidsListeningOnPort(port) {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "tcp"], {
      maxBuffer: 10 * 1024 * 1024
    });

    return Array.from(
      new Set(
        stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && line.includes(`:${port}`) && /LISTENING$/i.test(line))
          .map((line) => line.split(/\s+/).pop())
          .map((pid) => Number(pid))
          .filter((pid) => Number.isInteger(pid) && pid > 0)
      )
    );
  }

  const candidates = ["lsof", "/usr/sbin/lsof", "/usr/bin/lsof"];
  for (const binary of candidates) {
    try {
      const { stdout } = await execFileAsync(binary, ["-ti", `tcp:${port}`], {
        maxBuffer: 1024 * 1024
      });

      return Array.from(
        new Set(
          stdout
            .split(/\r?\n/)
            .map((line) => Number(line.trim()))
            .filter((pid) => Number.isInteger(pid) && pid > 0)
        )
      );
    } catch (error) {
      if (error.code === "ENOENT") {
        continue;
      }

      const output = String(error.stdout || "").trim();
      if (!output) {
        return [];
      }

      return Array.from(
        new Set(
          output
            .split(/\r?\n/)
            .map((line) => Number(line.trim()))
            .filter((pid) => Number.isInteger(pid) && pid > 0)
        )
      );
    }
  }

  return [];
}

async function killPid(pid) {
  if (!isProcessAlive(pid)) {
    return;
  }

  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        maxBuffer: 1024 * 1024
      });
    } catch {}
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {}

  await sleep(1000);

  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}

async function killProxyPortOccupants(port, excludePids = []) {
  const excluded = new Set(excludePids.filter(Boolean).map((pid) => Number(pid)));
  const pids = await findPidsListeningOnPort(port);

  for (const pid of pids) {
    if (excluded.has(pid) || pid === process.pid) {
      continue;
    }
    await killPid(pid);
  }
}

async function ensureProxy(config, host, configPath) {
  const payload = await readHookPayload();
  const sessionId = payload && payload.session_id ? payload.session_id : null;
  await registerSession(host, sessionId);

  const pidRaw = await readText(host.pid_file, "");
  const pid = Number(pidRaw.trim());
  if (isProcessAlive(pid)) {
    return pid;
  }

  return startDetachedProxy(host, configPath);
}

async function stopProxy(config, host, options = {}) {
  const payload = options.force ? null : await readHookPayload();
  const sessionId = payload && payload.session_id ? payload.session_id : null;
  const remaining = options.force ? 0 : await unregisterSession(host, sessionId);

  if (!options.force && remaining > 0) {
    return { stopped: false, remaining };
  }

  await stopProxyProcess(host);
  if (options.killPort) {
    await killProxyPortOccupants(config.server_port);
  }
  await writeSessionFile(host.sessions_file, []);
  return { stopped: true, remaining: 0 };
}

async function restartProxy(config, host, configPath) {
  const pidRaw = await readText(host.pid_file, "");
  const previousPid = Number(pidRaw.trim());
  await stopProxy(config, host, { force: true, killPort: true });
  await killProxyPortOccupants(config.server_port, [previousPid]);
  return startDetachedProxy(host, configPath);
}

module.exports = {
  cleanClaudeSettings,
  ensureProxy,
  patchClaudeSettings,
  restartProxy,
  stopProxy
};
